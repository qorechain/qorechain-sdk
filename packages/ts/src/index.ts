/**
 * `@qorechain/sdk` public API.
 *
 * The exports below are the deliberate, supported surface of the SDK. Start with
 * {@link createClient} for the high-level composed client; the individual
 * networks, accounts, query clients, and tx primitives are also exported for
 * callers who want to compose them directly. Internal helpers are not exported.
 */

/** SDK version. */
export const VERSION = "0.3.0";

// Top-level factory: the recommended entrypoint that resolves a network and
// composes the read clients, fee helper, and a lazy signing entrypoint.
export { createClient } from "./client";
export type {
  QoreChainClient,
  CreateClientOptions,
  ConnectTxOptions,
  ClientFees,
} from "./client";

// Networks: presets, lookup/list helpers, and config types.
export * from "./config/networks";

// Explorer + faucet helpers (config-driven; no hostnames baked in). The
// explorer URL builders and faucet request require the network's
// `explorerUrl` / `faucetUrl` (both `undefined` by default) and throw a clear
// error otherwise.
export {
  explorerTxUrl,
  explorerAddressUrl,
  explorerBlockUrl,
  type ExplorerConfig,
} from "./explorer";
export {
  requestFaucet,
  type FaucetConfig,
  type RequestFaucetOptions,
} from "./faucet";

// Utilities: denom conversion and address encoding/validation.
export * from "./utils/denom";
export * from "./utils/address";
// Generic integer-exact unit math (EVM 18-decimals etc.), hash helpers, and
// cross-VM address validation + EIP-55 checksum.
export { parseUnits, formatUnits } from "./utils/units";
export {
  sha256,
  sha256Hex,
  keccak256,
  keccak256Hex,
  ripemd160,
  ripemd160Hex,
  toHex,
} from "./utils/hash";
export type { HashInput } from "./utils/hash";
export {
  isValidEvmAddress,
  toChecksumAddress,
  isChecksumAddress,
  isValidSvmAddress,
} from "./utils/validation";

// Accounts & keys. Re-export the documented derivation functions and types only.
// The derive functions return key material deliberately (callers need it for
// signing); nothing here leaks secrets implicitly.
export {
  generateMnemonic,
  validateMnemonic,
  deriveNativeAccount,
  deriveEvmAccount,
  deriveSvmAccount,
} from "./accounts/wallet";
export type {
  KeyType,
  Account,
  DerivationOptions,
  Secp256k1Account,
  Ed25519Account,
} from "./accounts/types";

// Post-quantum (PQC) signing: ML-DSA-87 (Dilithium-5) primitives, the pluggable
// Signer abstraction, and the on-chain hybrid-signature extension builder.
export {
  AlgorithmUnspecified,
  AlgorithmDilithium5,
  AlgorithmMLKEM1024,
  algorithmName,
  isSignatureAlgorithm,
  ML_DSA_87_PUBLIC_KEY_LENGTH,
  ML_DSA_87_SECRET_KEY_LENGTH,
  ML_DSA_87_SIGNATURE_LENGTH,
  ML_DSA_87_SEED_LENGTH,
  HYBRID_SIG_TYPE_URL,
  generatePqcKeypair,
  pqcSign,
  pqcVerify,
  buildHybridSignatureExtension,
  PqcSigner,
  HybridSigner,
} from "./accounts/pqc";
export type {
  AlgorithmID,
  PqcKeypair,
  PQCHybridSignature,
  Signer,
  SignOutput,
  SignatureMode,
  PqcSignaturePart,
} from "./accounts/pqc";

// Read/query clients: shared HTTP transport, Cosmos+custom REST, the generic
// JSON-RPC 2.0 client (with thin EVM helpers), and the typed `qor_` namespace.
export {
  getJson,
  postJsonRpc,
  buildUrl,
  joinUrl,
  QoreHttpError,
} from "./query/http";
export type {
  FetchLike,
  QueryValue,
  HttpOptions,
  GetJsonOptions,
} from "./query/http";
export { JsonRpcClient, JsonRpcError } from "./query/jsonrpc";
export type {
  JsonRpcClientOptions,
  JsonRpcResponse,
  JsonRpcErrorObject,
} from "./query/jsonrpc";
export { RestClient } from "./query/rest";
export type {
  RestClientOptions,
  Coin,
  PageResponse,
  AllBalancesResponse,
  BalanceResponse,
  Pagination,
  PaginatedOptions,
  FeeUrgency,
} from "./query/rest";
export { QorClient } from "./query/qor";

// Cross-VM reads: typed REST wrappers over `x/crossvm`. EVM→native routing
// itself runs on-chain via the cross-VM bridge precompile in `@qorechain/evm`;
// these helpers (and `QorClient.getCrossVmMessage`) track message state.
export {
  getCrossVmMessage,
  getPendingCrossVmMessages,
  getCrossVmParams,
} from "./query/crossvm";
export type {
  CrossVmMessage,
  CrossVmMessageResponse,
  PendingCrossVmMessagesResponse,
  CrossVmParamsResponse,
} from "./query/crossvm";

// CosmWasm: read/signing client constructors plus thin typed wrappers over
// `@cosmjs/cosmwasm-stargate` (query/instantiate/execute/upload).
export {
  createCosmWasmClient,
  connectCosmWasmSigner,
  queryContractSmart,
  getContractInfo,
  instantiate,
  execute,
  uploadCode,
  instantiate2,
  migrate,
  updateAdmin,
  clearAdmin,
  getCodes,
  getContracts,
  getCodeDetails,
} from "./cosmwasm";
export type {
  ContractMsg,
  FeeInput,
  CosmWasmReadClient,
  CosmWasmSigningClient,
  InstantiateOpts,
} from "./cosmwasm";

// Native transactions: fee estimation, the signer adapter, the tx builder /
// broadcaster, the low-level PQC hybrid extension encode/attach helpers, and the
// end-to-end hybrid (classical + PQC) signing/broadcast builder. See each module
// for details.
export { estimateFee, STATIC_FALLBACK } from "./tx/fees";
export type { StdFee, EstimateFeeOptions } from "./tx/fees";
export { directSignerFromPrivateKey } from "./tx/signer-adapter";
export type { BroadcastMode, BroadcastResult } from "./tx/broadcast";
export {
  TxClient,
  MSG_SEND_TYPE_URL,
  buildAminoTypes,
  DEFAULT_GAS_MULTIPLIER,
  DEFAULT_GAS_PRICE,
} from "./tx/builder";
export type {
  SigningClientLike,
  TxClientOptions,
  TxConnectOptions,
  SignAndBroadcastOptions,
  SimulateOptions,
  BankSendOptions,
  AutoFeeOptions,
  FeeInput as TxFeeInput,
} from "./tx/builder";
// Auto-gas fee math: gas-price parsing and ceil(gas * price) fee computation.
export { GasPrice, calculateFee } from "./tx/gas";

// Transaction error decoding: structured, human-readable errors with a typed
// QoreTxError thrown on non-zero ABCI codes.
export {
  decodeTxError,
  isTxFailure,
  QoreTxError,
  txErrorFrom,
} from "./errors";
export type {
  TxErrorInput,
  DecodedTxError,
  TxResultLike,
} from "./errors";

// Event subscriptions over the consensus RPC websocket: new blocks and Tx
// events, each returning an unsubscribe function.
export {
  createSubscriptionClient,
  subscribeNewBlocks,
  subscribeTx,
  buildTxQuery,
} from "./subscribe";
export type {
  Handler,
  Unsubscribe,
  EventStream,
  NewBlockEventLike,
  TxEventLike,
  SubscriptionClient,
  TxQueryFilters,
} from "./subscribe";

// Tx tracking + retry: poll for inclusion, broadcast-and-wait, and a transient
// error retry helper.
export { waitForTx, broadcastAndWait, withRetry } from "./track";
export type {
  GetTxFn,
  WaitForTxOptions,
  IncludedTx,
  SyncBroadcaster,
  RetryOptions,
} from "./track";

// Block/tx lookup + search over REST, with an events query builder.
export {
  getTx,
  getBlock,
  getLatestBlock,
  searchTxs,
  buildEventsQuery,
} from "./search";
export type {
  GetTxResponse,
  GetBlockResponse,
  SearchTxsResponse,
  TxOrderBy,
  SearchTxsOptions,
  EventFilters,
} from "./search";
export { encodeHybridExtension, attachHybridExtension } from "./tx/hybrid";
export type { HybridPlacement, AttachHybridOptions } from "./tx/hybrid";
export { buildHybridTx, signAndBroadcastHybrid } from "./tx/hybrid-tx";
export type {
  BuildHybridTxOptions,
  BuiltHybridTx,
  HybridBroadcaster,
  SignAndBroadcastHybridOptions,
} from "./tx/hybrid-tx";

// Messages: typed composers for every transaction the chain supports, plus the
// message registry that resolves them. `msg.<module>.<message>(value)` returns a
// cosmjs `{ typeUrl, value }` ready for `TxClient.signAndBroadcast` or the hybrid
// tx path; `qorechainRegistry()` seeds a cosmjs Registry with the standard Cosmos
// types and all QoreChain custom-module messages (the default for `TxClient`).
export {
  msg,
  qorechainRegistry,
  qorechainRegistryTypes,
} from "./messages";
// Per-module composer groups, also re-exported for tree-shakeable named imports.
export {
  bank,
  staking,
  distribution,
  gov,
  authz,
  feegrant,
  ibc,
  amm,
  bridge,
  rdk,
  multilayer,
  pqc as pqcMsg,
  svm,
  lightnode,
  license,
  abstractaccount,
  crossvm,
  rlconsensus,
} from "./messages";
// Generated message types, namespaced by module, for callers who want the raw
// encode/decode/interface types (e.g. to decode a message read back from chain).
export * as qorechainTypes from "./codegen";

// Browser wallets: Keplr/Leap connection + chain-suggestion helper. The
// returned signer plugs straight into `TxClient.connect` and can carry standard
// and custom messages via DIRECT signing.
export { getCosmosWallet, suggestChainInfo } from "./wallet/cosmos";
export type {
  CosmosWalletName,
  GetCosmosWalletOptions,
  CosmosWalletConnection,
  InjectedCosmosWallet,
  KeplrChainInfo,
  KeplrCurrency,
  KeplrFeeCurrency,
  Bech32Config,
} from "./wallet/cosmos";

// Typed gRPC query clients for the modules with a query service (bridge,
// crossvm, lightnode, multilayer, pqc, qca, rdk, reputation, rlconsensus, svm)
// over a cosmjs QueryClient.
export { createQueryClients, connectQueryClients } from "./query/grpc";
export type {
  QoreChainQueryClients,
  BridgeQueryClient,
  CrossVmQueryClient,
  LightNodeQueryClient,
  MultilayerQueryClient,
  PqcQueryClient,
  QcaQueryClient,
  RdkQueryClient,
  ReputationQueryClient,
  RlConsensusQueryClient,
  SvmQueryClient,
} from "./query/grpc";

// High-level developer-experience helpers: ergonomic, strongly-typed clients for
// building sidechains/paychains (multilayer) and rollups (rdk) — register →
// anchor → route, and create → batch → withdraw — without hand-building Any
// payloads. See ./helpers for the full option-object docs.
export {
  createMultilayerClient,
  createRollupClient,
} from "./helpers";
export type {
  MultilayerClient,
  CreateMultilayerClientOptions,
  MultilayerWriteOptions,
  RegisterSidechainOptions,
  RegisterPaychainOptions,
  AnchorStateOptions,
  RouteTransactionOptions,
  RollupClient,
  CreateRollupClientOptions,
  RollupWriteOptions,
  CreateRollupOptions,
  SubmitBatchOptions,
  ChallengeBatchOptions,
  ResolveChallengeOptions,
  RollupLifecycleOptions,
  ExecuteWithdrawalOptions,
} from "./helpers";
