import { describe, it, expect, vi, beforeEach } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { TxRaw, TxBody, SignDoc } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { PubKey } from "cosmjs-types/cosmos/crypto/secp256k1/keys";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";
import { type EncodeObject } from "@cosmjs/proto-signing";

import { deriveUnifiedAccount } from "../../src/accounts/unified";
import {
  signClassicalEth,
  signHybridEth,
  ETHSECP256K1_PUBKEY_TYPE,
} from "../../src/tx/sign-eth";
import { EthNativeSigner, accountAuthInfo } from "../../src/tx/eth-native";
import { qorechainRegistry } from "../../src/messages/registry";
import { HYBRID_SIG_TYPE_URL, pqcVerify } from "../../src/accounts/pqc";
import { clearSignBytesCache, hybridSignBytesV1, hybridSignBytesV2 } from "../../src/tx/signbytes";
import { BaseAccount } from "cosmjs-types/cosmos/auth/v1beta1/auth";
import { Any } from "cosmjs-types/google/protobuf/any";

const TEST_MNEMONIC =
  "test test test test test test test test test test test junk";

const CHAIN_ID = "qorechain-vladi";
const FEE = { amount: [{ denom: "uqor", amount: "1500" }], gas: "100000" };

function fromHex(hex: string): Uint8Array {
  const b = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(b.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(b.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function katAccount() {
  return deriveUnifiedAccount(TEST_MNEMONIC, 0);
}

function bankMsg(from: string): EncodeObject {
  return {
    typeUrl: "/cosmos.bank.v1beta1.MsgSend",
    value: MsgSend.fromPartial({
      fromAddress: from,
      toAddress: from,
      amount: [{ denom: "uqor", amount: "1" }],
    }),
  };
}

const registry = qorechainRegistry();
const encodeMessage = (m: EncodeObject): Any => registry.encodeAsAny(m);

/** Verify the classical signature is secp256k1 over keccak256(signBytes). */
function verifyClassical(
  signed: { bodyBytes: Uint8Array; authInfoBytes: Uint8Array; classicalSignature: Uint8Array },
  pubkeyHex: string,
): boolean {
  const signDoc = SignDoc.encode(
    SignDoc.fromPartial({
      bodyBytes: signed.bodyBytes,
      authInfoBytes: signed.authInfoBytes,
      chainId: CHAIN_ID,
      accountNumber: 7n,
    }),
  ).finish();
  const hash = keccak_256(signDoc);
  return secp256k1.verify(signed.classicalSignature, hash, fromHex(pubkeyHex));
}

describe("signClassicalEth", () => {
  it("uses the eth_secp256k1 pubkey Any and no PQC extension", async () => {
    const acct = await katAccount();
    const signed = signClassicalEth({
      account: acct,
      chainId: CHAIN_ID,
      accountNumber: 7,
      messages: [bankMsg(acct.cosmos)],
      fee: FEE,
      sequence: 3,
      encodeMessage,
      signBytesVersion: "v2",
    });
    const raw = TxRaw.decode(signed.txRawBytes);
    const { AuthInfo } = await import("cosmjs-types/cosmos/tx/v1beta1/tx");
    const authInfo = AuthInfo.decode(raw.authInfoBytes);
    expect(authInfo.signerInfos[0].publicKey?.typeUrl).toBe(
      ETHSECP256K1_PUBKEY_TYPE,
    );
    // pubkey value is wire-identical to the cosmos secp256k1 PubKey
    const key = PubKey.decode(authInfo.signerInfos[0].publicKey!.value).key;
    expect(Array.from(key)).toEqual(Array.from(fromHex(acct.publicKey)));

    // no PQC extension in the body
    const body = TxBody.decode(raw.bodyBytes);
    expect(body.extensionOptions.length).toBe(0);

    // classical sig verifies as secp256k1 over keccak256(signBytes)
    expect(verifyClassical(signed, acct.publicKey)).toBe(true);
    expect(signed.classicalSignature.length).toBe(64);
  });
});

describe("signHybridEth", () => {
  it("attaches the PQC extension and signs the body WITH it; B0 excludes it", async () => {
    const acct = await katAccount();
    const signed = signHybridEth({
      account: acct,
      chainId: CHAIN_ID,
      accountNumber: 7,
      messages: [bankMsg(acct.cosmos)],
      fee: FEE,
      sequence: 3,
      encodeMessage,
      signBytesVersion: "v2",
    });
    const raw = TxRaw.decode(signed.txRawBytes);
    const body = TxBody.decode(raw.bodyBytes);

    // PQC extension present in the FINAL body
    expect(body.extensionOptions.length).toBe(1);
    expect(body.extensionOptions[0].typeUrl).toBe(HYBRID_SIG_TYPE_URL);

    // B0 (body without ext) must differ from the final body bytes
    const b0 = TxBody.encode(
      TxBody.fromPartial({
        messages: [encodeMessage(bankMsg(acct.cosmos))],
        memo: "",
        timeoutHeight: 0n,
      }),
    ).finish();
    expect(Buffer.from(b0).equals(Buffer.from(raw.bodyBytes))).toBe(false);

    // classical sig verifies over the FINAL body (with extension)
    expect(verifyClassical(signed, acct.publicKey)).toBe(true);
  });

  it("throws without a PQC keypair", async () => {
    const acct = await katAccount();
    expect(() =>
      signHybridEth({
        account: { privateKey: acct.privateKey, publicKey: acct.publicKey },
        chainId: CHAIN_ID,
        accountNumber: 7,
        messages: [bankMsg(acct.cosmos)],
        fee: FEE,
        sequence: 3,
        encodeMessage,
      }),
    ).toThrow(/requires account\.pqc/);
  });
});

describe("EthNativeSigner", () => {
  it("bankSend builds a hybrid eth-native tx and broadcasts via transport", async () => {
    const acct = await katAccount();
    const signer = new EthNativeSigner(acct, { signBytesVersion: "v2" });
    let broadcasted: Uint8Array | undefined;
    const transport = {
      broadcastTx: async (tx: Uint8Array) => {
        broadcasted = tx;
        return { code: 0, transactionHash: "ABC123" };
      },
    };
    const res = await signer.bankSend(transport, acct.cosmos, [
      { denom: "uqor", amount: "5" },
    ], { chainId: CHAIN_ID, accountNumber: 7, sequence: 3, fee: FEE });
    expect(res.transactionHash).toBe("ABC123");
    const raw = TxRaw.decode(broadcasted!);
    const body = TxBody.decode(raw.bodyBytes);
    expect(body.extensionOptions[0].typeUrl).toBe(HYBRID_SIG_TYPE_URL);
  });

  it("classical signMode omits the PQC extension", async () => {
    const acct = await katAccount();
    const signer = new EthNativeSigner(acct, { signMode: "classical" });
    const signed = signer.sign({
      chainId: CHAIN_ID,
      accountNumber: 7,
      sequence: 3,
      fee: FEE,
      messages: [bankMsg(acct.cosmos)],
    });
    const body = TxBody.decode(signed.bodyBytes);
    expect(body.extensionOptions.length).toBe(0);
  });
});

describe("accountAuthInfo", () => {
  it("reads account_number/sequence and decodes an eth_secp256k1 pubkey", async () => {
    const acct = await katAccount();
    const pubAny = Any.fromPartial({
      typeUrl: ETHSECP256K1_PUBKEY_TYPE,
      value: PubKey.encode(
        PubKey.fromPartial({ key: fromHex(acct.publicKey) }),
      ).finish(),
    });
    const base = BaseAccount.fromPartial({
      address: acct.cosmos,
      pubKey: pubAny,
      accountNumber: 42n,
      sequence: 9n,
    });
    const parsed = accountAuthInfo(base);
    expect(parsed.accountNumber).toBe(42n);
    expect(parsed.sequence).toBe(9n);
    expect(parsed.pubkeyType).toBe(ETHSECP256K1_PUBKEY_TYPE);
    expect(Array.from(parsed.publicKey!)).toEqual(
      Array.from(fromHex(acct.publicKey)),
    );
  });
});

describe("eth-native hybrid sign-bytes form", () => {
  beforeEach(() => clearSignBytesCache());

  const plan = (height: string) =>
    vi.fn(async () => new Response(JSON.stringify({ height })));

  function b0And(signed: { bodyBytes: Uint8Array }) {
    const body = TxBody.decode(signed.bodyBytes);
    return TxBody.encode(TxBody.fromPartial({ ...body, extensionOptions: [] })).finish();
  }

  it("signHybridEth refuses to guess the form on a legacy network", async () => {
    const acct = await katAccount();
    expect(() =>
      signHybridEth({
        account: acct,
        chainId: "qorechain-vladi",
        accountNumber: 7,
        messages: [bankMsg(acct.cosmos)],
        fee: FEE,
        sequence: 3,
        encodeMessage,
      }),
    ).toThrow(/needs signBytesVersion/);
  });

  it("signHybridEth signs v2 by default on a chain born on v2", async () => {
    const acct = await katAccount();
    const signed = signHybridEth({
      account: acct,
      chainId: "my-rollup-1",
      accountNumber: 7,
      messages: [bankMsg(acct.cosmos)],
      fee: FEE,
      sequence: 3,
      encodeMessage,
    });
    const ext = TxBody.decode(signed.bodyBytes).extensionOptions[0];
    expect(ext).toBeDefined();
  });

  it("signHybridEth v1 and v2 sign different bytes; each verifies only over its own form", async () => {
    const acct = await katAccount();
    const base = {
      account: acct,
      chainId: CHAIN_ID,
      accountNumber: 7,
      messages: [bankMsg(acct.cosmos)],
      fee: FEE,
      sequence: 3,
      encodeMessage,
    };
    for (const version of ["v1", "v2"] as const) {
      const signed = signHybridEth({ ...base, signBytesVersion: version });
      const b0 = b0And(signed);
      const ext = TxBody.decode(signed.bodyBytes).extensionOptions[0];
      const { PQCHybridSignature } = await import("../../src/codegen/qorechain/pqc/v1/hybrid");
      const sig = PQCHybridSignature.decode(ext.value).pqcSignature;
      const v1 = hybridSignBytesV1(b0, signed.authInfoBytes);
      const v2 = hybridSignBytesV2(CHAIN_ID, b0, signed.authInfoBytes);
      expect(pqcVerify(acct.pqc!.publicKey, version === "v1" ? v1 : v2, sig)).toBe(true);
      expect(pqcVerify(acct.pqc!.publicKey, version === "v1" ? v2 : v1, sig)).toBe(false);
    }
  });

  it("EthNativeSigner auto asks the network and retries once on a pqc code-21 refusal", async () => {
    const acct = await katAccount();
    // Neither plan applied on the first resolve (both names asked), then the
    // network upgrades, so the forced re-resolve sees it.
    let asked = 0;
    const f = vi.fn(async () => {
      asked += 1;
      return new Response(JSON.stringify({ height: asked <= 2 ? "0" : "5746000" }));
    });
    const signer = new EthNativeSigner(acct, { rest: "https://lcd.example", fetch: f });
    const transport = {
      broadcastTx: vi
        .fn()
        .mockResolvedValueOnce({ code: 21, transactionHash: "X", rawLog: "hybrid PQC signature verification failed" })
        .mockResolvedValue({ code: 0, transactionHash: "OK" }),
    };
    const res = await signer.signAndBroadcast(transport, {
      chainId: CHAIN_ID,
      accountNumber: 7,
      sequence: 3,
      fee: FEE,
      messages: [bankMsg(acct.cosmos)],
    });
    expect(res.transactionHash).toBe("OK");
    expect(transport.broadcastTx).toHaveBeenCalledTimes(2);
    expect(f).toHaveBeenCalledTimes(3); // 2 plan names, then the refresh
  });

  it("EthNativeSigner auto without rest on a legacy network throws", async () => {
    const acct = await katAccount();
    const signer = new EthNativeSigner(acct);
    const transport = { broadcastTx: vi.fn() };
    await expect(
      signer.signAndBroadcast(transport, {
        chainId: CHAIN_ID,
        accountNumber: 7,
        sequence: 3,
        fee: FEE,
        messages: [bankMsg(acct.cosmos)],
      }),
    ).rejects.toThrow(/REST endpoint/);
    expect(transport.broadcastTx).not.toHaveBeenCalled();
    void plan;
  });
});
