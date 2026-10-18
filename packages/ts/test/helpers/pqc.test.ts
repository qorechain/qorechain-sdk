import { describe, it, expect, vi } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1";
import { ripemd160 } from "@noble/hashes/ripemd160";
import { sha256 } from "@noble/hashes/sha256";
import { bech32 } from "bech32";

import {
  isPqcRegistered,
  getPqcStatus,
  ensurePqcRegistered,
  clearPqcStatusCache,
  buildRegisterPqcKeyMsg,
  migratePqcKey,
  migrateToHybrid,
  PQC_KEY_STATUS_PRECOMPILE_ADDRESS,
} from "../../src/helpers";
import { generatePqcKeypair } from "../../src/accounts/pqc";
import type { TxClient } from "../../src/tx/builder";
import type { QorClient } from "../../src/query/qor";
import { MsgRegisterPQCKeyV2, MsgMigratePQCKey } from "../../src/codegen/qorechain/pqc/v1/tx";

// A real secp256k1 key and the account it derives to (cosmos path), because
// from chain v3.2.2 the registration's ecdsa_pubkey must belong to the sender.
const ECDSA = secp256k1.getPublicKey(new Uint8Array(32).fill(0x11), true);
const ADDR = bech32.encode("qor", bech32.toWords(ripemd160(sha256(ECDSA))));

/** A fake QorClient returning a fixed getPQCKeyStatus payload. */
function fakeQor(payload: unknown) {
  const getPqcKeyStatus = vi.fn(async () => payload);
  const qor = { getPqcKeyStatus } as unknown as QorClient;
  return { qor, getPqcKeyStatus };
}

/** A fake TxClient capturing the messages handed to signAndBroadcast. */
function fakeTx() {
  const signAndBroadcast = vi.fn(async () => ({
    transactionHash: "DEADBEEF",
    code: 0,
  }));
  const tx = { senderAddress: ADDR, signAndBroadcast } as unknown as TxClient;
  return { tx, signAndBroadcast };
}

describe("getPqcStatus / isPqcRegistered", () => {
  it("normalizes a registered status (camelCase fields)", async () => {
    const { qor } = fakeQor({
      registered: true,
      algorithmId: 2,
      pubkey: "0xabcd",
    });
    const status = await getPqcStatus(qor, ADDR);
    expect(status).toEqual({ registered: true, algorithmId: 2, pubkey: "0xabcd" });
    expect(await isPqcRegistered(qor, ADDR)).toBe(true);
  });

  it("normalizes snake_case + string fields", async () => {
    const { qor } = fakeQor({
      registered: "true",
      algorithm_id: "2",
      public_key: "0x1234",
    });
    const status = await getPqcStatus(qor, ADDR);
    expect(status.registered).toBe(true);
    expect(status.algorithmId).toBe(2);
    expect(status.pubkey).toBe("0x1234");
  });

  it("reads an explicit registered: false as not registered", async () => {
    const { qor } = fakeQor({ registered: false });
    expect(await isPqcRegistered(qor, ADDR)).toBe(false);
  });

  it("refuses to read an empty answer as 'not registered'", async () => {
    const { qor: nullQor } = fakeQor(null);
    await expect(isPqcRegistered(nullQor, ADDR)).rejects.toThrow(/cannot tell/);
  });

  it("accepts a source exposing `.qor` (composed client)", async () => {
    const { qor, getPqcKeyStatus } = fakeQor({ registered: true });
    const source = { qor };
    expect(await isPqcRegistered(source, ADDR)).toBe(true);
    expect(getPqcKeyStatus).toHaveBeenCalledWith(ADDR);
  });

  it("exposes the precompile address as the documented alternative", () => {
    expect(PQC_KEY_STATUS_PRECOMPILE_ADDRESS).toBe(
      "0x0000000000000000000000000000000000000A02",
    );
  });
});

describe("buildRegisterPqcKeyMsg", () => {
  it("builds MsgRegisterPQCKeyV2 with the signer's ML-DSA-87 pubkey", () => {
    const kp = generatePqcKeypair();
    const ecdsa = ECDSA;
    const m = buildRegisterPqcKeyMsg(ADDR, {
      pqcKeypair: kp,
      ecdsaPubkey: ecdsa,
    });
    expect(m.typeUrl).toBe("/qorechain.pqc.v1.MsgRegisterPQCKeyV2");
    const v = m.value as MsgRegisterPQCKeyV2;
    expect(v.sender).toBe(ADDR);
    expect(v.publicKey).toEqual(kp.publicKey);
    expect(v.algorithmId).toBe(1); // AlgorithmDilithium5 (ML-DSA-87)
    expect(v.ecdsaPubkey).toEqual(ecdsa);
    expect(v.keyType).toBe("hybrid"); // default
  });

  it("defaults the ecdsa pubkey to empty when omitted", () => {
    const kp = generatePqcKeypair();
    const m = buildRegisterPqcKeyMsg(ADDR, { pqcKeypair: kp, keyType: "pqc" });
    const v = m.value as MsgRegisterPQCKeyV2;
    expect(v.ecdsaPubkey).toEqual(new Uint8Array(0));
    expect(v.keyType).toBe("pqc");
  });
});

describe("ensurePqcRegistered", () => {
  it("skips registration when already registered (idempotent)", async () => {
    const { tx, signAndBroadcast } = fakeTx();
    const { qor } = fakeQor({ registered: true });
    const kp = generatePqcKeypair();
    const res = await ensurePqcRegistered(tx, {
      pqcKeypair: kp,
      statusSource: qor,
    });
    expect(res.alreadyRegistered).toBe(true);
    expect(res.txHash).toBeUndefined();
    expect(signAndBroadcast).not.toHaveBeenCalled();
  });

  it("registers when not registered and returns the tx hash", async () => {
    const { tx, signAndBroadcast } = fakeTx();
    const { qor } = fakeQor({ registered: false });
    const kp = generatePqcKeypair();
    const res = await ensurePqcRegistered(tx, {
      pqcKeypair: kp,
      ecdsaPubkey: ECDSA,
      statusSource: qor,
    });
    expect(res.alreadyRegistered).toBe(false);
    expect(res.txHash).toBe("DEADBEEF");
    expect(signAndBroadcast).toHaveBeenCalledOnce();
    const [messages] = signAndBroadcast.mock.calls[0];
    const v = (messages as { value: MsgRegisterPQCKeyV2 }[])[0].value;
    expect(v.publicKey).toEqual(kp.publicKey);
  });

  it("refuses to register blind when it has no way to check", async () => {
    const { tx, signAndBroadcast } = fakeTx();
    const kp = generatePqcKeypair();
    await expect(ensurePqcRegistered(tx, { pqcKeypair: kp })).rejects.toThrow(/pass `rest`/);
    expect(signAndBroadcast).not.toHaveBeenCalled();
  });

  it("registers without a check only when forced", async () => {
    const { tx, signAndBroadcast } = fakeTx();
    const res = await ensurePqcRegistered(tx, { pqcKeypair: generatePqcKeypair(), force: true });
    expect(res.alreadyRegistered).toBe(false);
    expect(signAndBroadcast).toHaveBeenCalledOnce();
  });

  it("checks over REST (singular route, `found`) and skips a registered key", async () => {
    clearPqcStatusCache();
    const { tx, signAndBroadcast } = fakeTx();
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ found: true, account: { address: ADDR, public_key: "AAAA" } }),
    }));
    const res = await ensurePqcRegistered(tx, { pqcKeypair: generatePqcKeypair(), rest: "https://lcd/", fetch });
    expect(res.alreadyRegistered).toBe(true);
    expect(signAndBroadcast).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(`https://lcd/qorechain/pqc/v1/account/${ADDR}`);
    // A positive answer is cached: the next call asks nobody.
    await ensurePqcRegistered(tx, { pqcKeypair: generatePqcKeypair(), rest: "https://lcd", fetch });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("registers over REST when the chain says found: false", async () => {
    clearPqcStatusCache();
    const { tx, signAndBroadcast } = fakeTx();
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ found: false, account: null }) }));
    const res = await ensurePqcRegistered(tx, { pqcKeypair: generatePqcKeypair(), rest: "https://lcd", fetch });
    expect(res.alreadyRegistered).toBe(false);
    expect(signAndBroadcast).toHaveBeenCalledOnce();
  });

  it("never reads an unclear answer as 'not registered': retries, then throws", async () => {
    clearPqcStatusCache();
    const { tx, signAndBroadcast } = fakeTx();
    for (const answer of [
      { ok: false, status: 501, json: async () => ({ code: 12 }) },
      { ok: true, status: 200, json: async () => ({ registered: false }) },
    ]) {
      const fetch = vi.fn(async () => answer);
      await expect(
        ensurePqcRegistered(tx, { pqcKeypair: generatePqcKeypair(), rest: "https://lcd", fetch }),
      ).rejects.toThrow(/cannot tell/);
      expect(fetch).toHaveBeenCalledTimes(2);
    }
    expect(signAndBroadcast).not.toHaveBeenCalled();
  });

  it("treats the chain's 'already registered' refusal as success", async () => {
    const tx = {
      senderAddress: ADDR,
      signAndBroadcast: vi.fn(async () => {
        throw Object.assign(new Error("tx failed"), { code: 7, codespace: "pqc", rawLog: "PQC account already registered" });
      }),
    } as unknown as TxClient;
    const res = await ensurePqcRegistered(tx, { pqcKeypair: generatePqcKeypair(), force: true });
    expect(res.alreadyRegistered).toBe(true);
  });

  it("honors a pre-read status to avoid a redundant round-trip", async () => {
    const { tx, signAndBroadcast } = fakeTx();
    const kp = generatePqcKeypair();
    const res = await ensurePqcRegistered(tx, {
      pqcKeypair: kp,
      status: { registered: true },
    });
    expect(res.alreadyRegistered).toBe(true);
    expect(signAndBroadcast).not.toHaveBeenCalled();
  });
});

describe("migratePqcKey", () => {
  it("builds + broadcasts MsgMigratePQCKey", async () => {
    const { tx, signAndBroadcast } = fakeTx();
    const res = await migratePqcKey(tx, {
      oldPublicKey: new Uint8Array([1]),
      newPublicKey: new Uint8Array([2]),
      oldSignature: new Uint8Array([3]),
      newSignature: new Uint8Array([4]),
    });
    expect(res.transactionHash).toBe("DEADBEEF");
    const [messages] = signAndBroadcast.mock.calls[0];
    const m = (messages as { typeUrl: string; value: MsgMigratePQCKey }[])[0];
    expect(m.typeUrl).toBe("/qorechain.pqc.v1.MsgMigratePQCKey");
    expect(m.value.sender).toBe(ADDR);
    expect(m.value.newAlgorithmId).toBe(1); // Dilithium-5 default
  });
});

describe("migrateToHybrid", () => {
  it("ensures registration and returns a hybrid send path with the keypair bound", async () => {
    const { tx } = fakeTx();
    const { qor } = fakeQor({ registered: true });
    const kp = generatePqcKeypair();
    const path = await migrateToHybrid(tx, {
      pqcKeypair: kp,
      statusSource: qor,
    });
    expect(path.alreadyRegistered).toBe(true);
    expect(path.pqcKeypair).toBe(kp);
    expect(typeof path.buildHybridTx).toBe("function");
    expect(typeof path.signAndBroadcastHybrid).toBe("function");
  });
});
