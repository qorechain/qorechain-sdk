//! WebSocket subscription framing tests: exercise the JSON-RPC dispatch without
//! a live socket (mock framing), mirroring the Go SDK's dispatch-for-test.

use qorechain::subscribe::{
    dispatch_frame, new_subs, register_for_test, QUERY_NEW_BLOCK, QUERY_TX,
};

#[tokio::test]
async fn dispatch_routes_event_to_subscriber() {
    let subs = new_subs();
    let mut rx = register_for_test(&subs, "1");

    // A pushed NewBlock event frame correlated by id "1".
    let frame = r#"{
        "jsonrpc":"2.0",
        "id":"1",
        "result":{
            "query":"tm.event='NewBlock'",
            "data":{"type":"event/NewBlock","value":{"block":{"header":{"height":"42"}}}}
        }
    }"#;
    dispatch_frame(&subs, frame.as_bytes());

    let event = rx.try_recv().expect("event delivered");
    assert_eq!(event.query, "tm.event='NewBlock'");
    assert_eq!(event.data["value"]["block"]["header"]["height"], "42");
}

#[tokio::test]
async fn dispatch_ignores_subscribe_ack() {
    let subs = new_subs();
    let mut rx = register_for_test(&subs, "1");

    // The subscribe ack has an empty result (no data) and must not be delivered.
    let ack = r#"{"jsonrpc":"2.0","id":"1","result":{}}"#;
    dispatch_frame(&subs, ack.as_bytes());
    assert!(rx.try_recv().is_err(), "ack must not produce an event");
}

#[tokio::test]
async fn dispatch_drops_unknown_subscription() {
    let subs = new_subs();
    let mut rx = register_for_test(&subs, "1");

    // An event for a different id is dropped (no panic, no delivery).
    let frame = r#"{"jsonrpc":"2.0","id":"999","result":{"query":"q","data":{"x":1}}}"#;
    dispatch_frame(&subs, frame.as_bytes());
    assert!(rx.try_recv().is_err());
}

#[test]
fn query_constants() {
    assert_eq!(QUERY_NEW_BLOCK, "tm.event='NewBlock'");
    assert_eq!(QUERY_TX, "tm.event='Tx'");
}
