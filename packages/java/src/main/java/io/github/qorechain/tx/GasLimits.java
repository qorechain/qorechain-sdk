package io.github.qorechain.tx;

import io.github.qorechain.messages.TypedMessage;
import java.util.List;
import java.util.Set;

/**
 * The gas ceilings the chain enforces (chain v3.2.8), checked before signing.
 *
 * <ul>
 *   <li>A Cosmos-lane transaction may declare at most {@link #MAX_COSMOS_TX_GAS}
 *       (50,000,000) gas. The builders in this package refuse a larger gas limit.
 *   <li>One EVM transaction may ask for at most the chain's EVM gas cap,
 *       {@link #DEFAULT_EVM_TX_MAX_GAS} (30,000,000) on v3.2.8. Read the value in
 *       force with {@link io.github.qorechain.evm.EvmLimits#fetch}.
 *   <li>CosmWasm and cross-VM: the first call of a contract code in a block costs
 *       much more than a repeat (a cw20 transfer about 533k gas, repeats about
 *       84k). Use simulation for such transactions (the SDK's auto gas applies at
 *       least {@link AutoGas#WASM_GAS_MULTIPLIER}) or give an explicit gas limit;
 *       never a fixed guess.
 * </ul>
 */
public final class GasLimits {

    private GasLimits() {}

    /** The largest gas limit a Cosmos-lane transaction may declare (chain v3.2.8). */
    public static final long MAX_COSMOS_TX_GAS = 50_000_000L;

    /** The chain's EVM per-transaction gas cap on v3.2.8, used when not queried. */
    public static final long DEFAULT_EVM_TX_MAX_GAS = 30_000_000L;

    /** Message types whose gas depends on CosmWasm execution (first call in a block costs more). */
    public static final Set<String> WASM_OR_CROSSVM_TYPE_URLS =
            Set.of(
                    "/cosmwasm.wasm.v1.MsgExecuteContract",
                    "/cosmwasm.wasm.v1.MsgInstantiateContract",
                    "/cosmwasm.wasm.v1.MsgInstantiateContract2",
                    "/cosmwasm.wasm.v1.MsgMigrateContract",
                    "/qorechain.crossvm.v1.MsgCrossVMCall");

    /**
     * Refuse a Cosmos-lane gas limit above {@link #MAX_COSMOS_TX_GAS}.
     *
     * @throws IllegalArgumentException naming the limit.
     */
    public static void checkCosmosTxGas(long gasLimit) {
        if (gasLimit < 0 || gasLimit > MAX_COSMOS_TX_GAS) {
            throw new IllegalArgumentException(
                    "gas limit " + Long.toUnsignedString(gasLimit) + " is above the chain's Cosmos"
                            + " transaction cap of " + MAX_COSMOS_TX_GAS + " (from chain v3.2.8)");
        }
    }

    /** {@link #checkCosmosTxGas(long)} for a decimal gas string as carried by {@link StdFee}. */
    public static long checkCosmosTxGas(String gas) {
        long g = Long.parseLong(gas);
        checkCosmosTxGas(g);
        return g;
    }

    /**
     * Refuse an EVM gas limit above {@code cap} ({@link #DEFAULT_EVM_TX_MAX_GAS} when
     * {@code cap <= 0}).
     *
     * @throws IllegalArgumentException naming the limit and the cap.
     */
    public static void checkEvmTxGas(long gasLimit, long cap) {
        long c = cap <= 0 ? DEFAULT_EVM_TX_MAX_GAS : cap;
        if (gasLimit < 0 || gasLimit > c) {
            throw new IllegalArgumentException(
                    "EVM gas limit " + Long.toUnsignedString(gasLimit) + " is above the chain's EVM"
                            + " transaction gas cap of " + c + "; the chain refuses it");
        }
    }

    /** {@link #checkEvmTxGas(long, long)} against {@link #DEFAULT_EVM_TX_MAX_GAS}. */
    public static void checkEvmTxGas(long gasLimit) {
        checkEvmTxGas(gasLimit, DEFAULT_EVM_TX_MAX_GAS);
    }

    /** Whether any of {@code messages} runs CosmWasm (execute/instantiate/migrate) or is a cross-VM call. */
    public static boolean carriesWasmOrCrossVm(List<TypedMessage> messages) {
        if (messages == null) {
            return false;
        }
        for (TypedMessage m : messages) {
            if (m != null && WASM_OR_CROSSVM_TYPE_URLS.contains(m.typeUrl)) {
                return true;
            }
        }
        return false;
    }
}
