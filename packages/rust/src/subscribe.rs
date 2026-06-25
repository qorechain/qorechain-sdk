//! WebSocket subscriptions to the chain RPC `/websocket` endpoint, exposing
//! typed helpers for new-block and transaction event subscriptions over
//! JSON-RPC, mirroring the TS / Go SDKs.
//!
//! The transport is `tokio-tungstenite`; the framing follows the chain RPC's
//! JSON-RPC subscribe protocol (method `"subscribe"`, a `"query"` param, and a
//! per-subscription string id used to correlate pushed events). The pushed-frame
//! routing is exposed via [`dispatch_frame`] so the framing can be exercised in
//! tests without a live socket.

use crate::error::{Error, Result};
use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message as WsMessage;

/// The query matching every committed block.
pub const QUERY_NEW_BLOCK: &str = "tm.event='NewBlock'";
/// The query matching every committed transaction.
pub const QUERY_TX: &str = "tm.event='Tx'";

/// A single pushed subscription event.
#[derive(Debug, Clone)]
pub struct Event {
    /// The subscription query that produced this event.
    pub query: String,
    /// The raw JSON of the event's `result.data` field.
    pub data: Value,
    /// The full raw JSON-RPC `result` object.
    pub result: Value,
}

type Subs = Arc<Mutex<HashMap<String, mpsc::UnboundedSender<Event>>>>;

/// A WebSocket subscription client for the chain RPC.
pub struct SubscribeClient {
    writer: mpsc::UnboundedSender<WsMessage>,
    subs: Subs,
    next_id: Arc<Mutex<u64>>,
}

/// A live subscription: a stream of [`Event`]s plus an `unsubscribe` handle.
pub struct Subscription {
    /// The receiver yielding pushed events for this subscription.
    pub events: mpsc::UnboundedReceiver<Event>,
    id: String,
    query: String,
    writer: mpsc::UnboundedSender<WsMessage>,
    subs: Subs,
}

impl Subscription {
    /// Cancels the subscription: removes the local handler and sends an
    /// `unsubscribe` frame.
    pub fn unsubscribe(&self) -> Result<()> {
        self.subs.lock().unwrap().remove(&self.id);
        let req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": format!("{}-unsub", self.id),
            "method": "unsubscribe",
            "params": { "query": self.query },
        });
        self.writer
            .send(WsMessage::Text(req.to_string()))
            .map_err(|e| Error::Transport(format!("send unsubscribe: {e}")))
    }
}

impl SubscribeClient {
    /// Connects to the chain RPC WebSocket endpoint.
    ///
    /// `endpoint` may be a full `ws://` / `wss://` URL, or an `http://` /
    /// `https://` base URL (the scheme is upgraded and `/websocket` appended if
    /// absent). A background task pumps incoming frames to the per-subscription
    /// channels until the connection closes.
    pub async fn connect(endpoint: &str) -> Result<Self> {
        let ws_url = normalize_ws_url(endpoint);
        let (stream, _) = tokio_tungstenite::connect_async(&ws_url)
            .await
            .map_err(|e| Error::Transport(format!("dial {ws_url}: {e}")))?;
        let (mut sink, mut source) = stream.split();

        let (write_tx, mut write_rx) = mpsc::unbounded_channel::<WsMessage>();
        let subs: Subs = Arc::new(Mutex::new(HashMap::new()));

        // Writer task: forward outbound frames to the socket.
        tokio::spawn(async move {
            while let Some(msg) = write_rx.recv().await {
                if sink.send(msg).await.is_err() {
                    break;
                }
            }
        });

        // Reader task: dispatch inbound frames to subscription channels.
        let reader_subs = subs.clone();
        tokio::spawn(async move {
            while let Some(Ok(msg)) = source.next().await {
                if let WsMessage::Text(text) = msg {
                    dispatch_frame(&reader_subs, text.as_bytes());
                }
            }
        });

        Ok(Self {
            writer: write_tx,
            subs,
            next_id: Arc::new(Mutex::new(0)),
        })
    }

    /// Registers a subscription for `query` and sends the subscribe request,
    /// returning the [`Subscription`] handle.
    pub fn subscribe(&self, query: &str) -> Result<Subscription> {
        let id = {
            let mut n = self.next_id.lock().unwrap();
            *n += 1;
            n.to_string()
        };
        let (tx, rx) = mpsc::unbounded_channel::<Event>();
        self.subs.lock().unwrap().insert(id.clone(), tx);

        let req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "subscribe",
            "params": { "query": query },
        });
        self.writer
            .send(WsMessage::Text(req.to_string()))
            .map_err(|e| {
                self.subs.lock().unwrap().remove(&id);
                Error::Transport(format!("send subscribe: {e}"))
            })?;

        Ok(Subscription {
            events: rx,
            id,
            query: query.to_string(),
            writer: self.writer.clone(),
            subs: self.subs.clone(),
        })
    }

    /// Subscribes to committed blocks ([`QUERY_NEW_BLOCK`]).
    pub fn subscribe_new_blocks(&self) -> Result<Subscription> {
        self.subscribe(QUERY_NEW_BLOCK)
    }

    /// Subscribes to committed transactions matching `query`. An empty `query`
    /// subscribes to all transactions; a query without `tm.event` is AND-ed with
    /// [`QUERY_TX`].
    pub fn subscribe_tx(&self, query: &str) -> Result<Subscription> {
        let q = if query.trim().is_empty() {
            QUERY_TX.to_string()
        } else if !query.contains("tm.event") {
            format!("{QUERY_TX} AND {query}")
        } else {
            query.to_string()
        };
        self.subscribe(&q)
    }
}

/// Routes a raw incoming JSON-RPC frame to its subscription channel.
///
/// Exposed so the framing can be exercised in tests without a live socket: a
/// subscribe ack (empty `result.data`) is ignored; a pushed event is delivered
/// to the channel registered under the frame's `id`.
pub fn dispatch_frame(subs: &Subs, frame: &[u8]) {
    let v: Value = match serde_json::from_slice(frame) {
        Ok(v) => v,
        Err(_) => return,
    };
    let result = &v["result"];
    let data = &result["data"];
    // The subscribe ack carries an empty result.data; skip it.
    if data.is_null() {
        return;
    }
    let id = match v["id"].as_str() {
        Some(id) => id.to_string(),
        None => return,
    };
    let tx = {
        let guard = subs.lock().unwrap();
        match guard.get(&id) {
            Some(tx) => tx.clone(),
            None => return,
        }
    };
    let _ = tx.send(Event {
        query: result["query"].as_str().unwrap_or("").to_string(),
        data: data.clone(),
        result: result.clone(),
    });
}

/// Builds a fresh subscription map (used by [`dispatch_frame`] in tests).
pub fn new_subs() -> Subs {
    Arc::new(Mutex::new(HashMap::new()))
}

/// Registers a channel under `id` in `subs` and returns the receiver. Exposed so
/// the framing/dispatch can be exercised in tests without a live socket.
pub fn register_for_test(subs: &Subs, id: &str) -> mpsc::UnboundedReceiver<Event> {
    let (tx, rx) = mpsc::unbounded_channel::<Event>();
    subs.lock().unwrap().insert(id.to_string(), tx);
    rx
}

/// Converts an http(s)/ws(s) endpoint into a `ws(s)://` URL ending in
/// `/websocket`.
fn normalize_ws_url(endpoint: &str) -> String {
    let mut u = if let Some(rest) = endpoint.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = endpoint.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        endpoint.to_string()
    };
    while u.ends_with('/') {
        u.pop();
    }
    if !u.ends_with("/websocket") {
        u.push_str("/websocket");
    }
    u
}

/// The shared subscription-map type, exposed so tests can register channels and
/// drive [`dispatch_frame`] directly.
pub type SubscriptionMap = Subs;
