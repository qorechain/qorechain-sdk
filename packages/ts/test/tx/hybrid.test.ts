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
import { PQCHybridSignature as PQCHybridSignatureProto } from "../../src/codegen/qorechain/pqc/v1/hybrid";

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

  it("proto-encodes the value (starts with 0x08, never the 0x7b JSON '{' the chain rejects)", () => {
    // Regression: a prior release JSON-encoded this extension, so Any.value
    // began with 0x7b ('{'), which the chain's tx decoder misreads as field 15
    // `start_group` and rejects at CheckTx. The protobuf encoding begins with
    // the field-1 varint tag (0x08).
    const any = encodeHybridExtension(sampleExtension());
    expect(any.value[0]).toBe(0x08);
    expect(any.value[0]).not.toBe(0x7b);
  });

  it("round-trips through the generated PQCHybridSignature codec", () => {
    const ext = sampleExtension();
    const any = encodeHybridExtension(ext);
    const decoded = PQCHybridSignatureProto.decode(any.value);
    expect(decoded.algorithmId).toBe(AlgorithmDilithium5);
    expect(Array.from(decoded.pqcSignature)).toEqual(
      Array.from(ext.pqc_signature),
    );
    expect(Array.from(decoded.pqcPublicKey)).toEqual(
      Array.from(ext.pqc_public_key as Uint8Array),
    );
  });

  it("encodes an absent pqc_public_key as a zero-length proto field", () => {
    const ext = buildHybridSignatureExtension({
      algorithmId: AlgorithmDilithium5,
      signature: new Uint8Array(ML_DSA_87_SIGNATURE_LENGTH).fill(1),
    });
    const any = encodeHybridExtension(ext);
    expect(any.value[0]).toBe(0x08);
    const decoded = PQCHybridSignatureProto.decode(any.value);
    expect(decoded.pqcPublicKey.length).toBe(0);
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

  it("survives a TxBody encode→decode round-trip with a 0x08-prefixed proto value", () => {
    const body = attachHybridExtension(
      TxBody.fromPartial({ messages: [], memo: "" }),
      sampleExtension(),
      { placement: "extension_options" },
    );
    const roundTripped = TxBody.decode(TxBody.encode(body).finish());
    const ext = roundTripped.extensionOptions[0];
    expect(ext.typeUrl).toBe(HYBRID_SIG_TYPE_URL);
    expect(ext.value[0]).toBe(0x08);
    expect(ext.value[0]).not.toBe(0x7b);
    const decoded = PQCHybridSignatureProto.decode(ext.value);
    expect(decoded.algorithmId).toBe(AlgorithmDilithium5);
    expect(decoded.pqcSignature.length).toBe(ML_DSA_87_SIGNATURE_LENGTH);
  });
});
