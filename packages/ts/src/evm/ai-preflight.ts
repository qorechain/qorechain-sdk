/**
 * AI pre-flight risk scoring — re-exported from `@qorechain/evm` for discovery.
 *
 * The implementation lives in the EVM adapter (`@qorechain/evm`), which owns the
 * viem/JSON-RPC surface. It is re-exported here so it is discoverable from the
 * umbrella `@qorechain/sdk` package — `import { simulateWithRiskScore } from
 * "@qorechain/sdk"` works out of the box (`@qorechain/evm` is a regular
 * dependency; it imports cleanly without viem).
 *
 * `viem` remains an **optional peer**: it is only needed for the viem-typed
 * helpers in `@qorechain/evm`. The core cosmos-side SDK does not depend on it.
 *
 * QoreChain is the first network to expose an on-chain AI risk/anomaly model to
 * any dApp through plain `eth_call`s. Use {@link simulateWithRiskScore} to bundle
 * a gas estimate, a risk score, and an anomaly check into one advisory verdict
 * before a transaction is signed or broadcast.
 */

export {
  ai,
  aiRiskScore,
  aiAnomalyCheck,
  simulateWithRiskScore,
  RISK_LEVEL_UNSAFE_THRESHOLD,
  AI_RISK_SCORE_ADDRESS,
  AI_ANOMALY_CHECK_ADDRESS,
  type AiRiskScore,
  type AiAnomalyCheck,
  type PreflightTx,
  type PreflightResult,
} from "@qorechain/evm";
