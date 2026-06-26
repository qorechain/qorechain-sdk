package io.github.qorechain.networks;

/**
 * A fully described QoreChain network preset.
 *
 * <p>Both the {@code testnet} and {@code mainnet} presets are live. Their
 * endpoints default to localhost ports so the SDK works out of the box against a
 * locally running node; callers override these with real hostnames when creating
 * a client.
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

    /** Service endpoints for talking to a network across its supported VMs. */
    public static final class NetworkEndpoints {
        /** Cosmos SDK REST (LCD) endpoint. */
        public final String rest;
        /** Cosmos SDK gRPC endpoint. */
        public final String grpc;
        /** Consensus RPC endpoint. */
        public final String rpc;
        /** EVM JSON-RPC HTTP endpoint. */
        public final String evmRpc;
        /** EVM JSON-RPC WebSocket endpoint. */
        public final String evmWs;
        /** SVM JSON-RPC endpoint. */
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
}
