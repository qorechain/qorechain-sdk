package io.github.qorechain.evm;

import io.github.qorechain.address.Address;
import io.github.qorechain.messages.QorechainMessages;
import io.github.qorechain.messages.TypedMessage;
import java.util.Locale;
import java.util.regex.Pattern;
import qorechain.pqc.v1.Tx;

/**
 * Post-quantum consent for EIP-7702 delegations (chain v3.2.2).
 *
 * <p>An EIP-7702 authorization tuple installs code on the account that signed
 * it, with the classical key alone. From v3.2.2 the EVM lane admits a type-4
 * transaction only if every account whose tuple would take effect holds a
 * registered post-quantum key AND has consented, with
 * {@code MsgAuthorizeEVMDelegation} signed by that key, to exactly the delegate
 * the tuple names. Clearing a delegation (the zero address) needs consent too.
 *
 * <p>The order: broadcast {@link #authorize} (it ADVANCES the account's nonce,
 * which is also its Cosmos sequence); read {@code RestClient#evmDelegationConsent},
 * whose {@code nonce} is the EVM nonce now; sign the tuple with that nonce if
 * someone else sponsors the type-4 transaction, or {@code nonce + 1} if the
 * account sends it itself ({@link EvmDelegationConsent#tupleNonce}); send it.
 * The consent is single use, expires after {@code blocks}, is replaced by a new
 * one and revoked by {@code MsgCloseEVMWindow}. {@link #clear} removes an
 * installed delegation without any EVM transaction.
 */
public final class EvmDelegation {
    private EvmDelegation() {}

    /** The longest a consent may wait to be used, in blocks (the window's bound). */
    public static final long MAX_CONSENT_BLOCKS = EvmWindow.MAX_BLOCKS;

    /** The most authorization tuples the EVM lane accepts in one type-4 transaction. */
    public static final int MAX_AUTHORIZATIONS_PER_TX = 8;

    /** The delegate to consent to when the intent is to CLEAR the delegation. */
    public static final String CLEAR = "0x0000000000000000000000000000000000000000";

    /** {@code pqc} 60 - no live consent for the delegation a tuple would install. */
    public static final int ERR_NO_CONSENT = 60;

    /** {@code pqc} 61 - a malformed consent or clear request, or no PQC key. */
    public static final int ERR_INVALID = 61;

    private static final Pattern ADDRESS = Pattern.compile("^0x[0-9a-fA-F]{40}$");

    /** The REST path of the consent query for {@code address} ({@code qor1…} or 0x). */
    public static String restPath(String address) {
        return "/qorechain/pqc/v1/evm_delegation_consent/" + address;
    }

    /**
     * Build a validated {@code MsgAuthorizeEVMDelegation}. The delegate is sent
     * lower-cased: the chain compares case-insensitively, and this keeps the
     * message identical across clients.
     *
     * @throws IllegalArgumentException naming the rule that was violated
     */
    public static TypedMessage authorize(String sender, String delegate, long blocks) {
        validateSender(sender);
        if (delegate == null || !ADDRESS.matcher(delegate).matches()) {
            throw new IllegalArgumentException(
                    "delegate must be a 0x-prefixed 20-byte address (EvmDelegation.CLEAR to consent to"
                            + " clearing), got \"" + delegate + "\"");
        }
        if (blocks < 1 || blocks > MAX_CONSENT_BLOCKS) {
            throw new IllegalArgumentException(
                    "blocks must be between 1 and " + MAX_CONSENT_BLOCKS + ", got " + blocks);
        }
        return QorechainMessages.pqc.authorizeEvmDelegation(
                Tx.MsgAuthorizeEVMDelegation.newBuilder()
                        .setSender(sender)
                        .setDelegate(delegate.toLowerCase(Locale.ROOT))
                        .setBlocks(blocks)
                        .build());
    }

    /** Build a validated {@code MsgClearEVMDelegation}. */
    public static TypedMessage clear(String sender) {
        validateSender(sender);
        return QorechainMessages.pqc.clearEvmDelegation(
                Tx.MsgClearEVMDelegation.newBuilder().setSender(sender).build());
    }

    /** Why the chain refused a delegation. */
    public enum Refusal {
        /** No live consent for that delegate: consent first (again, if it expired or was used). */
        NO_CONSENT,
        /** A malformed consent or clear request, or an account without a PQC key. */
        INVALID
    }

    /**
     * Classify a delegation refusal from its text first (over EVM JSON-RPC only
     * the text arrives), then its code; {@code null} when it is something else.
     */
    public static Refusal classify(int code, String codespace, String message) {
        String lower = message == null ? "" : message.toLowerCase(Locale.ROOT);
        if (lower.contains("no post-quantum consent for this eip-7702 delegation")) {
            return Refusal.NO_CONSENT;
        }
        if (lower.contains("invalid eip-7702 delegation request")) {
            return Refusal.INVALID;
        }
        if ("pqc".equals(codespace)) {
            if (code == ERR_NO_CONSENT) {
                return Refusal.NO_CONSENT;
            }
            if (code == ERR_INVALID) {
                return Refusal.INVALID;
            }
        }
        return null;
    }

    private static void validateSender(String sender) {
        if (sender == null || sender.isEmpty()) {
            throw new IllegalArgumentException("evm delegation: sender is required");
        }
        if (!Address.isValidBech32(sender, "qor")) {
            throw new IllegalArgumentException(
                    "evm delegation: sender \"" + sender + "\" is not a valid qor bech32 address");
        }
    }
}
