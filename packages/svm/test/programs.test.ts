import { describe, it, expect } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  PROGRAM_IDS,
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MEMO_PROGRAM_ID,
  createMemoInstruction,
  createTransferTokenInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  createInvokeInstruction,
} from "../src/index";

describe("program id constants", () => {
  it("exposes the exact canonical Solana program ids", () => {
    expect(SYSTEM_PROGRAM_ID.toBase58()).toBe("11111111111111111111111111111111");
    expect(TOKEN_PROGRAM_ID.toBase58()).toBe("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    expect(ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()).toBe(
      "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
    );
    expect(MEMO_PROGRAM_ID.toBase58()).toBe("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
    expect(PROGRAM_IDS.token.toBase58()).toBe(TOKEN_PROGRAM_ID.toBase58());
  });
});

describe("createMemoInstruction", () => {
  it("targets the Memo program id with UTF-8 data", () => {
    const ix = createMemoInstruction("hello qore");
    expect(ix.programId.toBase58()).toBe(MEMO_PROGRAM_ID.toBase58());
    expect(Buffer.from(ix.data).toString("utf8")).toBe("hello qore");
  });

  it("includes signer accounts when provided", () => {
    const signer = Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey;
    const ix = createMemoInstruction("hi", [signer]);
    expect(ix.keys).toHaveLength(1);
    expect(ix.keys[0].pubkey.toBase58()).toBe(signer.toBase58());
    expect(ix.keys[0].isSigner).toBe(true);
  });
});

describe("createTransferTokenInstruction", () => {
  it("targets the SPL-Token program id", () => {
    const source = Keypair.fromSeed(new Uint8Array(32).fill(4)).publicKey;
    const dest = Keypair.fromSeed(new Uint8Array(32).fill(5)).publicKey;
    const owner = Keypair.fromSeed(new Uint8Array(32).fill(6)).publicKey;
    const ix = createTransferTokenInstruction({ source, destination: dest, owner, amount: 100n });
    expect(ix.programId.toBase58()).toBe(TOKEN_PROGRAM_ID.toBase58());
    const keyStrings = ix.keys.map((k) => k.pubkey.toBase58());
    expect(keyStrings).toEqual([source.toBase58(), dest.toBase58(), owner.toBase58()]);
    // SPL-Token `Transfer` instruction discriminator is 3.
    expect(ix.data[0]).toBe(3);
  });
});

describe("associated token account", () => {
  it("derives the ATA from the ATA program and targets it in the create instruction", () => {
    const payer = Keypair.fromSeed(new Uint8Array(32).fill(7)).publicKey;
    const owner = Keypair.fromSeed(new Uint8Array(32).fill(8)).publicKey;
    const mint = Keypair.fromSeed(new Uint8Array(32).fill(9)).publicKey;

    const ata = getAssociatedTokenAddress(mint, owner);
    expect(ata).toBeInstanceOf(PublicKey);

    const ix = createAssociatedTokenAccountInstruction({ payer, owner, mint });
    expect(ix.programId.toBase58()).toBe(ASSOCIATED_TOKEN_PROGRAM_ID.toBase58());
    const keyStrings = ix.keys.map((k) => k.pubkey.toBase58());
    expect(keyStrings).toContain(ata.toBase58());
    expect(keyStrings).toContain(mint.toBase58());
    expect(keyStrings).toContain(TOKEN_PROGRAM_ID.toBase58());
  });
});

describe("createInvokeInstruction", () => {
  it("builds a raw instruction for an arbitrary program id", () => {
    const programId = Keypair.fromSeed(new Uint8Array(32).fill(10)).publicKey;
    const acct = Keypair.fromSeed(new Uint8Array(32).fill(11)).publicKey;
    const data = new Uint8Array([1, 2, 3]);
    const ix = createInvokeInstruction(programId, [{ pubkey: acct, isSigner: false, isWritable: true }], data);
    expect(ix.programId.toBase58()).toBe(programId.toBase58());
    expect(ix.keys[0].pubkey.toBase58()).toBe(acct.toBase58());
    expect(Array.from(ix.data)).toEqual([1, 2, 3]);
  });
});
