/**
 * The EVM-lane post-quantum authorisation window (chain v3.2.0).
 *
 * From v3.2.0 an EVM transaction is admitted only from an account that holds a
 * registered ML-DSA key AND has opened a bounded authorisation window with a
 * Cosmos-lane message. The window is what stops the classical secp256k1 key
 * from moving value on its own: opening one requires the post-quantum key, so
 * a stolen classical key cannot authorise itself.
 *
 * The bounds, the REST reader and the refusal classifier live in
 * `@qorechain/evm` (its viem-free `@qorechain/evm/window` subpath) and are
 * re-exported here; this module adds the protobuf-encoded message builders the
 * native-lane signers take.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  Three things that surprise people
 * ──────────────────────────────────────────────────────────────────────────
 *  1. **Opening a window advances the EVM nonce.** QoreChain unifies the
 *     identity, so the account's Cosmos sequence *is* its EVM nonce, and
 *     `MsgOpenEVMWindow` is an ordinary Cosmos transaction. Sign the EVM
 *     transaction *after* opening, or it is refused with "nonce too low". The
 *     order is: open → read the nonce → sign.
 *  2. **`maxValue` bounds value PLUS the maximum fee** each admitted
 *     transaction could pay (gas limit × gas fee cap), because the holder of
 *     the classical key chooses the gas price and a value-only bound would
 *     leave the account drainable through fees. A 1,000 uqor transfer with a
 *     21,000 gas limit at 112.5 gwei consumes 3,363 uqor of the window.
 *     Conversion from wei to uqor rounds **up**.
 *  3. **`blocks` is a block count, not a duration.** The maximum of 17,280
 *     blocks is roughly 5 hours on the testnet and roughly 15 hours on mainnet.
 *     Show "up to 17,280 blocks", or compute a duration from the chain's recent
 *     block time.
 *
 * This module deliberately offers no "open a window automatically before
 * sending" helper. The window exists so that spending is authorised
 * deliberately; a wallet that opens one on every send turns that into a click
 * nobody reads. Surface {@link classifyEvmWindowRejection} to the user, then
 * let them authorise explicitly.
 */

import type { EncodeObject } from "@cosmjs/proto-signing";
import {
  checkOpenEvmWindowParams,
  evmWindowStatus,
  type EvmWindow,
  type OpenEvmWindowParams,
  type WindowFetchLike,
} from "@qorechain/evm/window";

import { pqc as pqcMsg } from "../messages/qorechain";
import { isValidBech32 } from "../utils/address";
import type { FetchLike } from "../query/http";

export {
  MAX_EVM_WINDOW_BLOCKS,
  MAX_EVM_WINDOW_TXS,
  MAX_EVM_WINDOW_TARGETS,
  classifyEvmWindowRejection,
  isEvmWindowRejection,
  type EvmWindow,
  type EvmWindowRejection,
  type OpenEvmWindowParams,
} from "@qorechain/evm/window";

/**
 * The chain v3.2.8 scope fields of `MsgOpenEVMWindow`, on top of
 * {@link OpenEvmWindowParams}. All optional; an empty list leaves the scope as
 * before.
 *
 * Through a window the standard precompile methods are deny-by-default:
 * staking delegate / redelegate need the validator in `stakingValidators`,
 * an ICS-20 transfer needs its `"<channel>/<receiver>"` in `ibcReceivers`,
 * and undelegate, governance votes and withdraw-address changes are refused
 * through the window altogether (send them as a PQC-signed Cosmos
 * transaction). Rotating, migrating or re-registering the PQC key closes the
 * window.
 */
export interface OpenEvmWindowScope {
  /**
   * Contracts (0x 20-byte addresses) whose check of the account's signature
   * counts for the account's own actions: a validator module its code consults,
   * or an ERC-4337 entry point. Does not narrow where transactions may go.
   */
  validators?: readonly string[];
  /** Validators (`qorvaloper1...`) the window may delegate or redelegate to through the staking precompile. */
  stakingValidators?: readonly string[];
  /** ICS-20 receivers the window may send to, each `"<source channel>/<receiver>"`, e.g. `"channel-0/cosmos1..."`. */
  ibcReceivers?: readonly string[];
}

/** Check one list of the v3.2.8 window scope: format, no duplicates. */
function checkScopeList(name: string, list: readonly string[] | undefined, ok: (s: string) => boolean, shape: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list ?? []) {
    const v = String(raw).trim();
    if (!ok(v)) throw new Error(`${name}: ${JSON.stringify(raw)} is not ${shape}`);
    const key = v.toLowerCase();
    if (seen.has(key)) throw new Error(`${name}: ${JSON.stringify(raw)} is listed twice`);
    seen.add(key);
    out.push(v);
  }
  return out;
}

/**
 * Check the v3.2.8 window scope fields (light format checks: 0x 20-byte
 * addresses, `qorvaloper1...` bech32, `"channel-N/<receiver>"`) and return
 * them as the message takes them.
 */
export function checkOpenEvmWindowScope(scope: OpenEvmWindowScope): {
  validators: string[];
  stakingValidators: string[];
  ibcReceivers: string[];
} {
  return {
    validators: checkScopeList("validators", scope.validators, (v) => /^0[xX][0-9a-fA-F]{40}$/.test(v), "a 0x-prefixed 20-byte address"),
    stakingValidators: checkScopeList(
      "stakingValidators",
      scope.stakingValidators,
      (v) => isValidBech32(v, "qorvaloper"),
      "a qorvaloper1... validator address",
    ),
    ibcReceivers: checkScopeList(
      "ibcReceivers",
      scope.ibcReceivers,
      (v) => {
        // The chain's ParseIBCReceiver: 1 to 256 characters, no whitespace or
        // comma, a "/" with text on both sides.
        if (v.length === 0 || v.length > 256 || /[\s,]/.test(v)) return false;
        const i = v.indexOf("/");
        return i > 0 && i < v.length - 1;
      },
      'of the form "<source channel>/<receiver>", e.g. "channel-0/cosmos1..."',
    ),
  };
}

/**
 * Build `MsgOpenEVMWindow`, checking the chain's bounds first so a mistake
 * fails here instead of costing a refused transaction. Takes the v3.2.8 scope
 * fields too ({@link OpenEvmWindowScope}).
 *
 * Remember that broadcasting this advances the account's EVM nonce.
 */
export function openEvmWindowMsg(params: OpenEvmWindowParams & OpenEvmWindowScope): EncodeObject {
  return pqcMsg.openEvmWindow({ ...checkOpenEvmWindowParams(params), ...checkOpenEvmWindowScope(params) });
}

/** Build `MsgCloseEVMWindow`. The revocation takes effect in the same block. */
export function closeEvmWindowMsg(sender: string): EncodeObject {
  if (!sender) throw new Error("sender is required");
  return pqcMsg.closeEvmWindow({ sender });
}

/**
 * Read an account's window over REST. Answers `{ found: false }` rather than
 * failing when there is none, so it is safe to poll. Same as `evmWindowStatus`
 * in `@qorechain/evm`.
 *
 * @throws on a transport failure or an unparsable body.
 */
export function fetchEvmWindow(opts: {
  /** The network's REST (LCD) base URL. */
  rest: string;
  /** The `qor1…` address to look up. */
  address: string;
  /** Injectable `fetch`. Defaults to `globalThis.fetch`. */
  fetch?: FetchLike;
}): Promise<EvmWindow> {
  return evmWindowStatus({
    rest: opts.rest,
    address: opts.address,
    fetch: opts.fetch as unknown as WindowFetchLike | undefined,
  });
}
