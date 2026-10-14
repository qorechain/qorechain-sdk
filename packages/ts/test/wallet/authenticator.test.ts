import { describe, it, expect, vi } from "vitest";
import {
  executeEvmMsg,
  executeCosmosMsg,
  revokeAuthenticatorMsg,
  registerEthAuthenticatorMsg,
  rotatePqcKeyMsg,
  buildPhantomExecuteEvm,
  buildPhantomExecuteCosmos,
  buildMetaMaskExecuteEvm,
  buildMetaMaskExecuteCosmos,
  rotatePqcKeyMsgFromMnemonic,
  derivePqcLegacy,
  derivePqcCanonical,
  canonicalAccount,
  type AuthenticatorWallet,
  type Eip1193Provider,
} from "../../src/wallet/authenticator";
import {
  evmAuthSignBytes,
  cosmosAuthSignBytes,
  rotationSignBytes,
} from "../../src/tx/authenticator";
import { qorechainRegistry } from "../../src/messages/registry";
import { mldsa } from "@qorechain/pqc";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

const enc = new TextEncoder();
const registry = qorechainRegistry();

const RELAYER = "qor1relayer";
const ACCOUNT = "qor1account";
const CHAIN_ID = "qorechain-diana";
// A deterministic 32-byte ed25519 pubkey for the mock Phantom wallet.
const ED_PUBKEY = new Uint8Array(32).fill(0x07);
const ETH_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";

/** A mock Phantom-style ed25519 wallet whose signature is sha-free & recorded. */
function mockPhantom(): {
  wallet: AuthenticatorWallet;
  signed: { digest?: Uint8Array };
} {
  const signed: { digest?: Uint8Array } = {};
  const wallet: AuthenticatorWallet = {
    publicKey: ED_PUBKEY,
    signMessage: vi.fn(async (message: Uint8Array) => {
      signed.digest = message;
      // Return a deterministic pseudo-signature: first 64 bytes of the digest
      // repeated. The chain would ed25519-verify this; here we assert framing.
      return { signature: new Uint8Array([...message, ...message]) };
    }),
  };
  return { wallet, signed };
}

/** A mock EIP-1193 provider returning a 65-byte personal_sign signature. */
function mockProvider(): { provider: Eip1193Provider; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const provider: Eip1193Provider = {
    request: vi.fn(async (args: { method: string; params: unknown[] }) => {
      calls.push([args.method, ...args.params]);
      // 65-byte r||s||v as 0x-hex.
      return "0x" + "ab".repeat(65);
    }),
  };
  return { provider, calls };
}

describe("authenticator message composers", () => {
  it("executeEvmMsg carries the right typeUrl and encodes via the registry", () => {
    const m = executeEvmMsg({
      relayer: RELAYER,
      account: ACCOUNT,
      scheme: "ed25519",
      pubkey: ED_PUBKEY,
      signature: new Uint8Array([1, 2, 3]),
      to: "0xabc",
      value: "1000",
      data: new Uint8Array([9]),
      gasLimit: 100000,
      nonce: 5,
    });
    expect(m.typeUrl).toBe("/qorechain.abstractaccount.v1.MsgExecuteEVM");
    const bytes = registry.encode(m);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("executeCosmosMsg parses a single-coin amount string and round-trips via Any", () => {
    const m = executeCosmosMsg({
      relayer: RELAYER,
      account: ACCOUNT,
      scheme: "ed25519",
      pubkey: ED_PUBKEY,
      signature: new Uint8Array([1]),
      to: "qor1recv",
      amount: "100uqor",
      nonce: 3,
    });
    expect(m.typeUrl).toBe("/qorechain.abstractaccount.v1.MsgExecuteCosmos");
    expect((m.value as { amount: unknown }).amount).toEqual([
      { denom: "uqor", amount: "100" },
    ]);
    // Round-trip through the registry's Any encoder/decoder.
    const any = registry.encodeAsAny(m);
    const decoded = registry.decode({ typeUrl: any.typeUrl, value: any.value });
    expect(decoded.account).toBe(ACCOUNT);
    expect(decoded.amount).toEqual([{ denom: "uqor", amount: "100" }]);
  });

  it("executeCosmosMsg rejects a malformed amount", () => {
    expect(() =>
      executeCosmosMsg({
        relayer: RELAYER,
        account: ACCOUNT,
        scheme: "ed25519",
        pubkey: ED_PUBKEY,
        signature: new Uint8Array([1]),
        to: "qor1recv",
        amount: "not-a-coin",
        nonce: 0,
      }),
    ).toThrow(/invalid amount/);
  });

  it("revokeAuthenticatorMsg defaults account to owner", () => {
    const m = revokeAuthenticatorMsg({
      owner: ACCOUNT,
      scheme: "ed25519",
      pubkey: ED_PUBKEY,
    });
    expect(m.typeUrl).toBe(
      "/qorechain.abstractaccount.v1.MsgRevokeAuthenticator",
    );
    expect((m.value as { accountAddress: string }).accountAddress).toBe(ACCOUNT);
  });

  it("registerEthAuthenticatorMsg links by 0x address as 20-byte pubkey", () => {
    const m = registerEthAuthenticatorMsg({
      owner: ACCOUNT,
      ethAddress: ETH_ADDRESS,
      expiryUnix: 1_900_000_000,
    });
    expect(m.typeUrl).toBe(
      "/qorechain.abstractaccount.v1.MsgRegisterAuthenticator",
    );
    const v = m.value as { scheme: string; pubkey: Uint8Array };
    expect(v.scheme).toBe("secp256k1");
    expect(v.pubkey.length).toBe(20);
  });

  it("rotatePqcKeyMsg has the pqc rotate typeUrl", () => {
    const m = rotatePqcKeyMsg({
      sender: ACCOUNT,
      oldPublicKey: new Uint8Array([1]),
      newPublicKey: new Uint8Array([2]),
      oldSignature: new Uint8Array([3]),
      newSignature: new Uint8Array([4]),
    });
    expect(m.typeUrl).toBe("/qorechain.pqc.v1.MsgRotatePQCKey");
  });
});

describe("Phantom (ed25519) wallet builders", () => {
  it("buildPhantomExecuteEvm signs the exact EVM auth digest", async () => {
    const { wallet, signed } = mockPhantom();
    const m = await buildPhantomExecuteEvm({
      wallet,
      relayer: RELAYER,
      chainId: CHAIN_ID,
      account: ACCOUNT,
      to: "0xabc",
      value: "1000",
      data: new Uint8Array([2, 2, 2]),
      nonce: 5,
    });
    const expectedDigest = evmAuthSignBytes({
      chainId: CHAIN_ID,
      account: ACCOUNT,
      pubkey: ED_PUBKEY,
      to: "0xabc",
      value: "1000",
      data: new Uint8Array([2, 2, 2]),
      nonce: 5,
    });
    expect(signed.digest).toEqual(expectedDigest);
    const v = m.value as { scheme: string; pubkey: Uint8Array };
    expect(v.scheme).toBe("ed25519");
    expect(v.pubkey).toEqual(ED_PUBKEY);
    expect(m.typeUrl).toBe("/qorechain.abstractaccount.v1.MsgExecuteEVM");
  });

  it("buildPhantomExecuteCosmos signs the exact Cosmos auth digest", async () => {
    const { wallet, signed } = mockPhantom();
    const m = await buildPhantomExecuteCosmos({
      wallet,
      relayer: RELAYER,
      chainId: CHAIN_ID,
      account: ACCOUNT,
      to: "qor1recv",
      amount: "100uqor",
      nonce: 3,
    });
    const expectedDigest = cosmosAuthSignBytes({
      chainId: CHAIN_ID,
      account: ACCOUNT,
      pubkey: ED_PUBKEY,
      to: "qor1recv",
      amount: "100uqor",
      nonce: 3,
    });
    expect(signed.digest).toEqual(expectedDigest);
    expect(m.typeUrl).toBe("/qorechain.abstractaccount.v1.MsgExecuteCosmos");
  });
});

describe("MetaMask (secp256k1) wallet builders", () => {
  it("buildMetaMaskExecuteEvm personal_signs the digest and yields a 65-byte sig", async () => {
    const { provider, calls } = mockProvider();
    const m = await buildMetaMaskExecuteEvm({
      provider,
      address: ETH_ADDRESS,
      relayer: RELAYER,
      chainId: CHAIN_ID,
      account: ACCOUNT,
      to: "0xabc",
      value: "1",
      nonce: 0,
    });
    expect(calls[0][0]).toBe("personal_sign");
    const v = m.value as { scheme: string; pubkey: Uint8Array; signature: Uint8Array };
    expect(v.scheme).toBe("secp256k1");
    expect(v.pubkey.length).toBe(20);
    expect(v.signature.length).toBe(65);
  });

  it("buildMetaMaskExecuteCosmos personal_signs the Cosmos digest", async () => {
    const { provider, calls } = mockProvider();
    const m = await buildMetaMaskExecuteCosmos({
      provider,
      address: ETH_ADDRESS,
      relayer: RELAYER,
      chainId: CHAIN_ID,
      account: ACCOUNT,
      to: "qor1recv",
      amount: "5uqor",
      nonce: 1,
    });
    // personal_sign params[0] is the 0x-hex digest.
    const digestHex = calls[0][1] as string;
    const expected =
      "0x" +
      Array.from(
        cosmosAuthSignBytes({
          chainId: CHAIN_ID,
          account: ACCOUNT,
          pubkey: Uint8Array.from(
            ETH_ADDRESS.replace(/^0x/, "").match(/.{2}/g)!.map((h) => parseInt(h, 16)),
          ),
          to: "qor1recv",
          amount: "5uqor",
          nonce: 1,
        }),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
    expect(digestHex).toBe(expected);
    expect((m.value as { scheme: string }).scheme).toBe("secp256k1");
  });
});

describe("PQC key rotation from mnemonic", () => {
  const MNEMONIC =
    "test test test test test test test test test test test junk";
  // A valid account: rotation resolves the account and rejects junk addresses.
  const ROT_ACCOUNT = "qor17w0adeg64ky0daxwd2ugyuneellmjgnxhkv37z";

  it("derivePqcLegacy uses shake256(mnemonic) and yields a valid ML-DSA-87 key", () => {
    const kp = derivePqcLegacy(MNEMONIC);
    expect(kp.publicKey.length).toBe(2592);
    expect(kp.secretKey.length).toBe(4896);
  });

  it("rotatePqcKeyMsgFromMnemonic dual-signs the rotation bytes and both verify", () => {
    const { msg, oldKeypair, newKeypair } = rotatePqcKeyMsgFromMnemonic({
      account: ROT_ACCOUNT,
      mnemonic: MNEMONIC,
      chainId: CHAIN_ID,
    });
    expect(msg.typeUrl).toBe("/qorechain.pqc.v1.MsgRotatePQCKey");
    // Legacy != canonical, so keys differ.
    expect(oldKeypair.publicKey).not.toEqual(newKeypair.publicKey);

    const sb = enc.encode(
      rotationSignBytes(
        CHAIN_ID,
        1,
        ROT_ACCOUNT,
        oldKeypair.publicKey,
        newKeypair.publicKey,
      ),
    );
    const v = msg.value as {
      oldSignature: Uint8Array;
      newSignature: Uint8Array;
      oldPublicKey: Uint8Array;
      newPublicKey: Uint8Array;
    };
    expect(mldsa.verify(oldKeypair.publicKey, sb, v.oldSignature)).toBe(true);
    expect(mldsa.verify(newKeypair.publicKey, sb, v.newSignature)).toBe(true);
  });

  it("throws when old and new derivations collide (no-op rotation)", () => {
    expect(() =>
      rotatePqcKeyMsgFromMnemonic({
        account: ROT_ACCOUNT,
        mnemonic: MNEMONIC,
        chainId: CHAIN_ID,
        oldDerivation: "adapter",
        newDerivation: "adapter",
      }),
    ).toThrow(/no-op/);
  });

  it("rejects an account that is not a valid address", () => {
    expect(() =>
      rotatePqcKeyMsgFromMnemonic({
        account: "qor1account",
        mnemonic: MNEMONIC,
        chainId: CHAIN_ID,
      }),
    ).toThrow(/cannot resolve account/);
  });
});

// Cross-language vector for QSR-2026-0381, produced by the Go SDK
// (authenticator.TestDerivePQCCanonicalNormalisesAccount): every encoding of one
// account resolves to its lower-case bech32 form before hashing.
describe("canonical PQC derivation normalises the account (QSR-2026-0381)", () => {
  const VEC_MNEMONIC =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const VEC_COSMOS = "qor1npvwllfr9dqr8erajqqr6s0vxnk2ak55am9g2c";
  const VEC_EVM = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
  const VEC_CANONICAL_SHA256 =
    "3d7bd2b98be09288b43a2fa18049789782d35c408f93099724417249707d1585";
  const inputs = [
    VEC_COSMOS,
    VEC_COSMOS.toUpperCase(),
    VEC_EVM,
    VEC_EVM.toLowerCase(),
    "0X" + VEC_EVM.slice(2).toUpperCase(),
  ];

  it.each(inputs)("%s derives the Go vector key", (input) => {
    expect(canonicalAccount(input)).toBe(VEC_COSMOS);
    const kp = derivePqcCanonical(input, VEC_MNEMONIC);
    expect(bytesToHex(sha256(kp.publicKey))).toBe(VEC_CANONICAL_SHA256);
  });

  it.each(inputs)("%s builds the rotation with the canonical sender and sign-bytes", (input) => {
    const { msg, oldKeypair, newKeypair } = rotatePqcKeyMsgFromMnemonic({
      account: input,
      mnemonic: VEC_MNEMONIC,
      chainId: CHAIN_ID,
    });
    const v = msg.value as {
      sender: string;
      oldSignature: Uint8Array;
      newSignature: Uint8Array;
    };
    expect(v.sender).toBe(VEC_COSMOS);
    expect(bytesToHex(sha256(newKeypair.publicKey))).toBe(VEC_CANONICAL_SHA256);
    const sb = enc.encode(
      rotationSignBytes(
        CHAIN_ID,
        1,
        VEC_COSMOS,
        oldKeypair.publicKey,
        newKeypair.publicKey,
      ),
    );
    expect(mldsa.verify(oldKeypair.publicKey, sb, v.oldSignature)).toBe(true);
    expect(mldsa.verify(newKeypair.publicKey, sb, v.newSignature)).toBe(true);
  });

  it("rejects junk, mixed-case and short-hex accounts like Go", () => {
    for (const bad of ["qor1abc", "Qor1" + VEC_COSMOS.slice(4), "0x1234"]) {
      expect(() => canonicalAccount(bad)).toThrow();
      expect(() => derivePqcCanonical(bad, VEC_MNEMONIC)).toThrow();
    }
  });
});
