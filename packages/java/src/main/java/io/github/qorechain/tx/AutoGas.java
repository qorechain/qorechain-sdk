package io.github.qorechain.tx;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.qorechain.query.ChainUpgrades;
import io.github.qorechain.query.Http;
import io.github.qorechain.query.RestClient;
import java.util.Base64;
import java.util.Map;

/**
 * Gas limits from a simulation.
 *
 * <p>{@link #simulate} runs a signed transaction through the node's
 * {@code /cosmos/tx/v1beta1/simulate} endpoint and reads {@code gas_used}.
 * {@link #gasWanted} turns that into the gas limit to sign:
 *
 * <ul>
 *   <li>A hybrid-signed native-lane transaction on a network that has applied
 *       chain {@code v3.2.5}: {@link #exactHybridGas}, {@code ceil(simulated * 1.02) + 2000}.
 *       From v3.2.5 the simulation already charges the post-quantum verification
 *       (once per signer), so only a small margin is added.
 *   <li>Everything else (an older network, a classical transaction, or a network
 *       that could not be asked): {@code ceil(simulated * 1.4)}
 *       ({@link GasPrice#DEFAULT_GAS_MULTIPLIER}).
 *   <li>A multiplier the caller passes is applied as given:
 *       {@code ceil(simulated * multiplier)}.
 * </ul>
 *
 * <p>Native-lane transactions pay the full fee for their gas limit (gas limit x
 * gas price), so a smaller margin is a smaller fee.
 */
public final class AutoGas {

    private AutoGas() {}

    /** The margin over a v3.2.5 simulation for a hybrid transaction. */
    public static final double EXACT_GAS_MULTIPLIER = 1.02;

    /** The fixed headroom added after {@link #EXACT_GAS_MULTIPLIER}. */
    public static final long EXACT_GAS_HEADROOM = 2000L;

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** A simulation and the gas limit chosen from it. */
    public static final class Estimate {
        /** {@code gas_used} reported by the simulation. */
        public final long simulatedGas;
        /** The gas limit to sign. */
        public final long gasWanted;
        /** Whether the v3.2.5 exact rule chose {@link #gasWanted}. */
        public final boolean exact;

        public Estimate(long simulatedGas, long gasWanted, boolean exact) {
            this.simulatedGas = simulatedGas;
            this.gasWanted = gasWanted;
            this.exact = exact;
        }
    }

    /** {@code ceil(simulated * 1.02) + 2000}, in integer arithmetic. */
    public static long exactHybridGas(long simulated) {
        if (simulated < 0) {
            throw new IllegalArgumentException("simulated gas must be non-negative");
        }
        return Math.ceilDiv(Math.multiplyExact(simulated, 102L), 100L) + EXACT_GAS_HEADROOM;
    }

    /**
     * The gas limit for a simulation result.
     *
     * @param simulated {@code gas_used} from the simulation.
     * @param hybrid whether the transaction is hybrid-signed.
     * @param exactNetwork whether the network has applied v3.2.5 ({@link #exactGasApplies}).
     * @param multiplier an explicit multiplier, or {@code null} for the default rule.
     */
    public static long gasWanted(long simulated, boolean hybrid, boolean exactNetwork, Double multiplier) {
        if (multiplier != null) {
            return GasPrice.applyMultiplier(simulated, multiplier);
        }
        if (hybrid && exactNetwork) {
            return exactHybridGas(simulated);
        }
        return GasPrice.applyMultiplier(simulated, GasPrice.DEFAULT_GAS_MULTIPLIER);
    }

    /**
     * Whether the network behind {@code restUrl} has applied chain v3.2.5, from the
     * cached {@code applied_plan} lookup ({@link ChainUpgrades}, keyed per REST
     * endpoint). A lookup that fails reads as {@code false}: the older rule
     * over-provisions gas, which still lands.
     */
    public static boolean exactGasApplies(String restUrl) {
        if (restUrl == null || restUrl.isEmpty()) {
            return false;
        }
        String key = restUrl.replaceAll("/+$", "");
        try {
            return ChainUpgrades.isApplied(new RestClient(key), ChainUpgrades.V3_2_5, key);
        } catch (RuntimeException e) {
            return false;
        }
    }

    /**
     * Simulate signed {@code txBytes} and return {@code gas_used}.
     *
     * @throws TxError.QoreTxException when the chain refuses the transaction with
     *     a registered error it names in text only.
     * @throws Http.QoreHttpException for any other failed response.
     */
    public static long simulate(String restUrl, byte[] txBytes, Http.Options options) {
        if (restUrl == null || restUrl.isEmpty()) {
            throw new IllegalStateException("simulation needs the network's REST endpoint (restUrl)");
        }
        String url = Http.joinUrl(restUrl, "/cosmos/tx/v1beta1/simulate");
        JsonNode res;
        try {
            res = Http.postJson(
                    url,
                    Map.of("tx_bytes", Base64.getEncoder().encodeToString(txBytes)),
                    options == null ? new Http.Options() : options);
        } catch (Http.QoreHttpException e) {
            String text = simulationText(e.body);
            if (TxError.errorFromText(text) != null) {
                throw TxError.decode(0, null, text, null);
            }
            throw e;
        }
        JsonNode used = res == null ? null : res.path("gas_info").get("gas_used");
        if (used == null || used.isNull() || used.asText().isEmpty()) {
            throw new IllegalStateException("simulate response has no gas_info.gas_used: " + res);
        }
        return Long.parseLong(used.asText());
    }

    /** Simulate and choose the gas limit for the network behind {@code restUrl}. */
    public static Estimate estimate(
            String restUrl, byte[] txBytes, boolean hybrid, Double multiplier, Http.Options options) {
        long simulated = simulate(restUrl, txBytes, options);
        boolean exact = multiplier == null && hybrid && exactGasApplies(restUrl);
        return new Estimate(simulated, gasWanted(simulated, hybrid, exact, multiplier), exact);
    }

    /** The refusal text of a failed simulate response: its {@code message}, else the body. */
    static String simulationText(String body) {
        if (body == null) {
            return "";
        }
        try {
            JsonNode n = MAPPER.readTree(body);
            JsonNode m = n == null ? null : n.get("message");
            if (m != null && m.isTextual()) {
                return m.asText();
            }
        } catch (Exception ignored) {
            // not JSON: use the body
        }
        return body;
    }
}
