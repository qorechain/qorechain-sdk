package io.github.qorechain.pqc;

/**
 * The on-chain {@code PQCHybridSignature} TX extension.
 *
 * <p>A plain value object holding the extension's three fields. It is serialized
 * onto the wire as PROTOBUF (via the generated {@code qorechain.pqc.v1.Hybrid.PQCHybridSignature}
 * codec — fields {@code algorithm_id} = 1, {@code pqc_signature} = 2,
 * {@code pqc_public_key} = 3) by
 * {@link io.github.qorechain.tx.HybridTx#encodeHybridExtension}; the encoded
 * {@code Any.value} always begins with byte {@code 0x08}. The chain's ante handler
 * protobuf-decodes this extension. (A prior release JSON-encoded the value, which
 * the chain's tx decoder rejected at CheckTx — the leading JSON open-brace byte
 * {@code 0x7b} was misread as protobuf field 15 {@code start_group}.)
 *
 * <p>{@code pqcPublicKey} is optional (auto-registration on first use) and is
 * omitted from the protobuf message when null or empty.
 */
public final class HybridSignatureExtension {

    public final int algorithmId;
    public final byte[] pqcSignature;
    /** Optional; null when not provided. */
    public final byte[] pqcPublicKey;

    public HybridSignatureExtension(int algorithmId, byte[] pqcSignature, byte[] pqcPublicKey) {
        this.algorithmId = algorithmId;
        this.pqcSignature = pqcSignature;
        this.pqcPublicKey = pqcPublicKey;
    }
}
