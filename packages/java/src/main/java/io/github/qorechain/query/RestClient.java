package io.github.qorechain.query;

import com.fasterxml.jackson.databind.JsonNode;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * REST (LCD) client for the Cosmos SDK routes plus QoreChain's custom REST
 * routes. Point it at the network's {@code rest} endpoint.
 *
 * <p>Covers the standard bank balance routes, the 8 custom QoreChain routes, the
 * tx/block lookup routes, and a generic {@link #get} escape hatch for any path.
 */
public final class RestClient {

    private final String baseUrl;
    private final Http.Options options;

    public RestClient(String baseUrl) {
        this(baseUrl, new Http.Options());
    }

    public RestClient(String baseUrl, Http.Options options) {
        this.baseUrl = baseUrl;
        this.options = options;
    }

    private static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8);
    }

    /** Generic GET against an arbitrary path (with optional query). */
    public JsonNode get(String path, Map<String, String> query) {
        return Http.getJson(Http.joinUrl(baseUrl, path), query, options);
    }

    public JsonNode get(String path) {
        return get(path, null);
    }

    // ---- standard Cosmos bank ----

    /** {@code /cosmos/bank/v1beta1/balances/{address}}. */
    public JsonNode getAllBalances(String address) {
        return get("/cosmos/bank/v1beta1/balances/" + enc(address));
    }

    /** {@code /cosmos/bank/v1beta1/balances/{address}/by_denom?denom={denom}}. */
    public JsonNode getBalance(String address, String denom) {
        Map<String, String> q = Http.query();
        q.put("denom", denom);
        return get("/cosmos/bank/v1beta1/balances/" + enc(address) + "/by_denom", q);
    }

    // ---- 8 custom QoreChain routes ----

    /** {@code /qorechain/ai/v1/stats}. */
    public JsonNode getAiStats() {
        return get("/qorechain/ai/v1/stats");
    }

    /** {@code /qorechain/ai/v1/fee-estimate?urgency={urgency}}. */
    public JsonNode getFeeEstimate(String urgency) {
        Map<String, String> q = Http.query();
        q.put("urgency", urgency);
        return get("/qorechain/ai/v1/fee-estimate", q);
    }

    /** {@code /qorechain/bridge/v1/chains}. */
    public JsonNode getBridgeChains() {
        return get("/qorechain/bridge/v1/chains");
    }

    /** {@code /qorechain/pqc/v1/accounts/{address}}. */
    public JsonNode getPqcAccount(String address) {
        return get("/qorechain/pqc/v1/accounts/" + enc(address));
    }

    /** {@code /qorechain/reputation/v1/validators/{address}}. */
    public JsonNode getReputation(String validatorAddress) {
        return get("/qorechain/reputation/v1/validators/" + enc(validatorAddress));
    }

    /** {@code /qorechain/burn/v1/stats}. */
    public JsonNode getBurnStats() {
        return get("/qorechain/burn/v1/stats");
    }

    /** {@code /qorechain/xqore/v1/position/{address}}. */
    public JsonNode getXqorePosition(String address) {
        return get("/qorechain/xqore/v1/position/" + enc(address));
    }

    /** {@code /qorechain/inflation/v1/rate}. */
    public JsonNode getInflationRate() {
        return get("/qorechain/inflation/v1/rate");
    }

    // ---- tx / block lookup + search ----

    /** {@code /cosmos/tx/v1beta1/txs/{hash}}. */
    public JsonNode getTx(String hash) {
        return get("/cosmos/tx/v1beta1/txs/" + enc(hash));
    }

    /** {@code /cosmos/base/tendermint/v1beta1/blocks/{height}}. */
    public JsonNode getBlock(long height) {
        return get("/cosmos/base/tendermint/v1beta1/blocks/" + height);
    }

    /** {@code /cosmos/base/tendermint/v1beta1/blocks/latest}. */
    public JsonNode getLatestBlock() {
        return get("/cosmos/base/tendermint/v1beta1/blocks/latest");
    }

    /** {@code /cosmos/tx/v1beta1/txs?events=...} — search by event query. */
    public JsonNode searchTxs(String eventsQuery, Integer limit, String orderBy) {
        Map<String, String> q = Http.query();
        q.put("events", eventsQuery);
        if (limit != null) {
            q.put("pagination.limit", String.valueOf(limit));
        }
        if ("asc".equals(orderBy)) {
            q.put("order_by", "ORDER_BY_ASC");
        } else if ("desc".equals(orderBy)) {
            q.put("order_by", "ORDER_BY_DESC");
        }
        return get("/cosmos/tx/v1beta1/txs", q);
    }
}
