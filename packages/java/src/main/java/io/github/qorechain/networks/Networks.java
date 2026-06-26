package io.github.qorechain.networks;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Built-in QoreChain network presets.
 *
 * <p>{@code testnet} is {@code qorechain-diana} and {@code mainnet} is
 * {@code qorechain-vladi}; both are live and share the {@code qor}/{@code uqor}
 * coin and bech32 prefixes. Endpoints default to localhost ports.
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

    private static NetworkConfig.NetworkEndpoints localhostEndpoints() {
        return new NetworkConfig.NetworkEndpoints(
                "http://localhost:1317",
                "http://localhost:9090",
                "http://localhost:26657",
                "http://localhost:8545",
                "ws://localhost:8546",
                "http://localhost:8899");
    }

    private static final Map<String, NetworkConfig> NETWORKS;

    static {
        Map<String, NetworkConfig> m = new LinkedHashMap<>();
        m.put(
                "testnet",
                new NetworkConfig(
                        "testnet", true, "qorechain-diana", BECH32, COIN, localhostEndpoints()));
        m.put(
                "mainnet",
                new NetworkConfig(
                        "mainnet", true, "qorechain-vladi", BECH32, COIN, localhostEndpoints()));
        NETWORKS = Collections.unmodifiableMap(m);
    }

    /**
     * Resolve a network preset by name ({@code "testnet"} or {@code "mainnet"}).
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

    /** List the known network preset names. */
    public static List<String> list() {
        return List.copyOf(NETWORKS.keySet());
    }
}
