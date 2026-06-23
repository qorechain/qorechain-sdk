import { describe, it, expect } from "vitest";
import { Keypair } from "@solana/web3.js";
import { svmKeypairFromSecretKey, svmAddress } from "../src/index";

describe("svmKeypairFromSecretKey", () => {
  it("reconstructs a Keypair whose publicKey matches the source 64-byte secret key", () => {
    // Derive a known keypair in-test, then round-trip its 64-byte secret key.
    const source = Keypair.fromSeed(new Uint8Array(32).fill(7));
    const expectedAddress = source.publicKey.toBase58();

    const kp = svmKeypairFromSecretKey(source.secretKey);
    expect(kp.publicKey.toBase58()).toBe(expectedAddress);
  });

  it("rejects a secret key that is not 64 bytes", () => {
    expect(() => svmKeypairFromSecretKey(new Uint8Array(32))).toThrow();
  });
});

describe("svmAddress", () => {
  it("returns the base58 address for a Keypair", () => {
    const kp = Keypair.fromSeed(new Uint8Array(32).fill(7));
    expect(svmAddress(kp)).toBe(kp.publicKey.toBase58());
  });

  it("returns the base58 address for a PublicKey", () => {
    const kp = Keypair.fromSeed(new Uint8Array(32).fill(7));
    expect(svmAddress(kp.publicKey)).toBe(kp.publicKey.toBase58());
  });
});
