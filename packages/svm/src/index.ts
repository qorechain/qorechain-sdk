/**
 * `@qorechain/svm` — a thin, type-safe adapter over
 * [`@solana/web3.js`](https://solana-labs.github.io/solana-web3.js/) for
 * QoreChain's Solana-compatible JSON-RPC.
 *
 * It does not reimplement an SVM client; `@solana/web3.js` is a peer dependency.
 * This package adds QoreChain-specific conveniences: a client factory targeting
 * the SVM RPC endpoint, key helpers, typed read wrappers, SOL transfer
 * build/sign/send, and minimal native-program instruction builders (Memo,
 * SPL-Token, Associated Token Account) plus a generic program-invoke builder.
 */

/** Package version. */
export const VERSION = "0.1.0";

export {
  createSvmClient,
  DEFAULT_SVM_RPC_URL,
  type CreateSvmClientOptions,
  type SvmClient,
  type SvmEndpoints,
  type TransferSolArgs,
  type SignatureResult,
} from "./client";

export { svmKeypairFromSecretKey, svmAddress } from "./keys";

export {
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
  type TransferTokenInstructionArgs,
  type CreateAssociatedTokenAccountInstructionArgs,
} from "./programs";

export {
  getSvmWallet,
  detectSvmProvider,
  type InjectedSvmWallet,
  type GetSvmWalletOptions,
  type SvmWalletConnection,
  type SvmSignableTransaction,
} from "./wallet";

export { decodeSvmError, type DecodedSvmError } from "./errors";

export {
  onLogs,
  onAccountChange,
  onSlotChange,
  type SvmSubscription,
} from "./subscribe";
