package io.github.qorechain.evm;

import com.fasterxml.jackson.databind.JsonNode;
import io.github.qorechain.query.JsonRpcClient;
import io.github.qorechain.utils.Hashing;
import io.github.qorechain.utils.Hex;
import java.math.BigInteger;
import java.util.Arrays;

/**
 * Typed bindings for QoreChain's AI EVM precompiles — an on-chain "pre-flight"
 * surface usable from any EVM/JSON-RPC client via {@code eth_call}.
 *
 * <p>Each helper hand-encodes the call data (4-byte selector +
 * head/tail-encoded ABI arguments), issues an {@code eth_call} against the fixed
 * precompile address through {@link JsonRpcClient}, and decodes the returned
 * 32-byte ABI words.
 *
 * <p>Availability note: on a default or community node these precompiles may
 * return a "not available" error; they are available on QoreChain network nodes.
 * Handle a thrown {@link JsonRpcClient.JsonRpcException} from any of these as
 * "feature not present on this node".
 *
 * <p>The scores returned here are <strong>advisory</strong>: they are a
 * client-side aid for risk-aware UX and do not, by themselves, gate or alter
 * on-chain execution.
 */
public final class EvmPrecompiles {

    private EvmPrecompiles() {}

    // ---- Fixed precompile addresses (matching the chain's published registrations) ----

    /** AI transaction risk score precompile ({@code aiRiskScore(bytes)}). */
    public static final String AI_RISK_SCORE_ADDRESS =
            "0x0000000000000000000000000000000000000B01";

    /** AI anomaly check precompile ({@code aiAnomalyCheck(address,uint256)}). */
    public static final String AI_ANOMALY_CHECK_ADDRESS =
            "0x0000000000000000000000000000000000000B02";

    // ---- Result types ----

    /** Result of {@link #aiRiskScore}. */
    public static final class RiskScore {
        public final BigInteger score;
        public final int level;

        public RiskScore(BigInteger score, int level) {
            this.score = score;
            this.level = level;
        }
    }

    /** Result of {@link #aiAnomalyCheck}. */
    public static final class Anomaly {
        public final BigInteger anomalyScore;
        public final boolean flagged;

        public Anomaly(BigInteger anomalyScore, boolean flagged) {
            this.anomalyScore = anomalyScore;
            this.flagged = flagged;
        }
    }

    /** Input to {@link #simulateWithRiskScore}. */
    public static final class PreflightTx {
        /** Sender address ({@code 0x}-hex), used for gas estimation and the anomaly check. */
        public String from;
        /** Target contract / recipient address ({@code 0x}-hex). */
        public String to;
        /** Raw call data ({@code 0x}-hex), used for gas estimation and the risk score. */
        public String data;
        /** Value in wei, used for gas estimation and as the anomaly-check amount. */
        public BigInteger value = BigInteger.ZERO;
    }

    /** Result of {@link #simulateWithRiskScore}: combined gas + advisory AI checks. */
    public static final class Preflight {
        public final long gas;
        public final RiskScore risk;
        public final Anomaly anomaly;
        /** Advisory verdict: {@code risk.level < 3 && !anomaly.flagged}. */
        public final boolean safe;

        public Preflight(long gas, RiskScore risk, Anomaly anomaly, boolean safe) {
            this.gas = gas;
            this.risk = risk;
            this.anomaly = anomaly;
            this.safe = safe;
        }
    }

    // ---- Precompile calls ----

    /**
     * Compute an advisory on-chain risk score for raw transaction data.
     *
     * <p>ABI: {@code aiRiskScore(bytes) returns (uint256 score, uint8 level)}.
     */
    public static RiskScore aiRiskScore(JsonRpcClient client, byte[] txData) {
        byte[] data = encodeRiskScoreCall(txData);
        byte[] ret = ethCall(client, AI_RISK_SCORE_ADDRESS, data);
        BigInteger score = word(ret, 0);
        int level = word(ret, 1).intValueExact();
        return new RiskScore(score, level);
    }

    /**
     * Check whether a {@code (sender, amount)} pair is anomalous (advisory).
     *
     * <p>ABI: {@code aiAnomalyCheck(address,uint256) returns (uint256
     * anomalyScore, bool flagged)}.
     */
    public static Anomaly aiAnomalyCheck(JsonRpcClient client, String sender, BigInteger amount) {
        byte[] data = encodeAnomalyCheckCall(sender, amount);
        byte[] ret = ethCall(client, AI_ANOMALY_CHECK_ADDRESS, data);
        BigInteger anomalyScore = word(ret, 0);
        boolean flagged = word(ret, 1).signum() != 0;
        return new Anomaly(anomalyScore, flagged);
    }

    /**
     * Pre-flight a transaction: estimate gas ({@code eth_estimateGas}) and run
     * both advisory AI precompiles, returning a combined verdict.
     *
     * <p>The {@code safe} flag is advisory only ({@code risk.level < 3 &&
     * !anomaly.flagged}); it does not gate on-chain execution.
     */
    public static Preflight simulateWithRiskScore(JsonRpcClient client, PreflightTx tx) {
        BigInteger value = tx.value == null ? BigInteger.ZERO : tx.value;
        byte[] callData = tx.data == null ? new byte[0] : Hex.decode(tx.data);

        JsonNode gasNode =
                client.ethEstimateGas(
                        tx.to, tx.data, tx.from, "0x" + value.toString(16));
        long gas = parseHexLong(gasNode.asText());

        RiskScore risk = aiRiskScore(client, callData);
        Anomaly anomaly = aiAnomalyCheck(client, tx.from, value);
        boolean safe = risk.level < 3 && !anomaly.flagged;
        return new Preflight(gas, risk, anomaly, safe);
    }

    // ---- ABI encoding (hand-rolled) ----

    /** 4-byte selector = keccak256(signature)[0..4]. */
    public static byte[] selector(String signature) {
        byte[] h = Hashing.keccak256(signature);
        return Arrays.copyOfRange(h, 0, 4);
    }

    /** Encode {@code aiRiskScore(bytes)}: dynamic bytes at offset 0x20. */
    public static byte[] encodeRiskScoreCall(byte[] txData) {
        byte[] sel = selector("aiRiskScore(bytes)");
        byte[] offset = leftPad32(BigInteger.valueOf(0x20));
        byte[] length = leftPad32(BigInteger.valueOf(txData.length));
        byte[] body = rightPad32(txData);
        return concat(sel, offset, length, body);
    }

    /** Encode {@code aiAnomalyCheck(address,uint256)}: padded address + uint256. */
    public static byte[] encodeAnomalyCheckCall(String sender, BigInteger amount) {
        byte[] sel = selector("aiAnomalyCheck(address,uint256)");
        byte[] addr = encodeAddress(sender);
        byte[] amt = leftPad32(amount);
        return concat(sel, addr, amt);
    }

    /** 20-byte address left-padded to a 32-byte word. */
    public static byte[] encodeAddress(String address) {
        byte[] raw = Hex.decode(address);
        if (raw.length != 20) {
            throw new IllegalArgumentException(
                    "address must be 20 bytes, got " + raw.length + ": " + address);
        }
        byte[] word = new byte[32];
        System.arraycopy(raw, 0, word, 12, 20);
        return word;
    }

    /** Big-endian unsigned 32-byte left-pad of a non-negative integer. */
    public static byte[] leftPad32(BigInteger v) {
        if (v.signum() < 0) {
            throw new IllegalArgumentException("value must be non-negative: " + v);
        }
        byte[] be = v.toByteArray();
        // Strip a possible leading zero sign byte.
        if (be.length > 1 && be[0] == 0) {
            be = Arrays.copyOfRange(be, 1, be.length);
        }
        if (be.length > 32) {
            throw new IllegalArgumentException("value exceeds 32 bytes: " + v);
        }
        byte[] word = new byte[32];
        System.arraycopy(be, 0, word, 32 - be.length, be.length);
        return word;
    }

    /** Right-pad bytes to a multiple of 32 (dynamic-bytes tail encoding). */
    public static byte[] rightPad32(byte[] data) {
        int padded = ((data.length + 31) / 32) * 32;
        byte[] out = new byte[padded];
        System.arraycopy(data, 0, out, 0, data.length);
        return out;
    }

    // ---- ABI decoding ----

    /** Extract the {@code index}-th 32-byte word as an unsigned BigInteger. */
    public static BigInteger word(byte[] ret, int index) {
        int off = index * 32;
        if (ret.length < off + 32) {
            throw new IllegalArgumentException(
                    "return data too short: need word " + index + ", have " + ret.length + " bytes");
        }
        byte[] w = Arrays.copyOfRange(ret, off, off + 32);
        return new BigInteger(1, w);
    }

    // ---- internals ----

    private static byte[] ethCall(JsonRpcClient client, String to, byte[] data) {
        JsonNode res = client.ethCall(to, Hex.encodePrefixed(data));
        return Hex.decode(res.asText());
    }

    private static long parseHexLong(String hex) {
        return new BigInteger(Hex.strip0x(hex), 16).longValueExact();
    }

    private static byte[] concat(byte[]... parts) {
        int n = 0;
        for (byte[] p : parts) {
            n += p.length;
        }
        byte[] out = new byte[n];
        int pos = 0;
        for (byte[] p : parts) {
            System.arraycopy(p, 0, out, pos, p.length);
            pos += p.length;
        }
        return out;
    }
}
