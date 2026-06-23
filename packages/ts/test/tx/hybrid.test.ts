import { describe, it, expect } from "vitest";
import { TxBody } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import {
  encodeHybridExtension,
  attachHybridExtension,
} from "../../src/tx/hybrid";
import {
  buildHybridSignatureExtension,
  AlgorithmDilithium5,
  HYBRID_SIG_TYPE_URL,
  ML_DSA_87_SIGNATURE_LENGTH,
  ML_DSA_87_PUBLIC_KEY_LENGTH,
} from "../../src/accounts/pqc";

function sampleExtension() {
  return buildHybridSignatureExtension({
    algorithmId: AlgorithmDilithium5,
    signature: new Uint8Array(ML_DSA_87_SIGNATURE_LENGTH).fill(7),
    publicKey: new Uint8Array(ML_DSA_87_PUBLIC_KEY_LENGTH).fill(3),
  });
}

describe("encodeHybridExtension", () => {
  it("produces an Any with the core type URL", () => {
    const any = encodeHybridExtension(sampleExtension());
    expect(any.typeUrl).toBe(HYBRID_SIG_TYPE_URL);
    expect(any.value).toBeInstanceOf(Uint8Array);
    expect(any.value.length).toBeGreaterThan(0);
  });

  it("encodes the extension as JSON with the core field names and base64 bytes", () => {
    const ext = sampleExtension();
    const any = encodeHybridExtension(ext);
    const decoded = JSON.parse(new TextDecoder().decode(any.value));
    expect(decoded.algorithm_id).toBe(AlgorithmDilithium5);
    // Go json marshals []byte as standard base64.
    const expectedSig = Buffer.from(ext.pqc_signature).toString("base64");
    expect(decoded.pqc_signature).toBe(expectedSig);
    expect(decoded.pqc_public_key).toBe(
      Buffer.from(ext.pqc_public_key as Uint8Array).toString("base64"),
    );
  });

  it("omits pqc_public_key when not provided (matches omitempty)", () => {
    const ext = buildHybridSignatureExtension({
      algorithmId: AlgorithmDilithium5,
      signature: new Uint8Array(ML_DSA_87_SIGNATURE_LENGTH).fill(1),
    });
    const any = encodeHybridExtension(ext);
    const decoded = JSON.parse(new TextDecoder().decode(any.value));
    expect("pqc_public_key" in decoded).toBe(false);
  });
});

describe("attachHybridExtension", () => {
  it("attaches the Any to TxBody.nonCriticalExtensionOptions by default", () => {
    const body = TxBody.fromPartial({
      messages: [],
      memo: "m",
    });
    const out = attachHybridExtension(body, sampleExtension());
    expect(out.nonCriticalExtensionOptions).toHaveLength(1);
    expect(out.nonCriticalExtensionOptions[0].typeUrl).toBe(HYBRID_SIG_TYPE_URL);
    expect(out.extensionOptions).toHaveLength(0);
    // original body untouched (memo preserved)
    expect(out.memo).toBe("m");
  });

  it("can attach to extensionOptions when requested", () => {
    const body = TxBody.fromPartial({ messages: [], memo: "" });
    const out = attachHybridExtension(body, sampleExtension(), {
      placement: "extension_options",
    });
    expect(out.extensionOptions).toHaveLength(1);
    expect(out.extensionOptions[0].typeUrl).toBe(HYBRID_SIG_TYPE_URL);
    expect(out.nonCriticalExtensionOptions).toHaveLength(0);
  });
});
