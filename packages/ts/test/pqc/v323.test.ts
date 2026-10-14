import { describe, it, expect, vi } from "vitest";
import { shake256 } from "@noble/hashes/sha3";

import {
  KEY_TYPE_CLASSICAL_ONLY,
  isDegeneratePqcPublicKey,
  proofOfPossessionSignBytes,
  signProofOfPossession,
  validateRegisteredPqcKey,
  verifyProofOfPossession,
} from "../../src/pqc/key-integrity";
import { MAX_EVM_WINDOW_TARGETS, fetchEvmWindow, openEvmWindowMsg } from "../../src/pqc/evm-window";
import {
  evmAuthSignBytes,
  evmAuthSignBytesV2,
  resolveEvmAuthDigestVersion,
} from "../../src/tx/authenticator";
import { clearUpgradeCache } from "../../src/tx/upgrades";
import { buildRegisterPqcKeyMsg } from "../../src/helpers/pqc";
import { generatePqcKeypair } from "../../src/accounts/pqc";
import { decodeTxError } from "../../src/errors";
import { qorechainRegistry } from "../../src/messages/registry";
import { MsgOpenEVMWindow, MsgRegisterPQCKeyV2 } from "../../src/codegen/qorechain/pqc/v1/tx";

const SENDER = "qor18df074t3k0xq8jf7336hpjjsktw354knr650aq";
const TARGET = "0x63C0c19a282a1B52b07dD5a65b58948A07DAE32B";

function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
function unhex(s: string): Uint8Array {
  return Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));
}
function json(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("registration integrity (chain v3.2.3)", () => {
  const kp = generatePqcKeypair(new Uint8Array(32).fill(1));

  it("refuses classical_only, empty and degenerate keys", () => {
    expect(() => validateRegisteredPqcKey(KEY_TYPE_CLASSICAL_ONLY, kp.publicKey)).toThrow(/classical_only/);
    expect(() => validateRegisteredPqcKey("hybrid", new Uint8Array(0))).toThrow(/required/);
    const degenerate = new Uint8Array(2592);
    degenerate.set(kp.publicKey.subarray(0, 32));
    expect(isDegeneratePqcPublicKey(degenerate)).toBe(true);
    expect(() => validateRegisteredPqcKey("hybrid", degenerate)).toThrow(/t1/);
    expect(isDegeneratePqcPublicKey(kp.publicKey)).toBe(false);
    expect(() => validateRegisteredPqcKey("hybrid", kp.publicKey)).not.toThrow();
  });

  it("is applied by buildRegisterPqcKeyMsg", () => {
    expect(() => buildRegisterPqcKeyMsg(SENDER, { pqcKeypair: kp, keyType: KEY_TYPE_CLASSICAL_ONLY })).toThrow();
  });
});

describe("proof of possession (chain v3.2.3)", () => {
  const kp = generatePqcKeypair(new Uint8Array(32).fill(1));

  it("signs the chain's bytes: domain|chain|algo|account|lower-case hex", () => {
    const bytes = new TextDecoder().decode(
      proofOfPossessionSignBytes({ chainId: "qorechain-diana", account: SENDER, publicKey: unhex("ABCD") }),
    );
    expect(bytes).toBe(`qorechain-pqc-pop-v1|qorechain-diana|1|${SENDER}|abcd`);
  });

  it("produces a deterministic proof that verifies, and binds chain and account", () => {
    const a = signProofOfPossession({ chainId: "qorechain-diana", account: SENDER, keypair: kp });
    const b = signProofOfPossession({ chainId: "qorechain-diana", account: SENDER, keypair: kp });
    expect(hex(a)).toBe(hex(b));
    expect(a.length).toBe(4627);
    const ok = { chainId: "qorechain-diana", account: SENDER, publicKey: kp.publicKey, proof: a };
    expect(verifyProofOfPossession(ok)).toBe(true);
    expect(verifyProofOfPossession({ ...ok, chainId: "qorechain-vladi" })).toBe(false);
    expect(verifyProofOfPossession({ ...ok, account: "qor1hkkxx5jmmw02wcz26c74lsp74qysj6h495vv0k" })).toBe(false);
    // Cross-language vector: the same proof, fingerprinted, in every SDK.
    expect(hex(shake256(a, { dkLen: 16 }))).toBe("5b767a00efb7ad721f5416a4bd7fcdad");
  });

  it("is carried by MsgRegisterPQCKeyV2 when given, and absent otherwise", () => {
    const proof = signProofOfPossession({ chainId: "qorechain-diana", account: SENDER, keypair: kp });
    const withProof = qorechainRegistry().encodeAsAny(
      buildRegisterPqcKeyMsg(SENDER, { pqcKeypair: kp, proofOfPossession: proof }),
    );
    expect(MsgRegisterPQCKeyV2.decode(withProof.value).proofOfPossession).toEqual(proof);
    const without = qorechainRegistry().encodeAsAny(buildRegisterPqcKeyMsg(SENDER, { pqcKeypair: kp }));
    // Field 6 must stay off the wire for nodes below v3.2.3.
    expect(without.value.length).toBe(withProof.value.length - proof.length - 3);
  });
});

describe("EVM window scope (chain v3.2.3)", () => {
  it("encodes nativeOnly and allowedTargets, and leaves them off the wire when unset", () => {
    const plain = qorechainRegistry().encodeAsAny(
      openEvmWindowMsg({ sender: SENDER, blocks: 10, maxTxs: 1, maxValue: 1 }),
    );
    const scoped = qorechainRegistry().encodeAsAny(
      openEvmWindowMsg({ sender: SENDER, blocks: 10, maxTxs: 1, maxValue: 1, nativeOnly: true, allowedTargets: [TARGET] }),
    );
    const back = MsgOpenEVMWindow.decode(scoped.value);
    expect(back.nativeOnly).toBe(true);
    expect(back.allowedTargets).toEqual([TARGET]);
    const plainBack = MsgOpenEVMWindow.decode(plain.value);
    expect(plainBack.nativeOnly).toBe(false);
    expect(plainBack.allowedTargets).toEqual([]);
    expect(plain.value.length).toBeLessThan(scoped.value.length);
  });

  it("enforces the target rules", () => {
    const base = { sender: SENDER, blocks: 10, maxTxs: 1, maxValue: 1 };
    expect(() => openEvmWindowMsg({ ...base, allowedTargets: ["0x1234"] })).toThrow(/20-byte/);
    expect(() => openEvmWindowMsg({ ...base, allowedTargets: [TARGET, TARGET.toLowerCase()] })).toThrow(/more than once/);
    const many = Array.from({ length: MAX_EVM_WINDOW_TARGETS + 1 }, (_, i) => "0x" + i.toString(16).padStart(40, "0"));
    expect(() => openEvmWindowMsg({ ...base, allowedTargets: many })).toThrow(/maximum is 16/);
  });

  it("reads the scope back from the query", async () => {
    const fetch = vi.fn(async () => json({ found: true, live: true, native_only: true, allowed_targets: [TARGET] }));
    const w = await fetchEvmWindow({ rest: "https://lcd", address: SENDER, fetch });
    expect(w.nativeOnly).toBe(true);
    expect(w.allowedTargets).toEqual([TARGET]);
  });
});

describe("abstract-account EVM digest v2 (chain v3.2.3)", () => {
  // Computed with the chain's own EVMAuthSignBytes / EVMAuthSignBytesV2
  // (x/abstractaccount/types/evm_sign.go at the frozen v3.2.3 commit).
  const input = {
    chainId: "qorechain-diana",
    account: "qor1hkkxx5jmmw02wcz26c74lsp74qysj6h495vv0k",
    pubkey: unhex("038844ec286297bf780ce0fbe07df2a74c5e0e841df5f3adc363f0372755b76d74"),
    to: "0x63c0c19a282a1b52b07dd5a65b58948a07dae32b",
    value: "1000",
    data: unhex("a9059cbb"),
    nonce: 7,
  };

  it("matches the chain byte for byte", () => {
    expect(hex(evmAuthSignBytes(input))).toBe("c2614c477a15020777adb1e889748557debc6dece7207ded95d30ee6d7bd778a");
    expect(hex(evmAuthSignBytesV2({ ...input, gasLimit: 250000 }))).toBe(
      "19d7518ad25079dff616819b7554d7d39700fb9e4331a6cbc635685122f0c18b",
    );
  });

  it("refuses a zero gas limit", () => {
    expect(() => evmAuthSignBytesV2({ ...input, gasLimit: 0 })).toThrow(/gasLimit/);
  });

  it("picks v2 only once v3.2.3 is applied", async () => {
    clearUpgradeCache();
    expect(await resolveEvmAuthDigestVersion({ rest: "https://a", fetch: vi.fn(async () => json({ height: "0" })) })).toBe("v1");
    expect(await resolveEvmAuthDigestVersion({ rest: "https://b", fetch: vi.fn(async () => json({ height: "8003746" })) })).toBe("v2");
  });
});

describe("decodeTxError: chain v3.2.3", () => {
  it.each([
    [230, "pqc_key_weak"],
    [231, "pqc_proof_of_possession_invalid"],
    [232, "pqc_key_reused"],
    [233, "pqc_last_signature_algorithm"],
    [234, "pqc_maintenance_needs_hybrid"],
  ])("pqc %i → %s", (code, kind) => {
    expect(decodeTxError({ code, codespace: "pqc" }).kind).toBe(kind);
  });

  it("knows MsgUpdateAuthority", () => {
    expect(qorechainRegistry().lookupType("/qorechain.license.v1.MsgUpdateAuthority")).toBeDefined();
  });
});
