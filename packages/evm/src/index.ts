/**
 * `@qorechain/evm` — a thin, type-safe adapter over [viem](https://viem.sh) for
 * the QoreChain EVM Engine.
 *
 * It does not reimplement an EVM client; viem is a peer dependency. This package
 * adds QoreChain-specific conveniences: a chain-aware client factory with EVM
 * chain-id auto-detection, ERC-20 helpers, contract deploy/call wrappers, and
 * typed bindings for QoreChain's EVM precompiles.
 */

/** Package version. */
export const VERSION = "0.1.0";

export {
  createEvmClient,
  type CreateEvmClientOptions,
  type EvmClient,
  type EvmEndpoints,
} from "./client";

export { evmAccountFromPrivateKey } from "./accounts";

export {
  erc20,
  balanceOf,
  allowance,
  metadata,
  transfer,
  approve,
  type Erc20Metadata,
} from "./erc20";

export {
  deployContract,
  readContract,
  writeContract,
  type DeployContractArgs,
} from "./contracts";

export {
  precompiles,
  pqcVerify,
  pqcKeyStatus,
  aiRiskScore,
  aiAnomalyCheck,
  rlConsensusParams,
  PRECOMPILE_ADDRESSES,
  type PqcVerifyArgs,
  type PqcKeyStatus,
  type AiRiskScore,
  type AiAnomalyCheckArgs,
  type AiAnomalyCheck,
  type ConsensusParams,
} from "./precompiles";

export {
  ERC20_ABI,
  IQORE_PQC_ABI,
  IQORE_AI_ABI,
  IQORE_CONSENSUS_ABI,
} from "./abi";

export {
  getEvmWalletClient,
  requestAccounts,
  addQoreChainNetwork,
  switchChain,
  discoverEvmProviders,
  toHexChainId,
  type Eip1193Provider,
  type EvmNetworkInfo,
  type GetEvmWalletClientOptions,
  type EvmWalletConnection,
  type Eip6963ProviderDetail,
} from "./wallet";

export { decodeEvmError, type DecodedEvmError } from "./errors";

export {
  createEvmSubscriptionClient,
  watchBlocks,
  watchEvent,
  watchContractEvent,
  watchPendingTransactions,
  type CreateEvmSubscriptionClientOptions,
  type EvmWsEndpoints,
  type Unwatch,
} from "./subscribe";
