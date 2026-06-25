/**
 * Typed message composers for every transaction QoreChain supports.
 *
 * The default export shape is a single grouped object so callers can write
 * `msg.amm.swapExactIn({ ... })`, `msg.staking.delegate({ ... })`,
 * `msg.pqc.registerPqcKey({ ... })`, etc. Standard Cosmos SDK modules
 * (bank/staking/distribution/gov/authz/feegrant/ibc) sit alongside the
 * QoreChain custom modules (amm/bridge/rdk/multilayer/pqc/svm/lightnode/
 * license/abstractaccount/crossvm/rlconsensus).
 *
 * Every composer returns a cosmjs `{ typeUrl, value }` `EncodeObject` that
 * {@link qorechainRegistry} can encode — pass an array of them straight to
 * `TxClient.signAndBroadcast` or the hybrid PQC tx path.
 */

// Standard Cosmos SDK modules.
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
  // standard cosmos
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
} from "./qorechain";

// The registry that resolves all of the above.
export { qorechainRegistry, qorechainRegistryTypes } from "./registry";
