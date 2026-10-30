package io.github.qorechain.networks;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Built-in QoreChain network presets.
 *
 * <ul>
 *   <li>{@code mainnet}: chain {@code qorechain-vladi} (EVM chain id 9801), public
 *       REST, RPC and EVM JSON-RPC endpoints. No gRPC, EVM WebSocket or SVM
 *       endpoint is preset ({@code null}).
 *   <li>{@code testnet}: chain {@code qorechain-diana} (EVM chain id 9800), public
 *       REST, RPC, EVM JSON-RPC and EVM WebSocket endpoints. No gRPC or SVM
 *       endpoint is preset. The public testnet endpoints have a per-IP rate limit
 *       at the edge.
 *   <li>{@code localnet}: a node on this machine on the default ports (chain
 *       {@code qorechain-devnet}), the endpoints the other presets used before
 *       0.12.0.
 * </ul>
 *
 * <p>SVM transactions are not open on either public network, so no SVM endpoint
 * is preset. For production traffic run or use your own node and pass its
 * endpoints ({@link NetworkConfig#withEndpoints}). The file
 * {@code https://download.qore.host/<net>/latest.json} is a manifest (version,
 * peers, state sync), not an endpoint. Every hostname lives in {@link #ENDPOINTS}
 * and nowhere else in the code.
 */
public final class Networks {

    private Networks() {}

    /**
     * QoreChain uses the same token and address prefixes on every network, so
     * these are shared values across the presets.
     */
    private static final NetworkConfig.Bech32Prefixes BECH32 =
            new NetworkConfig.Bech32Prefixes("qor", "qorvaloper", "qorvalcons");

    private static final NetworkConfig.CoinInfo COIN =
            new NetworkConfig.CoinInfo("QOR", "uqor", 6);

    /**
     * The one table of preset endpoints: rest, grpc, rpc, evmRpc, evmWs, svmRpc.
     * {@code null} = the network offers no public endpoint for it.
     */
    private static final Map<String, NetworkConfig.NetworkEndpoints> ENDPOINTS = Map.of(
            "mainnet",
            new NetworkConfig.NetworkEndpoints(
                    "https://api.qore.host",
                    null,
                    "https://rpc.qore.host",
                    "https://evm.qore.host",
                    null,
                    null),
            "testnet",
            new NetworkConfig.NetworkEndpoints(
                    "https://api-testnet.qore.host",
                    null,
                    "https://rpc-testnet.qore.host",
                    "https://evm-testnet.qore.host",
                    "wss://evm-ws-testnet.qore.host",
                    null),
            "localnet",
            new NetworkConfig.NetworkEndpoints(
                    "http://localhost:1317",
                    "http://localhost:9090",
                    "http://localhost:26657",
                    "http://localhost:8545",
                    "ws://localhost:8546",
                    "http://localhost:8899"));

    /** EVM chain id of mainnet ({@code qorechain-vladi}). */
    public static final long MAINNET_EVM_CHAIN_ID = 9801L;

    /** EVM chain id of the testnet ({@code qorechain-diana}). */
    public static final long TESTNET_EVM_CHAIN_ID = 9800L;

    private static final Map<String, NetworkConfig> NETWORKS;

    static {
        Map<String, NetworkConfig> m = new LinkedHashMap<>();
        m.put("testnet", preset("testnet", "qorechain-diana"));
        m.put("mainnet", preset("mainnet", "qorechain-vladi"));
        m.put("localnet", preset("localnet", "qorechain-devnet"));
        NETWORKS = Collections.unmodifiableMap(m);
    }

    private static NetworkConfig preset(String name, String chainId) {
        return new NetworkConfig(name, true, chainId, BECH32, COIN, ENDPOINTS.get(name));
    }

    /**
     * Resolve a network preset by name ({@code "mainnet"}, {@code "testnet"} or
     * {@code "localnet"}).
     *
     * @throws IllegalArgumentException if the name is unknown.
     */
    public static NetworkConfig get(String name) {
        NetworkConfig cfg = NETWORKS.get(name);
        if (cfg == null) {
            throw new IllegalArgumentException("unknown network: " + name);
        }
        return cfg;
    }

    /**
     * A preset with explicit endpoint overrides: every non-null field of
     * {@code overrides} replaces the preset's value.
     */
    public static NetworkConfig get(String name, NetworkConfig.NetworkEndpoints overrides) {
        return get(name).withEndpoints(overrides);
    }

    /** List the known network preset names. */
    public static List<String> list() {
        return List.copyOf(NETWORKS.keySet());
    }
}
