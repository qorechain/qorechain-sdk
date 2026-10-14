import { describe, it, expect, vi, beforeEach } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1";
import { ripemd160 } from "@noble/hashes/ripemd160";
import { sha256 } from "@noble/hashes/sha256";
import { bech32 } from "bech32";

import {
  EVM_DELEGATION_CLEAR,
  MAX_EVM_DELEGATION_CONSENT_BLOCKS,
  authorizeEvmDelegationMsg,
  clearEvmDelegationMsg,
  fetchEvmDelegationConsent,
  evmDelegationTupleNonce,
  classifyEvmDelegationRejection,
} from "../../src/pqc/evm-delegation";
import { validateClassicalKeyForSender } from "../../src/pqc/classical-key";
import {
  CHAIN_UPGRADE_V3_2_2,
  clearUpgradeCache,
  fetchUpgradeAppliedHeight,
  isUpgradeApplied,
  requireUpgradeApplied,
} from "../../src/tx/upgrades";
import { decodeTxError } from "../../src/errors";
import { buildRegisterPqcKeyMsg } from "../../src/helpers/pqc";
import { qorechainRegistry } from "../../src/messages/registry";
import {
  MsgAuthorizeEVMDelegation,
  MsgClearEVMDelegation,
} from "../../src/codegen/qorechain/pqc/v1/tx";

const SENDER = "qor18df074t3k0xq8jf7336hpjjsktw354knr650aq";
const DELEGATE = "0x63C0c19a282a1B52b07dD5a65b58948A07DAE32B";

function hex(s: string): Uint8Array {
  return Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));
}

function json(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("registry: messages new in chain v3.2.2", () => {
  it.each([
    "/qorechain.pqc.v1.MsgAuthorizeEVMDelegation",
    "/qorechain.pqc.v1.MsgClearEVMDelegation",
    "/qorechain.bridge.v1.MsgUpdateCircuitBreakerLimits",
    "/qorechain.multilayer.v1.MsgUpdateParams",
  ])("knows %s", (typeUrl) => {
    expect(qorechainRegistry().lookupType(typeUrl)).toBeDefined();
  });
});

describe("authorizeEvmDelegationMsg", () => {
  it("round-trips through the registry with the delegate lower-cased", () => {
    const m = authorizeEvmDelegationMsg({ sender: SENDER, delegate: DELEGATE, blocks: 600 });
    const any = qorechainRegistry().encodeAsAny(m);
    expect(any.typeUrl).toBe("/qorechain.pqc.v1.MsgAuthorizeEVMDelegation");
    expect(MsgAuthorizeEVMDelegation.decode(any.value)).toMatchObject({
      sender: SENDER,
      delegate: DELEGATE.toLowerCase(),
      blocks: "600",
    });
  });

  it("accepts the zero address as consent to clear", () => {
    const m = authorizeEvmDelegationMsg({ sender: SENDER, delegate: EVM_DELEGATION_CLEAR, blocks: 1 });
    expect((m.value as { delegate: string }).delegate).toBe(EVM_DELEGATION_CLEAR);
  });

  it("enforces the chain's bounds before broadcast", () => {
    expect(() => authorizeEvmDelegationMsg({ sender: SENDER, delegate: DELEGATE, blocks: 0 })).toThrow(/greater than 0/);
    expect(() =>
      authorizeEvmDelegationMsg({
        sender: SENDER,
        delegate: DELEGATE,
        blocks: MAX_EVM_DELEGATION_CONSENT_BLOCKS + 1n,
      }),
    ).toThrow(/at most 17280/);
    expect(() => authorizeEvmDelegationMsg({ sender: SENDER, delegate: "63c0c19a", blocks: 5 })).toThrow(/0x-prefixed/);
    expect(() => authorizeEvmDelegationMsg({ sender: "", delegate: DELEGATE, blocks: 5 })).toThrow(/sender/);
  });
});

describe("clearEvmDelegationMsg", () => {
  it("round-trips", () => {
    const any = qorechainRegistry().encodeAsAny(clearEvmDelegationMsg(SENDER));
    expect(MsgClearEVMDelegation.decode(any.value).sender).toBe(SENDER);
  });
});

describe("fetchEvmDelegationConsent", () => {
  it("parses the chain's response (as returned by diana at v3.2.2)", async () => {
    const fetch = vi.fn(async () =>
      json({
        found: true,
        live: true,
        delegate: DELEGATE.toLowerCase(),
        granted_height: "6905100",
        expiry_height: "6905700",
        current_delegate: "",
        nonce: "7",
      }),
    );
    const c = await fetchEvmDelegationConsent({ rest: "https://lcd/", address: SENDER, fetch });
    expect(fetch).toHaveBeenCalledWith(`https://lcd/qorechain/pqc/v1/evm_delegation_consent/${SENDER}`);
    expect(c).toEqual({
      found: true,
      live: true,
      delegate: DELEGATE.toLowerCase(),
      grantedHeight: 6905100n,
      expiryHeight: 6905700n,
      currentDelegate: "",
      nonce: 7n,
    });
    expect(evmDelegationTupleNonce(c, true)).toBe(7n);
    expect(evmDelegationTupleNonce(c, false)).toBe(8n);
  });

  it("reports a node without the endpoint as an error, not as 'no consent'", async () => {
    const fetch = vi.fn(async () => json({ code: 12 }, 501));
    await expect(fetchEvmDelegationConsent({ rest: "https://lcd", address: SENDER, fetch })).rejects.toThrow(/HTTP 501/);
  });
});

describe("classifyEvmDelegationRejection", () => {
  it("matches the chain's text, then its code", () => {
    expect(
      classifyEvmDelegationRejection({ message: "no post-quantum consent for this EIP-7702 delegation: authority 0xabc" }),
    ).toBe("no-consent");
    expect(classifyEvmDelegationRejection({ codespace: "pqc", code: 61, rawLog: "" })).toBe("invalid");
    expect(classifyEvmDelegationRejection({ codespace: "pqc", code: 26, rawLog: "" })).toBeUndefined();
    expect(classifyEvmDelegationRejection(undefined)).toBeUndefined();
  });
});

describe("validateClassicalKeyForSender", () => {
  it("accepts the key diana accepted at v3.2.2 (h 7,911,828, eth-native account)", () => {
    expect(
      validateClassicalKeyForSender(
        "qor1hkkxx5jmmw02wcz26c74lsp74qysj6h495vv0k",
        hex("038844ec286297bf780ce0fbe07df2a74c5e0e841df5f3adc363f0372755b76d74"),
      ),
    ).toBe("eth");
  });

  it("accepts a cosmos-derived account", () => {
    const pub = secp256k1.getPublicKey(hex("11".repeat(32)), true);
    const sender = bech32.encode("qor", bech32.toWords(ripemd160(sha256(pub))));
    expect(validateClassicalKeyForSender(sender, pub)).toBe("cosmos");
  });

  it("accepts an empty key", () => {
    expect(validateClassicalKeyForSender(SENDER, new Uint8Array(0))).toBe("empty");
    expect(validateClassicalKeyForSender(SENDER, undefined)).toBe("empty");
  });

  it("refuses a key of another account, an uncompressed key and a hex string", () => {
    const pub = secp256k1.getPublicKey(hex("11".repeat(32)), true);
    expect(() => validateClassicalKeyForSender(SENDER, pub)).toThrow(/does not belong/);
    expect(() => validateClassicalKeyForSender(SENDER, secp256k1.getPublicKey(hex("11".repeat(32)), false))).toThrow(
      /33-byte/,
    );
    expect(() => validateClassicalKeyForSender(SENDER, ("0x" + "02".repeat(33)) as unknown as Uint8Array)).toThrow(
      /Uint8Array/,
    );
  });

  it("is applied by buildRegisterPqcKeyMsg", () => {
    const pqcKeypair = { publicKey: new Uint8Array(2592), secretKey: new Uint8Array(4896) };
    const foreign = secp256k1.getPublicKey(hex("11".repeat(32)), true);
    expect(() => buildRegisterPqcKeyMsg(SENDER, { pqcKeypair, ecdsaPubkey: foreign })).toThrow(/does not belong/);
    expect(buildRegisterPqcKeyMsg(SENDER, { pqcKeypair }).typeUrl).toBe("/qorechain.pqc.v1.MsgRegisterPQCKeyV2");
  });
});

describe("upgrade detection", () => {
  beforeEach(() => clearUpgradeCache());

  it("reads applied_plan and caches a positive answer", async () => {
    const fetch = vi.fn(async () => json({ height: "6905034" }));
    const opts = { rest: "https://lcd", upgrade: CHAIN_UPGRADE_V3_2_2, fetch };
    expect(await fetchUpgradeAppliedHeight(opts)).toBe(6905034n);
    expect(await isUpgradeApplied(opts)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("https://lcd/cosmos/upgrade/v1beta1/applied_plan/v3.2.2");
  });

  it("treats height \"0\" (mainnet's answer before the plan) as not applied", async () => {
    const fetch = vi.fn(async () => json({ height: "0" }));
    expect(await isUpgradeApplied({ rest: "https://lcd", upgrade: CHAIN_UPGRADE_V3_2_2, fetch })).toBe(false);
    await expect(
      requireUpgradeApplied({ rest: "https://lcd", upgrade: CHAIN_UPGRADE_V3_2_2, fetch, what: "native_only" }),
    ).rejects.toThrow(/native_only needs chain v3.2.2/);
  });

  it("asks again after a negative answer when told to", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ height: "0" }))
      .mockResolvedValueOnce(json({ height: "42" }));
    const opts = { rest: "https://lcd", upgrade: CHAIN_UPGRADE_V3_2_2, fetch };
    expect(await isUpgradeApplied(opts)).toBe(false);
    expect(await isUpgradeApplied({ ...opts, fresh: true })).toBe(true);
  });

  it("throws instead of guessing when the node cannot be asked", async () => {
    const fetch = vi.fn(async () => json({}, 503));
    await expect(isUpgradeApplied({ rest: "https://lcd", upgrade: CHAIN_UPGRADE_V3_2_2, fetch })).rejects.toThrow(
      /HTTP 503/,
    );
  });
});

describe("decodeTxError: chain v3.2.2", () => {
  it("recognises the per-sender rate limit (ai 3 + the chain's text)", () => {
    const log = "sender qor1abc has sent 600 transactions in the last 30 blocks, at the configured limit of 600 per minute";
    expect(decodeTxError({ code: 3, codespace: "ai", rawLog: log }).kind).toBe("rate_limited");
    // Transport without a codespace (EVM JSON-RPC): the text alone decides.
    expect(decodeTxError({ code: 3, codespace: "", rawLog: log }).kind).toBe("rate_limited");
    // Code 3 carries other AI-engine rejections; code 2 is the anomaly flag.
    expect(decodeTxError({ code: 3, codespace: "ai", rawLog: "transaction rejected by AI engine" }).kind).not.toBe("rate_limited");
    expect(decodeTxError({ code: 2, codespace: "ai", rawLog: log }).kind).not.toBe("rate_limited");
  });

  it("maps the delegation codes", () => {
    expect(decodeTxError({ code: 60, codespace: "pqc" }).kind).toBe("evm_delegation_no_consent");
    expect(decodeTxError({ code: 61, codespace: "pqc" }).kind).toBe("evm_delegation_invalid");
  });
});
