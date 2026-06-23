/**
 * Well-known native program ids for QoreChain's Solana-compatible runtime, plus
 * thin instruction builders for the Memo and SPL-Token programs and the
 * Associated Token Account program.
 *
 * The program ids are the exact canonical ones used by Solana-compatible
 * runtimes, so standard wallets, explorers, and tooling interoperate directly.
 * The SPL-Token / ATA / Memo instructions are built minimally here (by hand)
 * to keep the dependency surface to a single peer — `@solana/web3.js` — with no
 * `@solana/spl-token` requirement.
 */

import { PublicKey, TransactionInstruction, type AccountMeta } from "@solana/web3.js";

/** System program (account creation, SOL transfers). */
export const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");

/** SPL-Token program. */
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/** Associated Token Account program. */
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

/** SPL Memo program. */
export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

/** Convenience grouping of the well-known program ids. */
export const PROGRAM_IDS = {
  system: SYSTEM_PROGRAM_ID,
  token: TOKEN_PROGRAM_ID,
  associatedToken: ASSOCIATED_TOKEN_PROGRAM_ID,
  memo: MEMO_PROGRAM_ID,
} as const;

/**
 * Build a Memo program instruction carrying `text` (encoded UTF-8).
 *
 * @param text    Memo contents.
 * @param signers Optional accounts that must sign the memo; each is included as
 *                a read-only signer (the Memo program's convention).
 */
export function createMemoInstruction(
  text: string,
  signers: PublicKey[] = [],
): TransactionInstruction {
  return new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: signers.map((pubkey) => ({ pubkey, isSigner: true, isWritable: false })),
    data: Buffer.from(text, "utf8"),
  });
}

/** Arguments for {@link createTransferTokenInstruction}. */
export interface TransferTokenInstructionArgs {
  /** Source SPL-Token account. */
  source: PublicKey;
  /** Destination SPL-Token account. */
  destination: PublicKey;
  /** Owner/authority of the source account (signer). */
  owner: PublicKey;
  /** Amount in the token's base units. */
  amount: bigint;
  /** Additional multisig signers, if `owner` is a multisig. */
  multiSigners?: PublicKey[];
}

/**
 * Build an SPL-Token `Transfer` instruction.
 *
 * Layout: 1 byte instruction discriminator (`3` = Transfer) followed by a
 * little-endian u64 amount.
 */
export function createTransferTokenInstruction(
  args: TransferTokenInstructionArgs,
): TransactionInstruction {
  const { source, destination, owner, amount, multiSigners = [] } = args;

  const data = Buffer.alloc(9);
  data.writeUInt8(3, 0);
  data.writeBigUInt64LE(amount, 1);

  const keys: AccountMeta[] = [
    { pubkey: source, isSigner: false, isWritable: true },
    { pubkey: destination, isSigner: false, isWritable: true },
    {
      pubkey: owner,
      isSigner: multiSigners.length === 0,
      isWritable: false,
    },
    ...multiSigners.map((pubkey) => ({ pubkey, isSigner: true, isWritable: false })),
  ];

  return new TransactionInstruction({ programId: TOKEN_PROGRAM_ID, keys, data });
}

/**
 * Derive the deterministic Associated Token Account (ATA) address for an owner
 * and mint under the SPL-Token program.
 */
export function getAssociatedTokenAddress(
  mint: PublicKey,
  owner: PublicKey,
  tokenProgramId: PublicKey = TOKEN_PROGRAM_ID,
): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgramId.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return address;
}

/** Arguments for {@link createAssociatedTokenAccountInstruction}. */
export interface CreateAssociatedTokenAccountInstructionArgs {
  /** Account funding the rent for the new ATA (signer, writable). */
  payer: PublicKey;
  /** Wallet that will own the new ATA. */
  owner: PublicKey;
  /** Token mint. */
  mint: PublicKey;
  /** SPL-Token program id (defaults to the canonical SPL-Token program). */
  tokenProgramId?: PublicKey;
}

/**
 * Build an instruction that creates the Associated Token Account for
 * `(owner, mint)`. The ATA address is derived deterministically.
 */
export function createAssociatedTokenAccountInstruction(
  args: CreateAssociatedTokenAccountInstructionArgs,
): TransactionInstruction {
  const { payer, owner, mint, tokenProgramId = TOKEN_PROGRAM_ID } = args;
  const ata = getAssociatedTokenAddress(mint, owner, tokenProgramId);

  const keys: AccountMeta[] = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: ata, isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: false, isWritable: false },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: tokenProgramId, isSigner: false, isWritable: false },
  ];

  // The ATA "Create" instruction takes empty data (the idempotent variant uses
  // a single 0x01 byte; this is the plain create).
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys,
    data: Buffer.alloc(0),
  });
}

/**
 * Generic instruction builder for invoking an arbitrary on-chain program.
 *
 * Use this with {@link createSvmClient}'s `sendTransaction` to call a deployed
 * BPF program. Deploy programs with standard Solana tooling (e.g.
 * `solana program deploy`); this package intentionally does not wrap the loader.
 */
export function createInvokeInstruction(
  programId: PublicKey,
  keys: AccountMeta[],
  data: Uint8Array,
): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys,
    data: Buffer.from(data),
  });
}
