import { describe, it, expect, vi } from "vitest";

import { pqc, abstractaccount, crossvm, rdk } from "../../src/messages/qorechain";
import { qorechainRegistry } from "../../src/messages/registry";
import { MsgRegisterKEMKey, MsgRemoveKEMKey } from "../../src/codegen/qorechain/pqc/v1/tx";
import { MsgUpdateConfig } from "../../src/codegen/qorechain/abstractaccount/v1/tx";
import { MsgUpdateParams as CrossVmUpdateParams } from "../../src/codegen/qorechain/crossvm/v1/tx";
import { MsgUpdateParams as RdkUpdateParams } from "../../src/codegen/qorechain/rdk/v1/tx";
import {
  KEM_ALGORITHM_ML_KEM_1024,
  ML_KEM_1024_PUBLIC_KEY_SIZE,
  validateKemPublicKey,
  fetchKemKey,
} from "../../src/pqc/kem";
import { fetchSpendingRules, fetchAuthenticators } from "../../src/abstractaccount";
import { validateEvmDenom, validateSpendingRules } from "../../src/messages/spending-rules";
import { decodeTxError } from "../../src/errors";
import { CHAIN_UPGRADE_V3_2_5 } from "../../src/tx/upgrades";

const ADDR = "qor1hkkxx5jmmw02wcz26c74lsp74qysj6h495vv0k";
const GOV = "qor10d07y265gmmuvt4z0w9aw880jnsr700jp5y6cp";
const json = (body: unknown, status = 200) =>
  vi.fn(async (url: string) => {
    void url;
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  });

// A structurally valid ML-KEM-1024 public key: 1024 coefficients below 3329
// packed 12 bits each (ByteEncode12), then a 32-byte seed.
function goodKey(): Uint8Array {
  const key = new Uint8Array(1568);
  for (let i = 0, c = 0; i < 1536; i += 3, c += 2) {
    const c0 = (c * 37) % 3329;
    const c1 = ((c + 1) * 37) % 3329;
    key[i] = c0 & 0xff;
    key[i + 1] = (c0 >> 8) | ((c1 & 0x0f) << 4);
    key[i + 2] = c1 >> 4;
  }
  key.fill(9, 1536);
  return key;
}

describe("KEM key registry (chain v3.2.5)", () => {
  it("registerKemKey encodes ML-KEM-1024 by default and round-trips through the registry", () => {
    const key = goodKey();
    expect(key.length).toBe(ML_KEM_1024_PUBLIC_KEY_SIZE);
    const any = qorechainRegistry().encodeAsAny(pqc.registerKemKey({ sender: ADDR, publicKey: key }));
    expect(any.typeUrl).toBe("/qorechain.pqc.v1.MsgRegisterKEMKey");
    const back = MsgRegisterKEMKey.decode(any.value);
    expect(back.sender).toBe(ADDR);
    expect(back.algorithmId).toBe(KEM_ALGORITHM_ML_KEM_1024);
    expect(Buffer.from(back.publicKey).equals(Buffer.from(key))).toBe(true);
  });

  it("removeKemKey encodes", () => {
    const any = qorechainRegistry().encodeAsAny(pqc.removeKemKey({ sender: ADDR }));
    expect(any.typeUrl).toBe("/qorechain.pqc.v1.MsgRemoveKEMKey");
    expect(MsgRemoveKEMKey.decode(any.value).sender).toBe(ADDR);
    expect(() => pqc.removeKemKey({})).toThrow(/sender is required/);
  });

  it("refuses a key of the wrong size, out of range or all zero", () => {
    const key = goodKey();
    expect(() => validateKemPublicKey(key.subarray(0, 1567))).toThrow(/1568 bytes, got 1567/);
    const high = new Uint8Array(key);
    high[0] = 0xff;
    high[1] = 0x0f; // first coefficient 0xfff = 4095
    expect(() => validateKemPublicKey(high)).toThrow(/not below 3329/);
    const high2 = new Uint8Array(key);
    high2[4] = 0xf0;
    high2[5] = 0xff; // second coefficient of the second triple: 0xfff
    expect(() => validateKemPublicKey(high2)).toThrow(/not below 3329/);
    const zero = new Uint8Array(1568);
    expect(() => validateKemPublicKey(zero)).toThrow(/all zero/);
    expect(() => pqc.registerKemKey({ sender: ADDR, publicKey: zero })).toThrow(/all zero/);
    // Other algorithm ids pass through to the chain's registry.
    expect(() => validateKemPublicKey(new Uint8Array(10), 9)).not.toThrow();
    expect(() => validateKemPublicKey(new Uint8Array(10), 0)).toThrow(/positive integer/);
  });

  it("fetchKemKey reads and decodes the key", async () => {
    const key = goodKey();
    const f = json({
      found: true,
      key: {
        address: ADDR,
        algorithm_id: 2,
        algorithm_name: "mlkem1024",
        public_key: Buffer.from(key).toString("base64"),
        registered_height: "8979497",
      },
    });
    const res = await fetchKemKey({ rest: "https://rest.example/", address: ADDR, fetch: f as never });
    expect(f.mock.calls[0][0]).toBe(`https://rest.example/qorechain/pqc/v1/kem/${ADDR}`);
    expect(res.found).toBe(true);
    expect(res.key?.algorithmName).toBe("mlkem1024");
    expect(res.key?.registeredHeight).toBe(8979497n);
    expect(Buffer.from(res.key!.publicKey).equals(Buffer.from(key))).toBe(true);
    const none = await fetchKemKey({ rest: "https://rest.example", address: ADDR, fetch: json({ found: false, key: null }) as never });
    expect(none).toEqual({ found: false });
  });

  it("names the registry's refusals, by code and from text", () => {
    expect(decodeTxError({ code: 250, codespace: "pqc" }).kind).toBe("kem_registry_not_enabled");
    expect(decodeTxError({ code: 251, codespace: "pqc" }).kind).toBe("kem_key_invalid");
    expect(decodeTxError({ code: 252, codespace: "pqc" }).kind).toBe("kem_key_not_found");
    expect(decodeTxError({ code: 253, codespace: "pqc" }).kind).toBe("kem_key_unchanged");
    expect(decodeTxError({ code: 254, codespace: "pqc" }).kind).toBe("kem_needs_signature_key");
    const fromText = decodeTxError({
      code: 0,
      rawLog: "failed to execute message; message index: 0: no KEM key published for this account",
    });
    expect([fromText.codespace, fromText.code]).toEqual(["pqc", 252]);
  });
});

describe("spending rules and abstract accounts (chain v3.2.5)", () => {
  const evm = "0x" + "ab".repeat(20);

  it("validateEvmDenom follows the chain's address check", () => {
    expect(() => validateEvmDenom(`erc20/${evm}`)).not.toThrow();
    expect(() => validateEvmDenom(`ERC721/${evm}/7`)).not.toThrow();
    expect(() => validateEvmDenom(`erc1155/0X${"AB".repeat(20)}/1`)).not.toThrow();
    expect(() => validateEvmDenom("uqor")).not.toThrow();
    expect(() => validateEvmDenom(`erc20/${evm}/1`)).toThrow(/contract address alone/);
    expect(() => validateEvmDenom("erc20/0x1234")).toThrow(/20-byte contract address/);
    expect(() => validateEvmDenom(`erc721/${"ab".repeat(20)}`)).toThrow(/0x-prefixed/);
  });

  it("validateSpendingRules applies it to denom limits and allowed denoms", () => {
    expect(() =>
      validateSpendingRules([{ enabled: true, denomLimits: [{ denom: "erc20/0xzz", perTxLimit: "1" }] }]),
    ).toThrow(/spending rule 0: denom "erc20\/0xzz"/);
    expect(() => validateSpendingRules([{ enabled: true, allowedDenoms: ["erc1155/nope"] }])).toThrow(
      /spending rule 0: denom "erc1155\/nope"/,
    );
    expect(() =>
      validateSpendingRules([{ enabled: true, denomLimits: [{ denom: `erc20/${evm}`, perTxLimit: "1" }] }]),
    ).not.toThrow();
  });

  it("names ErrInvalidSpendingRule (code 8) and the disabled module (code 9)", () => {
    expect(decodeTxError({ code: 8, codespace: "abstractaccount" }).kind).toBe("invalid_spending_rule");
    expect(decodeTxError({ code: 9, codespace: "abstractaccount" }).kind).toBe("abstractaccount_disabled");
    const t = decodeTxError({ code: 0, rawLog: "rule 0: denom x: invalid spending rule" });
    expect([t.codespace, t.code]).toEqual(["abstractaccount", 8]);
  });

  it("updateConfig is checked and encodes", () => {
    const value = { authority: GOV, enabled: true, maxSessionKeys: 10, maxSpendingRules: 5, defaultSessionTtl: 86400n };
    const any = qorechainRegistry().encodeAsAny(abstractaccount.updateConfig(value));
    expect(any.typeUrl).toBe("/qorechain.abstractaccount.v1.MsgUpdateConfig");
    expect(MsgUpdateConfig.decode(any.value)).toMatchObject({ authority: GOV, enabled: true, maxSessionKeys: 10 });
    expect(() => abstractaccount.updateConfig({ ...value, authority: "" })).toThrow(/authority/);
    expect(() => abstractaccount.updateConfig({ ...value, maxSpendingRules: 0 })).toThrow(/maxSpendingRules/);
    expect(() => abstractaccount.updateConfig({ ...value, defaultSessionTtl: 0n })).toThrow(/defaultSessionTtl/);
  });

  it("reads spending rules and authenticators", async () => {
    const f1 = json({
      rules: [{ id: "r1", daily_limit: "100", per_tx_limit: "10", allowed_denoms: ["uqor"], enabled: true, denom_limits: [] }],
      authenticator_rules: [{ scheme: "eth", pubkey_hex: "02ab", rule: { id: "k", enabled: true, per_tx_limit: "5" } }],
    });
    const rules = await fetchSpendingRules({ rest: "https://rest.example", address: ADDR, fetch: f1 as never });
    expect(f1.mock.calls[0][0]).toBe(`https://rest.example/qorechain/abstractaccount/v1/accounts/${ADDR}/spending_rules`);
    expect(rules.rules[0]).toMatchObject({ id: "r1", dailyLimit: 100n, perTxLimit: 10n, enabled: true });
    expect(rules.authenticatorRules[0]).toMatchObject({ scheme: "eth", pubkeyHex: "02ab" });
    expect(rules.authenticatorRules[0].rule.perTxLimit).toBe(5n);

    const f2 = json({
      authenticators: [
        { scheme: "ed25519", pubkey_hex: "aa", permissions: ["bank_send"], expiry_unix: "1900000000", label: "phantom", created_at_unix: "1800000000", revoked: false, has_spend_rule: true },
      ],
    });
    const auths = await fetchAuthenticators({ rest: "https://rest.example", address: ADDR, fetch: f2 as never });
    expect(f2.mock.calls[0][0]).toBe(`https://rest.example/qorechain/abstractaccount/v1/accounts/${ADDR}/authenticators`);
    expect(auths[0]).toMatchObject({ scheme: "ed25519", label: "phantom", expiryUnix: 1900000000n, hasSpendRule: true, revoked: false });
  });
});

describe("crossvm and rdk governance parameters (chain v3.2.5)", () => {
  const cv = { authority: GOV, maxMessageSize: 65536n, maxQueueSize: 1000, queueTimeoutBlocks: 100n, enabled: true };

  it("crossvm updateParams is checked and encodes", () => {
    const any = qorechainRegistry().encodeAsAny(crossvm.updateParams({ ...cv, bridgeAllowedTargets: [`cosmwasm:${ADDR}`] }));
    expect(any.typeUrl).toBe("/qorechain.crossvm.v1.MsgUpdateParams");
    expect(CrossVmUpdateParams.decode(any.value).bridgeAllowedTargets).toEqual([`cosmwasm:${ADDR}`]);
    expect(() => crossvm.updateParams({ ...cv, bridgeAllowedTargets: [`evm:${ADDR}`] })).toThrow(/only calls cosmwasm/);
    expect(() => crossvm.updateParams({ ...cv, bridgeAllowedTargets: ["cosmwasm:qor1bad"] })).toThrow(/invalid contract address/);
    expect(() =>
      crossvm.updateParams({ ...cv, bridgeAllowedTargets: [`cosmwasm:${ADDR}`, `cosmwasm:${ADDR}`] }),
    ).toThrow(/listed twice/);
    expect(() => crossvm.updateParams({ ...cv, maxQueueSize: 10_001 })).toThrow(/exceeds 10000/);
    expect(() => crossvm.updateParams({ ...cv, maxMessageSize: 0n })).toThrow(/maxMessageSize/);
  });

  it("rdk updateParams is checked and encodes", () => {
    const p = {
      authority: GOV,
      maxRollups: 100,
      minStakeForRollup: 10_000_000_000n,
      rollupCreationBurnRate: "0.010000000000000000",
      defaultChallengeWindow: 604800n,
      maxDaBlobSize: 2_097_152n,
      blobRetentionBlocks: 432000n,
      maxBatchesPerBlock: 10,
    };
    const any = qorechainRegistry().encodeAsAny(rdk.updateParams(p));
    expect(any.typeUrl).toBe("/qorechain.rdk.v1.MsgUpdateParams");
    expect(RdkUpdateParams.decode(any.value)).toMatchObject({ authority: GOV, maxRollups: 100 });
    expect(() => rdk.updateParams({ ...p, rollupCreationBurnRate: "1" })).toThrow(/\[0, 1\)/);
    expect(() => rdk.updateParams({ ...p, rollupCreationBurnRate: "-0.1" })).toThrow(/\[0, 1\)/);
    expect(() => rdk.updateParams({ ...p, defaultChallengeWindow: 59n })).toThrow(/60\.\.2592000/);
    expect(() => rdk.updateParams({ ...p, maxDaBlobSize: (8n << 20n) + 1n })).toThrow(/exceeds/);
  });

  it("CHAIN_UPGRADE_V3_2_5 is the plan name", () => {
    expect(CHAIN_UPGRADE_V3_2_5).toBe("v3.2.5");
  });
});
