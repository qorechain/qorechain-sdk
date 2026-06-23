/**
 * Typed bindings for QoreChain's EVM precompiles — the headline capability of
 * the QoreChain EVM Engine. Each helper issues an `eth_call` against the fixed
 * precompile address using the corresponding bundled interface ABI.
 *
 * Availability note: on a default or community node these precompiles may return
 * a "not available" error; they are available on QoreChain network nodes. Handle
 * a thrown error from any of these helpers as "feature not present on this node".
 */

import { getAddress, type Address, type Hex, type PublicClient } from "viem";
import { IQORE_PQC_ABI, IQORE_AI_ABI, IQORE_CONSENSUS_ABI } from "./abi";

/**
 * Fixed 20-byte precompile addresses (zero-padded), matching the chain's
 * published interface registrations.
 */
export const PRECOMPILE_ADDRESSES = {
  /** CrossVM Bridge precompile. */
  crossVmBridge: "0x0000000000000000000000000000000000000901",
  /** PQC signature verification (`IQorePQC.pqcVerify`). */
  pqcVerify: "0x0000000000000000000000000000000000000A01",
  /** PQC key registration status (`IQorePQC.pqcKeyStatus`). */
  pqcKeyStatus: "0x0000000000000000000000000000000000000A02",
  /** AI transaction risk score (`IQoreAI.aiRiskScore`). */
  aiRiskScore: "0x0000000000000000000000000000000000000B01",
  /** AI anomaly check (`IQoreAI.aiAnomalyCheck`). */
  aiAnomalyCheck: "0x0000000000000000000000000000000000000B02",
  /** Consensus parameters (`IQoreConsensus.rlConsensusParams`). */
  rlConsensusParams: "0x0000000000000000000000000000000000000C01",
} as const satisfies Record<string, Address>;

/**
 * Normalize a precompile address to its EIP-55 checksummed form.
 *
 * The exported {@link PRECOMPILE_ADDRESSES} preserve the chain's published
 * casing, which is not necessarily valid EIP-55; viem requires checksummed (or
 * all-lowercase) input, so calls route through this.
 */
const addr = (a: Address): Address => getAddress(a);

/** Arguments for {@link pqcVerify}. */
export interface PqcVerifyArgs {
  pubkey: Hex;
  signature: Hex;
  message: Hex;
}

/** Verify a post-quantum signature on-chain. Returns `true` when valid. */
export function pqcVerify(
  client: PublicClient,
  { pubkey, signature, message }: PqcVerifyArgs,
): Promise<boolean> {
  return client.readContract({
    address: addr(PRECOMPILE_ADDRESSES.pqcVerify),
    abi: IQORE_PQC_ABI,
    functionName: "pqcVerify",
    args: [pubkey, signature, message],
  });
}

/** Result of {@link pqcKeyStatus}. */
export interface PqcKeyStatus {
  registered: boolean;
  algorithmId: number;
  pubkey: Hex;
}

/** Query the on-chain post-quantum key registration status for an account. */
export async function pqcKeyStatus(
  client: PublicClient,
  account: Address,
): Promise<PqcKeyStatus> {
  const [registered, algorithmId, pubkey] = await client.readContract({
    address: addr(PRECOMPILE_ADDRESSES.pqcKeyStatus),
    abi: IQORE_PQC_ABI,
    functionName: "pqcKeyStatus",
    args: [account],
  });
  return { registered, algorithmId, pubkey };
}

/** Result of {@link aiRiskScore}. */
export interface AiRiskScore {
  score: bigint;
  level: number;
}

/** Compute an on-chain risk score for raw transaction data. */
export async function aiRiskScore(
  client: PublicClient,
  txData: Hex,
): Promise<AiRiskScore> {
  const [score, level] = await client.readContract({
    address: addr(PRECOMPILE_ADDRESSES.aiRiskScore),
    abi: IQORE_AI_ABI,
    functionName: "aiRiskScore",
    args: [txData],
  });
  return { score, level };
}

/** Arguments for {@link aiAnomalyCheck}. */
export interface AiAnomalyCheckArgs {
  sender: Address;
  amount: bigint;
}

/** Result of {@link aiAnomalyCheck}. */
export interface AiAnomalyCheck {
  anomalyScore: bigint;
  flagged: boolean;
}

/** Check whether a (sender, amount) pair is anomalous. */
export async function aiAnomalyCheck(
  client: PublicClient,
  { sender, amount }: AiAnomalyCheckArgs,
): Promise<AiAnomalyCheck> {
  const [anomalyScore, flagged] = await client.readContract({
    address: addr(PRECOMPILE_ADDRESSES.aiAnomalyCheck),
    abi: IQORE_AI_ABI,
    functionName: "aiAnomalyCheck",
    args: [sender, amount],
  });
  return { anomalyScore, flagged };
}

/** Result of {@link rlConsensusParams}. */
export interface ConsensusParams {
  blockTime: bigint;
  baseGasPrice: bigint;
  validatorSetSize: bigint;
  epoch: bigint;
}

/** Read the live, adaptively-tuned consensus parameters. */
export async function rlConsensusParams(
  client: PublicClient,
): Promise<ConsensusParams> {
  const [blockTime, baseGasPrice, validatorSetSize, epoch] =
    await client.readContract({
      address: addr(PRECOMPILE_ADDRESSES.rlConsensusParams),
      abi: IQORE_CONSENSUS_ABI,
      functionName: "rlConsensusParams",
    });
  return { blockTime, baseGasPrice, validatorSetSize, epoch };
}

/** Namespaced precompile helpers. */
export const precompiles = {
  pqcVerify,
  pqcKeyStatus,
  aiRiskScore,
  aiAnomalyCheck,
  rlConsensusParams,
} as const;
