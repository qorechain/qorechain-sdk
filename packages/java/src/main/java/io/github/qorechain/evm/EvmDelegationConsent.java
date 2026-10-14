package io.github.qorechain.evm;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * An account's EIP-7702 delegation consent (chain v3.2.2), as
 * {@code GET /qorechain/pqc/v1/evm_delegation_consent/{address}} reports it,
 * with what a client needs to sign the matching authorization tuple.
 */
public final class EvmDelegationConsent {
    /** Whether a consent is stored. A stored consent may be expired. */
    public final boolean found;
    /** Whether it can still be used at the current height. */
    public final boolean live;
    /** The 0x address the consent names, lower case; the zero address means clearing. */
    public final String delegate;
    /** The height the consent was recorded at. */
    public final long grantedHeight;
    /** The last height at which it can be used. */
    public final long expiryHeight;
    /** The delegation installed on the account now; empty when there is none. */
    public final String currentDelegate;
    /** The account's EVM nonce now. */
    public final long nonce;

    public EvmDelegationConsent(
            boolean found,
            boolean live,
            String delegate,
            long grantedHeight,
            long expiryHeight,
            String currentDelegate,
            long nonce) {
        this.found = found;
        this.live = live;
        this.delegate = delegate;
        this.grantedHeight = grantedHeight;
        this.expiryHeight = expiryHeight;
        this.currentDelegate = currentDelegate;
        this.nonce = nonce;
    }

    /**
     * The nonce an authorization tuple must carry, from a consent read AFTER the
     * consent message was included: {@code nonce} for a SPONSORED type-4
     * transaction, {@code nonce + 1} for the account's own.
     */
    public long tupleNonce(boolean sponsored) {
        return sponsored ? nonce : nonce + 1;
    }

    /** Decode the REST body. */
    public static EvmDelegationConsent of(JsonNode node) {
        if (node == null || node.isNull()) {
            throw new IllegalArgumentException("evm_delegation_consent: empty response");
        }
        return new EvmDelegationConsent(
                node.path("found").asBoolean(false),
                node.path("live").asBoolean(false),
                node.path("delegate").asText(""),
                number(node, "granted_height"),
                number(node, "expiry_height"),
                node.path("current_delegate").asText(""),
                number(node, "nonce"));
    }

    private static long number(JsonNode node, String field) {
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
            throw new IllegalArgumentException(
                    "evm_delegation_consent: field " + field + " is not an integer: \"" + s + "\"");
        }
    }
}
