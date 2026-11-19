package io.github.qorechain.subscribe;

import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/** Live check against a node: QORE_WS_URL=http://host:26657 ./gradlew test. */
@EnabledIfEnvironmentVariable(named = "QORE_WS_URL", matches = ".+")
class SubscriptionLiveTest {
    @Test
    void receivesABlockAndCloses() throws Exception {
        CountDownLatch got = new CountDownLatch(2); // the ack, then a block
        try (SubscriptionClient c = new SubscriptionClient(System.getenv("QORE_WS_URL"))) {
            c.subscribeNewBlocks(n -> got.countDown(), e -> {});
            assertTrue(got.await(30, TimeUnit.SECONDS), "no block within 30 s");
        }
    }
}
