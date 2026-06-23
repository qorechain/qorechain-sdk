import { describe, it, expect } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import {
  AlgorithmDilithium5,
  HYBRID_SIG_TYPE_URL,
  generatePqcKeypair,
  pqcSign,
  pqcVerify,
  buildHybridSignatureExtension,
  PqcSigner,
  HybridSigner,
  ML_DSA_87_PUBLIC_KEY_LENGTH,
  ML_DSA_87_SECRET_KEY_LENGTH,
  ML_DSA_87_SIGNATURE_LENGTH,
} from "../../src/accounts/pqc";
import type { Signer } from "../../src/accounts/signer";

const msg = new TextEncoder().encode("transaction body bytes");

/** A minimal classical secp256k1 signer for hybrid tests (no real Tx assembly). */
function makeClassicalSigner(): {
  signer: Signer;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
} {
  const privateKey = secp256k1.utils.randomPrivateKey();
  const publicKey = secp256k1.getPublicKey(privateKey, true);
  const signer: Signer = {
    mode: "classical",
    publicKey: () => publicKey,
    sign: (m) => ({
      classicalSignature: secp256k1
        .sign(sha256(m), privateKey)
        .toCompactRawBytes(),
    }),
  };
  return { signer, privateKey, publicKey };
}

function verifyClassical(
  pubkey: Uint8Array,
  m: Uint8Array,
  sig: Uint8Array,
): boolean {
  return secp256k1.verify(sig, sha256(m), pubkey);
}

describe("ML-DSA-87 key generation", () => {
  it("library constants match the documented Dilithium-5 sizes", () => {
    expect(ML_DSA_87_PUBLIC_KEY_LENGTH).toBe(2592);
    expect(ML_DSA_87_SECRET_KEY_LENGTH).toBe(4896);
    expect(ML_DSA_87_SIGNATURE_LENGTH).toBe(4627);
  });

  it("generatePqcKeypair() returns correctly sized public/secret keys", () => {
    const kp = generatePqcKeypair();
    expect(kp.publicKey).toBeInstanceOf(Uint8Array);
    expect(kp.secretKey).toBeInstanceOf(Uint8Array);
    expect(kp.publicKey.length).toBe(2592);
    expect(kp.secretKey.length).toBe(4896);
  });

  it("generatePqcKeypair(seed) is deterministic", () => {
    const seed = new Uint8Array(32).fill(9);
    const a = generatePqcKeypair(seed);
    const b = generatePqcKeypair(seed);
    expect(a.publicKey).toEqual(b.publicKey);
    expect(a.secretKey).toEqual(b.secretKey);
  });
});

describe("ML-DSA-87 sign / verify", () => {
  it("round-trips a valid signature", () => {
    const kp = generatePqcKeypair();
    const sig = pqcSign(kp.secretKey, msg);
    expect(sig.length).toBe(4627);
    expect(pqcVerify(kp.publicKey, msg, sig)).toBe(true);
  });

  it("rejects a signature over a tampered message", () => {
    const kp = generatePqcKeypair();
    const sig = pqcSign(kp.secretKey, msg);
    const tampered = new TextEncoder().encode("transaction body bytesX");
    expect(pqcVerify(kp.publicKey, tampered, sig)).toBe(false);
  });

  it("rejects a signature under the wrong public key", () => {
    const kp = generatePqcKeypair();
    const other = generatePqcKeypair();
    const sig = pqcSign(kp.secretKey, msg);
    expect(pqcVerify(other.publicKey, msg, sig)).toBe(false);
  });
});

describe("buildHybridSignatureExtension", () => {
  it("produces an object whose fields match the proto/core struct exactly", () => {
    const kp = generatePqcKeypair();
    const sig = pqcSign(kp.secretKey, msg);
    const ext = buildHybridSignatureExtension({
      algorithmId: AlgorithmDilithium5,
      signature: sig,
      publicKey: kp.publicKey,
    });
    // Field names mirror x/pqc PQCHybridSignature JSON tags.
    expect(Object.keys(ext).sort()).toEqual(
      ["algorithm_id", "pqc_public_key", "pqc_signature"].sort(),
    );
    expect(ext.algorithm_id).toBe(1); // AlgorithmDilithium5 == 1
    expect(ext.pqc_signature).toBe(sig);
    expect(ext.pqc_public_key).toBe(kp.publicKey);
  });

  it("omits pqc_public_key when no public key is supplied", () => {
    const kp = generatePqcKeypair();
    const sig = pqcSign(kp.secretKey, msg);
    const ext = buildHybridSignatureExtension({
      algorithmId: AlgorithmDilithium5,
      signature: sig,
    });
    expect(ext.pqc_public_key).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(ext, "pqc_public_key")).toBe(
      false,
    );
  });

  it("exposes the chain's TX-extension type URL", () => {
    expect(HYBRID_SIG_TYPE_URL).toBe("/qorechain.pqc.v1.PQCHybridSignature");
  });

  it("rejects a signature of the wrong length for Dilithium-5", () => {
    expect(() =>
      buildHybridSignatureExtension({
        algorithmId: AlgorithmDilithium5,
        signature: new Uint8Array(10),
      }),
    ).toThrow();
  });
});

describe("PqcSigner (pqc-only mode)", () => {
  it("returns a pqc part and no classical signature", async () => {
    const kp = generatePqcKeypair();
    const signer = new PqcSigner(kp);
    expect(signer.mode).toBe("pqc");
    expect(signer.publicKey()).toEqual(kp.publicKey);

    const out = await signer.sign(msg);
    expect(out.classicalSignature).toBeUndefined();
    expect(out.pqc).toBeDefined();
    expect(out.pqc!.algorithmId).toBe(AlgorithmDilithium5);
    expect(out.pqc!.publicKey).toEqual(kp.publicKey);
    expect(pqcVerify(kp.publicKey, msg, out.pqc!.signature)).toBe(true);
  });
});

describe("HybridSigner (hybrid mode)", () => {
  it("produces BOTH a verifiable classical signature and a verifiable pqc part", async () => {
    const { signer: classical, publicKey: classicalPub } =
      makeClassicalSigner();
    const kp = generatePqcKeypair();
    const hybrid = new HybridSigner(classical, kp);

    expect(hybrid.mode).toBe("hybrid");
    // hybrid exposes the classical pubkey (account identity)
    expect(hybrid.publicKey()).toEqual(classicalPub);

    const out = await hybrid.sign(msg);

    // classical signature still verifies — proves classical compat is intact
    expect(out.classicalSignature).toBeDefined();
    expect(verifyClassical(classicalPub, msg, out.classicalSignature!)).toBe(
      true,
    );

    // pqc signature verifies under the pqc pubkey
    expect(out.pqc).toBeDefined();
    expect(out.pqc!.algorithmId).toBe(AlgorithmDilithium5);
    expect(pqcVerify(kp.publicKey, msg, out.pqc!.signature)).toBe(true);
    expect(out.pqc!.publicKey).toEqual(kp.publicKey);
  });

  it("can build the on-chain extension from its signature output", async () => {
    const { signer: classical } = makeClassicalSigner();
    const kp = generatePqcKeypair();
    const hybrid = new HybridSigner(classical, kp);
    const out = await hybrid.sign(msg);

    const ext = buildHybridSignatureExtension(out.pqc!);
    expect(ext.algorithm_id).toBe(1);
    expect(ext.pqc_signature).toEqual(out.pqc!.signature);
    expect(ext.pqc_public_key).toEqual(kp.publicKey);
  });
});
