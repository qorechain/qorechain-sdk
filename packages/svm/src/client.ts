/**
 * Client factory for QoreChain's Solana-compatible JSON-RPC.
 *
 * This is a thin convenience layer over `@solana/web3.js`: it builds (or accepts)
 * a `Connection` bound to the network's SVM RPC endpoint and exposes typed
 * wrappers over the documented Solana-compatible JSON-RPC method set plus
 * transaction build/sign/send helpers.
 *
 * `@solana/web3.js` is a peer dependency; nothing here reimplements it.
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  type AccountInfo,
  type Commitment,
  type ConfirmOptions,
  type GetLatestBlockhashConfig,
  type Keypair,
  type RpcResponseAndContext,
  type SignatureResult,
  type SimulatedTransactionResponse,
  type TokenAccountsFilter,
} from "@solana/web3.js";

/** Subset of a qorechain-sdk network's endpoints relevant to the SVM runtime. */
export interface SvmEndpoints {
  /** Solana-compatible JSON-RPC HTTP endpoint. */
  svmRpc: string;
}

/** Default testnet SVM RPC endpoint (Solana-compatible JSON-RPC, port 8899). */
export const DEFAULT_SVM_RPC_URL = "http://localhost:8899";

/** Options for {@link createSvmClient}. */
export interface CreateSvmClientOptions {
  /** Solana-compatible JSON-RPC HTTP URL. Mutually exclusive with `endpoints`. */
  rpcUrl?: string;
  /** A qorechain-sdk network endpoints object (uses `svmRpc`). */
  endpoints?: SvmEndpoints;
  /** Default commitment level for the connection. */
  commitment?: Commitment;
  /**
   * A preconstructed `Connection`. When provided it is used as-is and `rpcUrl`/
   * `endpoints`/`commitment` are ignored — primarily for testing.
   */
  connection?: Connection;
}

/** Arguments for building/sending a SOL transfer. */
export interface TransferSolArgs {
  /** Funding/source keypair (signer). */
  from: Keypair;
  /** Destination address. */
  to: PublicKey;
  /** Amount in lamports. */
  lamports: number | bigint;
}

/** A configured QoreChain SVM client bundle. */
export interface SvmClient {
  /** The underlying `@solana/web3.js` `Connection`. */
  connection: Connection;

  // --- Reads (thin wrappers over the JSON-RPC method set) ---
  /** Lamport balance for an account. */
  getBalance(pubkey: PublicKey, commitment?: Commitment): Promise<number>;
  /** Raw account info, or `null` if the account does not exist. */
  getAccountInfo(
    pubkey: PublicKey,
    commitment?: Commitment,
  ): Promise<AccountInfo<Buffer> | null>;
  /** Latest blockhash and last valid block height. */
  getLatestBlockhash(
    commitmentOrConfig?: Commitment | GetLatestBlockhashConfig,
  ): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  /** Token accounts owned by `owner`, filtered by mint or program id. */
  getTokenAccountsByOwner(
    owner: PublicKey,
    filter: TokenAccountsFilter,
    commitment?: Commitment,
  ): ReturnType<Connection["getTokenAccountsByOwner"]>;
  /** Confirmed signatures for transactions involving `address`. */
  getSignaturesForAddress(
    address: PublicKey,
    options?: Parameters<Connection["getSignaturesForAddress"]>[1],
  ): ReturnType<Connection["getSignaturesForAddress"]>;
  /** Request an airdrop of `lamports` to `pubkey` (testnet/devnet only). */
  requestAirdrop(pubkey: PublicKey, lamports: number): Promise<string>;

  // --- Transactions ---
  /** Build (unsigned, no blockhash) a SOL transfer transaction. */
  buildTransferSol(args: TransferSolArgs): Transaction;
  /** Build, sign, send, and confirm a SOL transfer. */
  transferSol(args: TransferSolArgs, options?: ConfirmOptions): Promise<string>;
  /** Sign, send, and confirm an arbitrary transaction. */
  sendTransaction(
    tx: Transaction,
    signers: Keypair[],
    options?: ConfirmOptions,
  ): Promise<string>;
  /** Simulate a transaction without submitting it. */
  simulateTransaction(
    tx: Transaction,
  ): Promise<RpcResponseAndContext<SimulatedTransactionResponse>>;
}

function resolveConnection(opts: CreateSvmClientOptions): Connection {
  if (opts.connection) return opts.connection;
  const url = opts.rpcUrl ?? opts.endpoints?.svmRpc ?? DEFAULT_SVM_RPC_URL;
  return new Connection(url, opts.commitment ?? "confirmed");
}

/**
 * Create a QoreChain SVM client bundle.
 *
 * With no options it targets the testnet localhost endpoint
 * (`http://localhost:8899`) at `confirmed` commitment.
 */
export function createSvmClient(opts: CreateSvmClientOptions = {}): SvmClient {
  const connection = resolveConnection(opts);

  const buildTransferSol = (args: TransferSolArgs): Transaction => {
    const tx = new Transaction();
    tx.add(
      SystemProgram.transfer({
        fromPubkey: args.from.publicKey,
        toPubkey: args.to,
        lamports: args.lamports,
      }),
    );
    return tx;
  };

  const sendTransaction = (
    tx: Transaction,
    signers: Keypair[],
    options?: ConfirmOptions,
  ): Promise<string> => sendAndConfirmTransaction(connection, tx, signers, options);

  return {
    connection,

    getBalance: (pubkey, commitment) => connection.getBalance(pubkey, commitment),
    getAccountInfo: (pubkey, commitment) =>
      connection.getAccountInfo(pubkey, commitment) as Promise<AccountInfo<Buffer> | null>,
    getLatestBlockhash: (commitmentOrConfig) =>
      connection.getLatestBlockhash(commitmentOrConfig),
    getTokenAccountsByOwner: (owner, filter, commitment) =>
      connection.getTokenAccountsByOwner(owner, filter, commitment),
    getSignaturesForAddress: (address, options) =>
      connection.getSignaturesForAddress(address, options),
    requestAirdrop: (pubkey, lamports) => connection.requestAirdrop(pubkey, lamports),

    buildTransferSol,
    transferSol: (args, options) =>
      sendTransaction(buildTransferSol(args), [args.from], options),
    sendTransaction,
    simulateTransaction: (tx): Promise<
      RpcResponseAndContext<SimulatedTransactionResponse>
    > =>
      // The single-arg overload signs/derives blockhash as needed for v1
      // legacy transactions.
      (connection.simulateTransaction as (
        t: Transaction,
      ) => Promise<RpcResponseAndContext<SimulatedTransactionResponse>>)(tx),
  };
}

// Re-export so callers can type their results without a direct dependency on the
// peer's internal `SignatureResult` import path.
export type { SignatureResult };
