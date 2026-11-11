/**
 * Typed message composers for every transaction QoreChain supports.
 *
 * The default export shape is a single grouped object so callers can write
 * `msg.amm.swapExactIn({ ... })`, `msg.staking.delegate({ ... })`,
 * `msg.pqc.registerPqcKey({ ... })`, etc. Standard Native modules
 * (bank/staking/distribution/gov/authz/feegrant/ibc) sit alongside the
 * QoreChain custom modules (amm/bridge/rdk/multilayer/pqc/svm/lightnode/
 * license/abstractaccount/crossvm/rlconsensus/stakingtier).
 *
 * Every composer returns a cosmjs `{ typeUrl, value }` `EncodeObject` that
 * {@link qorechainRegistry} can encode - pass an array of them straight to
 * `TxClient.signAndBroadcast` or the hybrid PQC tx path.
 */

// Standard Native modules.
import {
  bank,
  staking,
  distribution,
  gov,
  authz,
  feegrant,
  ibc,
} from "./cosmos";

// QoreChain custom modules.
import {
  amm,
  bridge,
  rdk,
  multilayer,
  pqc,
  svm,
  lightnode,
  license,
  abstractaccount,
  crossvm,
  rlconsensus,
  stakingtier,
} from "./qorechain";

/**
 * All message composers, grouped by module. Recommended import:
 *
 * ```ts
 * import { msg } from "@qorechain/sdk";
 * const m = msg.amm.swapExactIn({ sender, poolId: "1", tokenIn, denomOut, minOut });
 * ```
 */
export const msg = {
  // standard native
  bank,
  staking,
  distribution,
  gov,
  authz,
  feegrant,
  ibc,
  // qorechain
  amm,
  bridge,
  rdk,
  multilayer,
  pqc,
  svm,
  lightnode,
  license,
  abstractaccount,
  crossvm,
  rlconsensus,
  stakingtier,
} as const;

// Also expose the per-module groups as named exports for tree-shakeable imports.
export {
  bank,
  staking,
  distribution,
  gov,
  authz,
  feegrant,
  ibc,
  ibcTimeoutTimestamp,
} from "./cosmos";
export {
  amm,
  bridge,
  rdk,
  multilayer,
  pqc,
  svm,
  lightnode,
  license,
  abstractaccount,
  crossvm,
  rlconsensus,
  stakingtier,
  requirePossessionProof,
  validateCrossVmAsyncGas,
  CROSSVM_ASYNC_GAS_LIMIT_DEFAULT,
  CROSSVM_ASYNC_GAS_LIMIT_MIN,
  CROSSVM_ASYNC_GAS_LIMIT_MAX,
  CROSSVM_ASYNC_FACTOR_ONE,
  CROSSVM_MAX_PENDING_PER_SENDER_DEFAULT,
} from "./qorechain";

// The registry that resolves all of the above.
export { qorechainRegistry, qorechainRegistryTypes } from "./registry";

// Client-side checks run by the abstract-account spending-rules composer.
export {
  validateSpendingRules,
  validateEvmDenom,
  MAX_DENOM_LIMITS,
  MAX_ALLOWED_EVM_CALLS,
  VALUE_PERMISSIONS,
  hasValuePermission,
  ruleBoundsEveryDenom,
  checkValuePermissionRules,
} from "./spending-rules";
