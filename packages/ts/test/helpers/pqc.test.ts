import { describe, it, expect, vi } from "vitest";

import {
  isPqcRegistered,
  getPqcStatus,
  ensurePqcRegistered,
  buildRegisterPqcKeyMsg,
  migratePqcKey,
  migrateToHybrid,
  PQC_KEY_STATUS_PRECOMPILE_ADDRESS,
} from "../../src/helpers";
import { generatePqcKeypair } from "../../src/accounts/pqc";
import type { TxClient } from "../../src/tx/builder";
import type { QorClient } from "../../src/query/qor";
import { MsgRegisterPQCKey, MsgMigratePQCKey } from "../../src/codegen/qorechain/pqc/v1/tx";

const ADDR = "qor15yk64u7zc9g9k2yr2wmzeva5qgwxps6yjecvvu";

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

  it("treats an unregistered / empty response as not registered", async () => {
    const { qor } = fakeQor({ registered: false });
    expect(await isPqcRegistered(qor, ADDR)).toBe(false);
    const { qor: nullQor } = fakeQor(null);
    expect(await isPqcRegistered(nullQor, ADDR)).toBe(false);
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
  it("builds MsgRegisterPQCKey with the signer's Dilithium pubkey", () => {
    const kp = generatePqcKeypair();
    const ecdsa = new Uint8Array([1, 2, 3]);
    const m = buildRegisterPqcKeyMsg(ADDR, {
      pqcKeypair: kp,
      ecdsaPubkey: ecdsa,
    });
    expect(m.typeUrl).toBe("/qorechain.pqc.v1.MsgRegisterPQCKey");
    const v = m.value as MsgRegisterPQCKey;
    expect(v.sender).toBe(ADDR);
    expect(v.dilithiumPubkey).toEqual(kp.publicKey);
    expect(v.ecdsaPubkey).toEqual(ecdsa);
    expect(v.keyType).toBe("hybrid"); // default
  });

  it("defaults the ecdsa pubkey to empty when omitted", () => {
    const kp = generatePqcKeypair();
    const m = buildRegisterPqcKeyMsg(ADDR, { pqcKeypair: kp, keyType: "pqc" });
    const v = m.value as MsgRegisterPQCKey;
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
      ecdsaPubkey: new Uint8Array([9, 9]),
      statusSource: qor,
    });
    expect(res.alreadyRegistered).toBe(false);
    expect(res.txHash).toBe("DEADBEEF");
    expect(signAndBroadcast).toHaveBeenCalledOnce();
    const [messages] = signAndBroadcast.mock.calls[0];
    const v = (messages as { value: MsgRegisterPQCKey }[])[0].value;
    expect(v.dilithiumPubkey).toEqual(kp.publicKey);
  });

  it("broadcasts unconditionally when no status source is provided", async () => {
    const { tx, signAndBroadcast } = fakeTx();
    const kp = generatePqcKeypair();
    const res = await ensurePqcRegistered(tx, { pqcKeypair: kp });
    expect(res.alreadyRegistered).toBe(false);
    expect(signAndBroadcast).toHaveBeenCalledOnce();
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
