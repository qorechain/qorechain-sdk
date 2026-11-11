package io.github.qorechain.evm;

import com.fasterxml.jackson.databind.JsonNode;
import io.github.qorechain.query.RestClient;
import io.github.qorechain.tx.GasLimits;

/**
 * The EVM limits in force (chain v3.2.8), from
 * {@code GET {rest}/qorechain/pqc/v1/evm_limits}.
 *
 * <p>An EVM transaction asking for more gas than {@link #txMaxGas} is refused by the
 * chain (30,000,000 on v3.2.8), and a guarded precompile refuses input larger than
 * {@link #precompileInputMaxBytes}. The answer carries the values in force in its
 * top-level {@code tx_max_gas} / {@code precompile_input_max_bytes}; the
 * {@code limits} object holds what governance set (zero = not set) and is read only
 * when the top-level fields are absent.
 */
public final class EvmLimits {

    /** The REST route. */
    public static final String REST_PATH = "/qorechain/pqc/v1/evm_limits";

    /** The most gas one EVM transaction may ask for. */
    public final long txMaxGas;
    /** The largest input a guarded stateful precompile accepts, in bytes. */
    public final long precompileInputMaxBytes;

    public EvmLimits(long txMaxGas, long precompileInputMaxBytes) {
        this.txMaxGas = txMaxGas;
        this.precompileInputMaxBytes = precompileInputMaxBytes;
    }

    /** Query the limits in force. */
    public static EvmLimits fetch(RestClient rest) {
        return of(rest.get(REST_PATH));
    }

    /**
     * Decode a {@code QueryEVMLimitsResponse} REST body. A {@code tx_max_gas} of 0 (not
     * reported) falls back to {@link GasLimits#DEFAULT_EVM_TX_MAX_GAS}.
     */
    public static EvmLimits of(JsonNode body) {
        if (body == null || body.isNull()) {
            throw new IllegalArgumentException("evm_limits: empty response");
        }
        JsonNode limits = body.get("limits");
        long gas = number(body, "tx_max_gas");
        if (gas == 0) {
            gas = number(limits, "tx_max_gas");
        }
        long input = number(body, "precompile_input_max_bytes");
        if (input == 0) {
            input = number(limits, "precompile_input_max_bytes");
        }
        return new EvmLimits(gas == 0 ? GasLimits.DEFAULT_EVM_TX_MAX_GAS : gas, input);
    }

    /**
     * Refuse an EVM gas limit above {@link #txMaxGas}, before signing.
     *
     * @throws IllegalArgumentException naming the limit and the cap.
     */
    public void checkGasLimit(long gasLimit) {
        GasLimits.checkEvmTxGas(gasLimit, txMaxGas);
    }

    private static long number(JsonNode node, String field) {
        if (node == null || node.isNull()) {
            return 0L;
        }
        JsonNode v = node.get(field);
        if (v == null || v.isNull()) {
            return 0L;
        }
        String s = v.asText().trim();
        if (s.isEmpty()) {
            return 0L;
        }
        try {
            return Long.parseUnsignedLong(s);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("evm_limits: field " + field + " is not an integer: \"" + s + "\"");
        }
    }

    @Override
    public String toString() {
        return "EvmLimits{txMaxGas=" + txMaxGas + ", precompileInputMaxBytes=" + precompileInputMaxBytes + "}";
    }
}
