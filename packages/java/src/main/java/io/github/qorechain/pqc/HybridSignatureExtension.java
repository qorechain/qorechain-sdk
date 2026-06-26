package io.github.qorechain.pqc;

import java.util.Base64;

/**
 * The on-chain {@code PQCHybridSignature} TX extension.
 *
 * <p>Serializes to the exact Go-JSON the chain's ante handler decodes:
 *
 * <pre>{@code
 * { "algorithm_id": 1,
 *   "pqc_signature": "<std-base64>",
 *   "pqc_public_key"?: "<std-base64>" }
 * }</pre>
 *
 * Go marshals {@code []byte} fields as standard (padded) base64 strings, emits
 * {@code algorithm_id} as a JSON number, and omits {@code pqc_public_key}
 * entirely when empty ({@code omitempty}).
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

    /** Serialize to the Go-JSON the chain reads. Field order matches Go's struct order. */
    public String toJson() {
        StringBuilder sb = new StringBuilder();
        sb.append("{\"algorithm_id\":").append(algorithmId);
        sb.append(",\"pqc_signature\":\"").append(base64(pqcSignature)).append('"');
        if (pqcPublicKey != null && pqcPublicKey.length > 0) {
            sb.append(",\"pqc_public_key\":\"").append(base64(pqcPublicKey)).append('"');
        }
        sb.append('}');
        return sb.toString();
    }

    private static String base64(byte[] bytes) {
        return Base64.getEncoder().encodeToString(bytes);
    }
}
