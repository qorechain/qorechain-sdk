//! Live check against a real node (ignored by default):
//! QORE_WS_URL=https://rpc-testnet.qore.host cargo test --test subscribe_live -- --ignored
use qorechain::subscribe::SubscribeClient;
use std::time::{Duration, Instant};

#[tokio::test]
#[ignore]
async fn receives_a_block_and_closes() {
    let url = std::env::var("QORE_WS_URL").expect("set QORE_WS_URL");
    let client = SubscribeClient::connect(&url).await.expect("connect");
    let mut sub = client.subscribe_new_blocks().expect("subscribe");
    let ev = tokio::time::timeout(Duration::from_secs(30), sub.events.recv())
        .await
        .expect("a block within 30 s");
    assert!(ev.is_some());
    let t = Instant::now();
    client.close().await;
    // The stream ends once the client is closed, even though `sub` is alive.
    let end = tokio::time::timeout(Duration::from_secs(5), sub.events.recv()).await;
    assert!(matches!(end, Ok(None)), "subscription stream did not end");
    println!("closed in {:?}", t.elapsed());
}
