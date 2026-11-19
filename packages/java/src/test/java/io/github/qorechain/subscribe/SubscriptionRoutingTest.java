package io.github.qorechain.subscribe;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class SubscriptionRoutingTest {
    @Test
    void eachSubscriptionGetsOnlyItsOwnEvents() {
        SubscriptionClient c = new SubscriptionClient("http://localhost:26657");
        List<JsonNode> blocks = new ArrayList<>();
        List<JsonNode> txs = new ArrayList<>();
        c.registerForTest(1, blocks::add);
        c.registerForTest(2, txs::add);
        c.dispatch("{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"query\":\"tm.event='Tx'\",\"data\":{}}}");
        c.dispatch("{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"query\":\"tm.event='NewBlock'\",\"data\":{}}}");
        c.dispatch("{\"jsonrpc\":\"2.0\",\"id\":9,\"result\":{}}");
        assertEquals(1, blocks.size());
        assertEquals(1, txs.size());
        assertEquals("tm.event='Tx'", txs.get(0).get("query").asText());
        c.close();
    }
}
