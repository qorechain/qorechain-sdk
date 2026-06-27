/**
 * AI pre-flight risk scoring — a QoreChain-unique capability.
 *
 * QoreChain ships an on-chain inference engine (QCAI) exposed to the EVM through
 * two read-only precompiles. Any dApp can score a transaction *before* it is
 * broadcast, using nothing but `eth_call`s, and combine that with a gas estimate
 * to make an informed, policy-driven decision off-chain.
 *
 *  - {@link aiRiskScore} — a model-derived risk score + bucketed level for raw
 *    transaction calldata (precompile `0x..0B01`).
 *  - {@link aiAnomalyCheck} — an anomaly score + boolean flag for a
 *    `(sender, amount)` pair (precompile `0x..0B02`).
 *  - {@link simulateWithRiskScore} — one call that bundles a gas estimate, a risk
 *    score, and an anomaly check into a single advisory verdict.
 *
 * These bindings re-use the precompile address constants and ABIs in
 * `./precompiles` / `./abi`. They expose the *high-level, positional-argument*
 * surface the SDK documents; the namespaced `precompiles.*` bindings remain the
 * low-level form.
 *
 * Availability note: on a default or community node these precompiles may return
 * a "not available" error; they are available on QoreChain network nodes. Treat a
 * thrown error from any of these helpers as "feature not present on this node".
 */

import {
  encodeFunctionData,
  decodeFunctionResult,
  toHex,
  getAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { IQORE_AI_ABI } from "./abi";
import {
  AI_RISK_SCORE_ADDRESS,
  AI_ANOMALY_CHECK_ADDRESS,
  type AiRiskScore,
  type AiAnomalyCheck,
} from "./precompiles";

export {
  AI_RISK_SCORE_ADDRESS,
  AI_ANOMALY_CHECK_ADDRESS,
  type AiRiskScore,
  type AiAnomalyCheck,
};

/**
 * Risk level at which {@link simulateWithRiskScore} stops reporting a transaction
 * as `safe`. The chain's example policy uses `require(level < 3)`, so a level of
 * `3` or above is treated as unsafe here.
 *
 * This threshold is **advisory**. The precompiles do not block anything on their
 * own — an off-chain dApp should pick and enforce its own policy (and a contract
 * can enforce its own on-chain `require`). It is exported so callers can reference
 * the same default the SDK documents.
 */
export const RISK_LEVEL_UNSAFE_THRESHOLD = 3;

/** Coerce raw bytes input to a `0x`-prefixed hex string for the `bytes` ABI type. */
function toHexData(data: Hex | Uint8Array): Hex {
  return typeof data === "string" ? data : toHex(data);
}

/**
 * Compute an on-chain risk score for raw transaction calldata.
 *
 * Issues an `eth_call` against the AI risk-score precompile, encoding
 * `aiRiskScore(bytes)` and decoding the `(uint256 score, uint8 level)` tuple.
 * Higher `level` means riskier (the chain's example policy uses `level < 3`).
 *
 * @param client - A viem public client bound to a QoreChain EVM endpoint.
 * @param txData - The transaction calldata, as hex or raw bytes.
 */
export async function aiRiskScore(
  client: PublicClient,
  txData: Hex | Uint8Array,
): Promise<AiRiskScore> {
  const data = encodeFunctionData({
    abi: IQORE_AI_ABI,
    functionName: "aiRiskScore",
    args: [toHexData(txData)],
  });
  const result = await client.call({
    to: getAddress(AI_RISK_SCORE_ADDRESS),
    data,
  });
  const [score, level] = decodeFunctionResult({
    abi: IQORE_AI_ABI,
    functionName: "aiRiskScore",
    data: result.data ?? "0x",
  });
  return { score, level };
}

/**
 * Check whether a `(sender, amount)` pair is anomalous.
 *
 * Issues an `eth_call` against the AI anomaly-check precompile, encoding
 * `aiAnomalyCheck(address,uint256)` and decoding the
 * `(uint256 anomalyScore, bool flagged)` tuple.
 *
 * @param client - A viem public client bound to a QoreChain EVM endpoint.
 * @param sender - The transaction sender to evaluate.
 * @param amount - The transferred value (in wei) to evaluate.
 */
export async function aiAnomalyCheck(
  client: PublicClient,
  sender: Address,
  amount: bigint,
): Promise<AiAnomalyCheck> {
  const data = encodeFunctionData({
    abi: IQORE_AI_ABI,
    functionName: "aiAnomalyCheck",
    args: [sender, amount],
  });
  const result = await client.call({
    to: getAddress(AI_ANOMALY_CHECK_ADDRESS),
    data,
  });
  const [anomalyScore, flagged] = decodeFunctionResult({
    abi: IQORE_AI_ABI,
    functionName: "aiAnomalyCheck",
    data: result.data ?? "0x",
  });
  return { anomalyScore, flagged };
}

/** A transaction shape for {@link simulateWithRiskScore}. */
export interface PreflightTx {
  /** The sender address (used for the anomaly check and gas estimate). */
  from: Address;
  /** The destination address (optional for contract-creation txs). */
  to?: Address;
  /** The transaction calldata, if any. */
  data?: Hex;
  /** The value to transfer, in wei. Defaults to `0`. */
  value?: bigint;
}

/** The combined result of {@link simulateWithRiskScore}. */
export interface PreflightResult {
  /** Estimated gas for the transaction (`eth_estimateGas`). */
  gas: bigint;
  /** On-chain risk score for the transaction calldata. */
  risk: AiRiskScore;
  /** On-chain anomaly check for `(from, value)`. */
  anomaly: AiAnomalyCheck;
  /**
   * Advisory verdict: `risk.level < RISK_LEVEL_UNSAFE_THRESHOLD && !anomaly.flagged`.
   *
   * This is a convenience signal only; enforce your own policy (see
   * {@link RISK_LEVEL_UNSAFE_THRESHOLD}).
   */
  safe: boolean;
}

/**
 * Run an AI pre-flight on a transaction: estimate gas, score its risk, and check
 * for anomalies — all read-only, before anything is signed or broadcast.
 *
 * This is a first-in-industry capability: the risk model runs *on-chain* and is
 * reachable from any dApp via plain `eth_call`/`eth_estimateGas`. The returned
 * `safe` flag is **advisory** — off-chain dApps should set and enforce their own
 * policy (and contracts can `require` on the level on-chain).
 *
 *  - `gas` — `eth_estimateGas` for the transaction.
 *  - `risk` — {@link aiRiskScore} over `tx.data` (or, when absent, the deployed
 *    bytecode at `tx.to`, so a plain transfer to a contract is still scored).
 *  - `anomaly` — {@link aiAnomalyCheck} over `(tx.from, tx.value ?? 0)`.
 *  - `safe` — `risk.level < {@link RISK_LEVEL_UNSAFE_THRESHOLD} && !anomaly.flagged`.
 *
 * @param client - A viem public client bound to a QoreChain EVM endpoint.
 * @param tx - The transaction to evaluate.
 */
export async function simulateWithRiskScore(
  client: PublicClient,
  tx: PreflightTx,
): Promise<PreflightResult> {
  const value = tx.value ?? 0n;

  // Score over the calldata, or fall back to the deployed code at `to` so a bare
  // value transfer to a contract is still given a meaningful risk signal.
  let riskData: Hex = tx.data ?? "0x";
  if ((riskData === "0x" || riskData.length <= 2) && tx.to) {
    riskData = await client.getCode({ address: tx.to }).then((c) => c ?? "0x");
  }

  const [gas, risk, anomaly] = await Promise.all([
    client.estimateGas({
      account: tx.from,
      to: tx.to,
      data: tx.data,
      value,
    }),
    aiRiskScore(client, riskData),
    aiAnomalyCheck(client, tx.from, value),
  ]);

  const safe = risk.level < RISK_LEVEL_UNSAFE_THRESHOLD && !anomaly.flagged;
  return { gas, risk, anomaly, safe };
}

/** Namespaced AI pre-flight helpers. */
export const ai = {
  aiRiskScore,
  aiAnomalyCheck,
  simulateWithRiskScore,
  RISK_LEVEL_UNSAFE_THRESHOLD,
} as const;
