/**
 * `@qorechain/sdk` public API.
 *
 * The exports below are the deliberate, supported surface of the SDK. Start with
 * {@link createClient} for the high-level composed client; the individual
 * networks, accounts, query clients, and tx primitives are also exported for
 * callers who want to compose them directly. Internal helpers are not exported.
 */

/** SDK version. */
export const VERSION = "0.1.0";

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

// Utilities: denom conversion and address encoding/validation.
export * from "./utils/denom";
export * from "./utils/address";

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
export { TxClient, MSG_SEND_TYPE_URL } from "./tx/builder";
export type {
  SigningClientLike,
  TxClientOptions,
  TxConnectOptions,
  SignAndBroadcastOptions,
  SimulateOptions,
  BankSendOptions,
} from "./tx/builder";
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

// Typed gRPC query clients for the modules with a query service (crossvm,
// lightnode, pqc, qca, reputation, rlconsensus, svm) over a cosmjs QueryClient.
export { createQueryClients, connectQueryClients } from "./query/grpc";
export type {
  QoreChainQueryClients,
  CrossVmQueryClient,
  LightNodeQueryClient,
  PqcQueryClient,
  QcaQueryClient,
  ReputationQueryClient,
  RlConsensusQueryClient,
  SvmQueryClient,
} from "./query/grpc";
