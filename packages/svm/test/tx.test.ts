import { describe, it, expect, vi } from "vitest";
import { Keypair, PublicKey, SystemInstruction, SystemProgram, Transaction } from "@solana/web3.js";
import { createSvmClient } from "../src/index";

const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";

function fakeConnection(overrides: Record<string, unknown> = {}) {
  return {
    rpcEndpoint: "http://localhost:8899",
    commitment: "confirmed",
    getLatestBlockhash: vi.fn(async () => ({
      blockhash: "FakeBlockhash1111111111111111111111111111111",
      lastValidBlockHeight: 100,
    })),
    sendRawTransaction: vi.fn(async () => "sig-raw"),
    confirmTransaction: vi.fn(async () => ({ value: { err: null } })),
    simulateTransaction: vi.fn(async () => ({ value: { err: null, logs: ["ok"] } })),
    ...overrides,
  };
}

describe("transferSol", () => {
  it("builds a Transaction containing a SystemProgram.transfer with correct from/to/lamports", () => {
    const from = Keypair.fromSeed(new Uint8Array(32).fill(1));
    const to = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey;
    const conn = fakeConnection();
    const client = createSvmClient({ connection: conn as never });

    const tx = client.buildTransferSol({ from, to, lamports: 1234 });
    expect(tx).toBeInstanceOf(Transaction);
    expect(tx.instructions).toHaveLength(1);

    const ix = tx.instructions[0];
    expect(ix.programId.toBase58()).toBe(SYSTEM_PROGRAM_ID);
    // The instruction references both the source and destination accounts.
    const keyStrings = ix.keys.map((k) => k.pubkey.toBase58());
    expect(keyStrings).toContain(from.publicKey.toBase58());
    expect(keyStrings).toContain(to.toBase58());

    // Decode lamports from the SystemProgram instruction layout.
    const decoded = SystemInstruction.decodeTransfer(ix);
    expect(decoded.lamports).toBe(1234n);
  });
});

describe("simulateTransaction", () => {
  it("delegates to the connection", async () => {
    const conn = fakeConnection();
    const client = createSvmClient({ connection: conn as never });
    const tx = new Transaction();
    tx.add(
      SystemProgram.transfer({
        fromPubkey: new PublicKey(SYSTEM_PROGRAM_ID),
        toPubkey: new PublicKey(SYSTEM_PROGRAM_ID),
        lamports: 1,
      }),
    );
    const res = await client.simulateTransaction(tx);
    expect(res.value.err).toBeNull();
    expect(conn.simulateTransaction).toHaveBeenCalled();
  });
});
