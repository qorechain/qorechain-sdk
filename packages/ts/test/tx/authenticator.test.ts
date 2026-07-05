import { describe, it, expect } from "vitest";
import {
  evmAuthSignBytes,
  cosmosAuthSignBytes,
  rotationSignBytes,
  be64,
  lengthPrefixed,
} from "../../src/tx/authenticator";

const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

// pubkey = 32 bytes of 0x01, per the KAT spec.
const PUBKEY = new Uint8Array(32).fill(0x01);

describe("authenticator sign-bytes (byte-exact KAT vs adapter 0.1.7)", () => {
  it("evmAuthSignBytes matches the known-answer digest", () => {
    const digest = evmAuthSignBytes({
      chainId: "qorechain-diana",
      account: "qor1test",
      pubkey: PUBKEY,
      to: "0xabc",
      value: "1000",
      data: new Uint8Array([2, 2, 2]),
      nonce: 5,
    });
    expect(digest).toBeInstanceOf(Uint8Array);
    expect(digest.length).toBe(32);
    expect(hex(digest)).toBe(
      "8661921e6d37dff44e97d4a05d4efbfd3fd8ea631201479c2bbf1cb41ade7025",
    );
  });

  it("cosmosAuthSignBytes matches the known-answer digest", () => {
    const digest = cosmosAuthSignBytes({
      chainId: "qorechain-diana",
      account: "qor1test",
      pubkey: PUBKEY,
      to: "qor1recv",
      amount: "100uqor",
      nonce: 3,
    });
    expect(digest.length).toBe(32);
    expect(hex(digest)).toBe(
      "5e203ef47b5fe63d0fc9c8909aecb124b32b173f8b96700003ba1d8fa0114f0f",
    );
  });

  it("rotationSignBytes matches the known-answer string", () => {
    const s = rotationSignBytes(
      "qorechain-diana",
      1,
      "qor1test",
      new Uint8Array([0xaa, 0xaa]),
      new Uint8Array([0xbb, 0xbb]),
    );
    expect(s).toBe("qorechain-pqc-rotate-v1|qorechain-diana|1|qor1test|aaaa|bbbb");
  });

  it("defaults empty EVM fields the same way the chain does", () => {
    // to="", value="0", data=empty are the documented defaults.
    const explicit = evmAuthSignBytes({
      chainId: "c",
      account: "a",
      pubkey: PUBKEY,
      to: "",
      value: "0",
      data: new Uint8Array(0),
      nonce: 0,
    });
    const defaulted = evmAuthSignBytes({
      chainId: "c",
      account: "a",
      pubkey: PUBKEY,
      nonce: 0,
    });
    expect(hex(defaulted)).toBe(hex(explicit));
  });

  it("be64 is 8-byte big-endian", () => {
    expect(hex(be64(0))).toBe("0000000000000000");
    expect(hex(be64(1))).toBe("0000000000000001");
    expect(hex(be64(258))).toBe("0000000000000102");
    expect(hex(be64(0xffffffffffn))).toBe("000000ffffffffff");
  });

  it("be64 rejects negative values", () => {
    expect(() => be64(-1)).toThrow();
  });

  it("lengthPrefixed frames as BE64(len) || bytes", () => {
    const lp = lengthPrefixed(new Uint8Array([0xde, 0xad]));
    expect(hex(lp)).toBe("0000000000000002dead");
  });

  it("changing the nonce changes the digest (replay binding)", () => {
    const a = cosmosAuthSignBytes({
      chainId: "c",
      account: "a",
      pubkey: PUBKEY,
      to: "b",
      amount: "1uqor",
      nonce: 1,
    });
    const b = cosmosAuthSignBytes({
      chainId: "c",
      account: "a",
      pubkey: PUBKEY,
      to: "b",
      amount: "1uqor",
      nonce: 2,
    });
    expect(hex(a)).not.toBe(hex(b));
  });
});
