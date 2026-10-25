import { describe, it, expect, vi } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1";
import { ripemd160 } from "@noble/hashes/ripemd160";
import { sha256 } from "@noble/hashes/sha256";
import { bech32 } from "bech32";

import {
  ensurePqcRegistered,
  clearPqcStatusCache,
  fetchPqcStatus,
  migrateToHybrid,
  isRegisteredPqcKey,
  pqcStatusPublicKey,
  PqcKeyMismatchError,
} from "../../src/helpers";
import { generatePqcKeypair } from "../../src/accounts/pqc";
import type { TxClient } from "../../src/tx/builder";

const ECDSA = secp256k1.getPublicKey(new Uint8Array(32).fill(0x11), true);
const ADDR = bech32.encode("qor", bech32.toWords(ripemd160(sha256(ECDSA))));
const MINE = generatePqcKeypair(new Uint8Array(32).fill(2));
const OTHER = generatePqcKeypair(new Uint8Array(32).fill(3));
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

function fakeTx(signAndBroadcast = vi.fn(async () => ({ transactionHash: "DEADBEEF", code: 0 }))) {
  return { tx: { senderAddress: ADDR, signAndBroadcast } as unknown as TxClient, signAndBroadcast };
}
function restWith(...keys: (Uint8Array | null)[]) {
  let i = 0;
  return vi.fn(async () => {
    const k = keys[Math.min(i++, keys.length - 1)];
    return { ok: true, status: 200, json: async () => (k ? { found: true, account: { public_key: b64(k) } } : { found: false, account: null }) };
  });
}

describe("ensurePqcRegistered compares the registered key with the caller's", () => {
  it("throws PqcKeyMismatchError, and sends nothing, when another key is registered", async () => {
    clearPqcStatusCache();
    const { tx, signAndBroadcast } = fakeTx();
    const fetch = restWith(OTHER.publicKey);
    const err = await ensurePqcRegistered(tx, { pqcKeypair: MINE, rest: "https://lcd", fetch }).catch((e) => e);
    expect(err).toBeInstanceOf(PqcKeyMismatchError);
    expect(err.kind).toBe("pqc_key_mismatch");
    expect(err.address).toBe(ADDR);
    expect(err.registeredPublicKey).toEqual(OTHER.publicKey);
    expect(err.message).toMatch(/different PQC key/);
    expect(signAndBroadcast).not.toHaveBeenCalled();
    // The mismatch is confirmed with a fresh (uncached) read before throwing.
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("re-reads before throwing, so a cached key from before a rotation does not raise a false alarm", async () => {
    clearPqcStatusCache();
    const { tx } = fakeTx();
    await fetchPqcStatus({ rest: "https://lcd", address: ADDR, fetch: restWith(OTHER.publicKey) }); // cached: old key
    const res = await ensurePqcRegistered(tx, { pqcKeypair: MINE, rest: "https://lcd", fetch: restWith(MINE.publicKey) });
    expect(res.alreadyRegistered).toBe(true);
  });

  it("migrateToHybrid refuses to bind a keypair the chain does not hold", async () => {
    clearPqcStatusCache();
    const { tx } = fakeTx();
    await expect(
      migrateToHybrid(tx, { pqcKeypair: MINE, rest: "https://lcd", fetch: restWith(OTHER.publicKey) }),
    ).rejects.toBeInstanceOf(PqcKeyMismatchError);
  });

  it("checks a pre-read status too, hex or bytes", async () => {
    const { tx, signAndBroadcast } = fakeTx();
    await expect(
      ensurePqcRegistered(tx, { pqcKeypair: MINE, status: { registered: true, pubkey: hex(OTHER.publicKey) } }),
    ).rejects.toBeInstanceOf(PqcKeyMismatchError);
    await expect(
      ensurePqcRegistered(tx, { pqcKeypair: MINE, status: { registered: true, pubkey: MINE.publicKey } }),
    ).resolves.toEqual({ alreadyRegistered: true, keyVerified: true });
    expect(signAndBroadcast).not.toHaveBeenCalled();
  });

  it("does not count a status without a key as a match", async () => {
    const { tx, signAndBroadcast } = fakeTx();
    // Nothing to read the key from: registered, but not verified as yours.
    await expect(ensurePqcRegistered(tx, { pqcKeypair: MINE, status: { registered: true } })).resolves.toEqual({
      alreadyRegistered: true,
      keyVerified: false,
    });
    // With rest, the key is read and compared.
    clearPqcStatusCache();
    await expect(
      ensurePqcRegistered(tx, { pqcKeypair: MINE, status: { registered: true }, rest: "https://lcd", fetch: restWith(MINE.publicKey) }),
    ).resolves.toEqual({ alreadyRegistered: true, keyVerified: true });
    clearPqcStatusCache();
    await expect(
      ensurePqcRegistered(tx, { pqcKeypair: MINE, status: { registered: true }, rest: "https://lcd", fetch: restWith(OTHER.publicKey) }),
    ).rejects.toBeInstanceOf(PqcKeyMismatchError);
    expect(signAndBroadcast).not.toHaveBeenCalled();
  });

  it("on the chain's 'already registered' refusal (a race), reads the key and throws if it is not the caller's", async () => {
    clearPqcStatusCache();
    const refused = vi.fn(async () => {
      throw Object.assign(new Error("tx failed"), { code: 7, codespace: "pqc", rawLog: "PQC account already registered" });
    });
    const { tx } = fakeTx(refused);
    // First read: not registered. Then someone registers OTHER before our tx lands.
    await expect(
      ensurePqcRegistered(tx, { pqcKeypair: MINE, rest: "https://lcd", fetch: restWith(null, OTHER.publicKey) }),
    ).rejects.toBeInstanceOf(PqcKeyMismatchError);
    clearPqcStatusCache();
    await expect(
      ensurePqcRegistered(tx, { pqcKeypair: MINE, rest: "https://lcd", fetch: restWith(null, MINE.publicKey) }),
    ).resolves.toEqual({ alreadyRegistered: true, keyVerified: true });
  });

  it("the positive cache keeps the key, so a cached answer can still be compared", async () => {
    clearPqcStatusCache();
    const fetch = restWith(MINE.publicKey);
    await fetchPqcStatus({ rest: "https://lcd", address: ADDR, fetch });
    const again = await fetchPqcStatus({ rest: "https://lcd", address: ADDR, fetch });
    expect(fetch).toHaveBeenCalledOnce();
    expect(pqcStatusPublicKey(again)).toEqual(MINE.publicKey);
    expect(isRegisteredPqcKey(again, MINE.publicKey)).toBe(true);
    expect(isRegisteredPqcKey(again, OTHER.publicKey)).toBe(false);
    expect(isRegisteredPqcKey({ registered: true }, MINE.publicKey)).toBeUndefined();
  });
});
