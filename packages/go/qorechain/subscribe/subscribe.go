// Package subscribe provides a WebSocket client for the QoreChain RPC
// /websocket endpoint, exposing typed helpers for new-block and transaction
// event subscriptions over JSON-RPC.
//
// The transport is the generic gorilla/websocket library; the framing follows
// the chain RPC's JSON-RPC subscribe protocol (method "subscribe", a "query"
// param, and a per-subscription string id used to correlate pushed events).
package subscribe

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
)

// Event is a single pushed subscription event: the raw JSON-RPC result payload
// for the matched query.
type Event struct {
	// Query is the subscription query that produced this event.
	Query string
	// Data is the raw JSON of the event's result.data field.
	Data json.RawMessage
	// Result is the full raw JSON-RPC result object.
	Result json.RawMessage
}

// Handler receives subscription events. Returning an error stops the
// subscription read loop for that subscription.
type Handler func(Event) error

// Queries for the common subscriptions.
const (
	// QueryNewBlock matches every committed block.
	QueryNewBlock = "tm.event='NewBlock'"
	// QueryTx matches every committed transaction.
	QueryTx = "tm.event='Tx'"
)

// Client is a WebSocket subscription client for the chain RPC.
type Client struct {
	conn   *websocket.Conn
	mu     sync.Mutex
	nextID int
	subs   map[string]Handler
	closed chan struct{}
	once   sync.Once
}

// Dial connects to the chain RPC WebSocket endpoint.
//
// endpoint may be a full ws:// / wss:// URL, or an http:// / https:// base URL
// (the scheme is upgraded and "/websocket" is appended if absent).
func Dial(ctx context.Context, endpoint string) (*Client, error) {
	wsURL := normalizeWSURL(endpoint)
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, wsURL, nil)
	if err != nil {
		return nil, fmt.Errorf("dial %s: %w", wsURL, err)
	}
	c := &Client{
		conn:   conn,
		subs:   make(map[string]Handler),
		closed: make(chan struct{}),
	}
	go c.readLoop()
	return c, nil
}

// NewClientWithConn wraps an already-open websocket connection (used in tests).
func NewClientWithConn(conn *websocket.Conn) *Client {
	c := &Client{
		conn:   conn,
		subs:   make(map[string]Handler),
		closed: make(chan struct{}),
	}
	go c.readLoop()
	return c
}

// rpcRequest is a JSON-RPC 2.0 request for the subscribe protocol.
type rpcRequest struct {
	JSONRPC string         `json:"jsonrpc"`
	ID      string         `json:"id"`
	Method  string         `json:"method"`
	Params  map[string]any `json:"params"`
}

// Subscribe registers handler for the given query and sends the subscribe
// request. It returns an unsubscribe function that cancels the subscription.
func (c *Client) Subscribe(query string, handler Handler) (func() error, error) {
	c.mu.Lock()
	c.nextID++
	id := fmt.Sprintf("%d", c.nextID)
	c.subs[id] = handler
	c.mu.Unlock()

	req := rpcRequest{
		JSONRPC: "2.0",
		ID:      id,
		Method:  "subscribe",
		Params:  map[string]any{"query": query},
	}
	if err := c.conn.WriteJSON(req); err != nil {
		c.mu.Lock()
		delete(c.subs, id)
		c.mu.Unlock()
		return nil, fmt.Errorf("write subscribe: %w", err)
	}

	unsubscribe := func() error {
		c.mu.Lock()
		delete(c.subs, id)
		c.mu.Unlock()
		return c.conn.WriteJSON(rpcRequest{
			JSONRPC: "2.0",
			ID:      id + "-unsub",
			Method:  "unsubscribe",
			Params:  map[string]any{"query": query},
		})
	}
	return unsubscribe, nil
}

// SubscribeNewBlocks subscribes to committed blocks.
func (c *Client) SubscribeNewBlocks(handler Handler) (func() error, error) {
	return c.Subscribe(QueryNewBlock, handler)
}

// SubscribeTx subscribes to committed transactions matching query. Pass an empty
// query to subscribe to all transactions (QueryTx).
func (c *Client) SubscribeTx(query string, handler Handler) (func() error, error) {
	if strings.TrimSpace(query) == "" {
		query = QueryTx
	} else if !strings.Contains(query, "tm.event") {
		query = QueryTx + " AND " + query
	}
	return c.Subscribe(query, handler)
}

// Close closes the WebSocket connection and stops the read loop.
func (c *Client) Close() error {
	var err error
	c.once.Do(func() {
		close(c.closed)
		err = c.conn.Close()
	})
	return err
}

// rpcResponse is a pushed JSON-RPC event or subscribe ack.
type rpcResponse struct {
	ID     string `json:"id"`
	Result struct {
		Query string          `json:"query"`
		Data  json.RawMessage `json:"data"`
	} `json:"result"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func (c *Client) readLoop() {
	for {
		select {
		case <-c.closed:
			return
		default:
		}
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		c.dispatch(data)
	}
}

// dispatch routes a raw incoming frame to its subscription handler. It is
// exported-for-test via DispatchForTest.
func (c *Client) dispatch(data []byte) {
	var resp rpcResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return
	}
	// The subscribe ack has an empty result.query/data; skip it.
	if len(resp.Result.Data) == 0 {
		return
	}
	c.mu.Lock()
	handler, ok := c.subs[resp.ID]
	c.mu.Unlock()
	if !ok {
		return
	}
	_ = handler(Event{
		Query:  resp.Result.Query,
		Data:   resp.Result.Data,
		Result: rawResult(data),
	})
}

// DispatchForTest feeds a raw frame to the dispatcher (test-only entry point so
// the framing can be exercised without a live socket).
func (c *Client) DispatchForTest(data []byte) { c.dispatch(data) }

func rawResult(frame []byte) json.RawMessage {
	var envelope struct {
		Result json.RawMessage `json:"result"`
	}
	if err := json.Unmarshal(frame, &envelope); err != nil {
		return nil
	}
	return envelope.Result
}

// normalizeWSURL converts an http(s)/ws(s) endpoint into a ws(s):// URL ending
// in /websocket.
func normalizeWSURL(endpoint string) string {
	u := endpoint
	switch {
	case strings.HasPrefix(u, "https://"):
		u = "wss://" + strings.TrimPrefix(u, "https://")
	case strings.HasPrefix(u, "http://"):
		u = "ws://" + strings.TrimPrefix(u, "http://")
	}
	u = strings.TrimRight(u, "/")
	if !strings.HasSuffix(u, "/websocket") {
		u += "/websocket"
	}
	return u
}
