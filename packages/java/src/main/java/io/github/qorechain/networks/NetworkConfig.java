package io.github.qorechain.networks;

/**
 * A fully described QoreChain network preset.
 *
 * <p>The {@code mainnet} and {@code testnet} presets point at the public
 * endpoints; {@code localnet} points at a node on this machine (see
 * {@link Networks}). An endpoint a network does not offer is {@code null}: read
 * it with {@link NetworkEndpoints#require} to get a clear error instead of a
 * silent fallback. {@link #withEndpoints} overrides any of them.
 */
public final class NetworkConfig {

    /** Bech32 human-readable prefixes used across QoreChain address types. */
    public static final class Bech32Prefixes {
        /** Prefix for account addresses (e.g. {@code qor1...}). */
        public final String account;
        /** Prefix for validator operator addresses (e.g. {@code qorvaloper1...}). */
        public final String validator;
        /** Prefix for validator consensus addresses (e.g. {@code qorvalcons1...}). */
        public final String consensus;

        public Bech32Prefixes(String account, String validator, String consensus) {
            this.account = account;
            this.validator = validator;
            this.consensus = consensus;
        }
    }

    /** Display and base denomination metadata for the network's staking coin. */
    public static final class CoinInfo {
        /** Human-facing denomination (e.g. {@code QOR}). */
        public final String display;
        /** Base (smallest) denomination used on-chain (e.g. {@code uqor}). */
        public final String base;
        /** Decimal exponent relating base to display (1 display = 10^exponent base). */
        public final int exponent;

        public CoinInfo(String display, String base, int exponent) {
            this.display = display;
            this.base = base;
            this.exponent = exponent;
        }
    }

    /**
     * Service endpoints for talking to a network across its supported VMs. Any
     * field may be {@code null} when the network offers no public endpoint for
     * it (the public presets set no gRPC and no SVM endpoint, and mainnet no EVM
     * WebSocket).
     */
    public static final class NetworkEndpoints {
        /** Native REST (LCD) endpoint. */
        public final String rest;
        /** Native gRPC endpoint, or {@code null}. */
        public final String grpc;
        /** Consensus RPC endpoint. */
        public final String rpc;
        /** EVM JSON-RPC HTTP endpoint. */
        public final String evmRpc;
        /** EVM JSON-RPC WebSocket endpoint, or {@code null}. */
        public final String evmWs;
        /** SVM JSON-RPC endpoint, or {@code null}. */
        public final String svmRpc;

        public NetworkEndpoints(
                String rest, String grpc, String rpc, String evmRpc, String evmWs, String svmRpc) {
            this.rest = rest;
            this.grpc = grpc;
            this.rpc = rpc;
            this.evmRpc = evmRpc;
            this.evmWs = evmWs;
            this.svmRpc = svmRpc;
        }

        /**
         * These endpoints with every non-null field of {@code overrides} taking
         * precedence. {@code null} overrides keep the current value.
         */
        public NetworkEndpoints merge(NetworkEndpoints overrides) {
            if (overrides == null) {
                return this;
            }
            return new NetworkEndpoints(
                    overrides.rest != null ? overrides.rest : rest,
                    overrides.grpc != null ? overrides.grpc : grpc,
                    overrides.rpc != null ? overrides.rpc : rpc,
                    overrides.evmRpc != null ? overrides.evmRpc : evmRpc,
                    overrides.evmWs != null ? overrides.evmWs : evmWs,
                    overrides.svmRpc != null ? overrides.svmRpc : svmRpc);
        }

        /**
         * The endpoint named {@code field} ({@code rest}, {@code grpc}, {@code rpc},
         * {@code evmRpc}, {@code evmWs} or {@code svmRpc}).
         *
         * @param network the preset name, for the error message (may be {@code null}).
         * @throws IllegalStateException when the endpoint is not configured, naming
         *     the field to pass instead of falling back to a local node.
         */
        public String require(String field, String network) {
            String v;
            switch (field) {
                case "rest": v = rest; break;
                case "grpc": v = grpc; break;
                case "rpc": v = rpc; break;
                case "evmRpc": v = evmRpc; break;
                case "evmWs": v = evmWs; break;
                case "svmRpc": v = svmRpc; break;
                default: throw new IllegalArgumentException("unknown endpoint: " + field);
            }
            if (v == null || v.isEmpty()) {
                String where = network == null ? "this network" : "the " + network + " preset";
                String extra = "svmRpc".equals(field)
                        ? " (SVM transactions are not open on the public networks yet)"
                        : "";
                throw new IllegalStateException(
                        field + " is not configured for " + where + extra + "; pass endpoints " + field
                                + " (or use your own node)");
            }
            return v;
        }
    }

    /** Canonical preset name. */
    public final String name;
    /** Whether the network is live and usable without custom endpoints. */
    public final boolean live;
    /** Chain ID. */
    public final String chainId;
    /** Bech32 prefixes for address encoding. */
    public final Bech32Prefixes bech32;
    /** Staking coin metadata. */
    public final CoinInfo coin;
    /** Default endpoints. */
    public final NetworkEndpoints endpoints;

    public NetworkConfig(
            String name,
            boolean live,
            String chainId,
            Bech32Prefixes bech32,
            CoinInfo coin,
            NetworkEndpoints endpoints) {
        this.name = name;
        this.live = live;
        this.chainId = chainId;
        this.bech32 = bech32;
        this.coin = coin;
        this.endpoints = endpoints;
    }

    /**
     * The endpoint named {@code field}, or a clear error naming it when this
     * network has none (see {@link NetworkEndpoints#require}).
     */
    public String requireEndpoint(String field) {
        return endpoints.require(field, name);
    }

    /** This preset with {@code overrides} applied (non-null fields win). */
    public NetworkConfig withEndpoints(NetworkEndpoints overrides) {
        return new NetworkConfig(name, live, chainId, bech32, coin, endpoints.merge(overrides));
    }
}
