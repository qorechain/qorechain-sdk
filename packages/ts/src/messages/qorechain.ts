/**
 * Typed message composers for the QoreChain custom modules.
 *
 * Each composer takes the message's partial value and returns a cosmjs
 * {@link EncodeObject} (`{ typeUrl, value }`) ready to pass to
 * `TxClient.signAndBroadcast` / the hybrid tx path. The `value` is built via the
 * generated `Msg*.fromPartial`, so optional fields default correctly and the
 * input is fully typed.
 *
 * Composers are grouped by module and re-exported as a single `qorechain`
 * object (see {@link messages.ts}) so callers write e.g.
 * `msg.amm.swapExactIn({ ... })` or `msg.pqc.registerPqcKey({ ... })`.
 */

import type { EncodeObject } from "@cosmjs/proto-signing";

import * as ammTx from "../codegen/qorechain/amm/v1/tx";
import * as bridgeTx from "../codegen/qorechain/bridge/v1/tx";
import * as rdkTx from "../codegen/qorechain/rdk/v1/tx";
import * as multilayerTx from "../codegen/qorechain/multilayer/v1/tx";
import * as pqcTx from "../codegen/qorechain/pqc/v1/tx";
import * as svmTx from "../codegen/qorechain/svm/v1/tx";
import * as lightnodeTx from "../codegen/qorechain/lightnode/v1/tx";
import * as licenseTx from "../codegen/qorechain/license/v1/tx";
import * as abstractaccountTx from "../codegen/qorechain/abstractaccount/v1/tx";
import { validateSpendingRules } from "./spending-rules";
import * as stakingtierTx from "../codegen/qorechain/stakingtier/v1/tx";
import { validateLockDelegation } from "../stakingtier";
import * as crossvmTx from "../codegen/qorechain/crossvm/v1/tx";
import * as rlconsensusTx from "../codegen/qorechain/rlconsensus/v1/tx";
import { validateKemPublicKey, KEM_ALGORITHM_ML_KEM_1024 } from "../pqc/kem";
import { validateUpdateConfig } from "../abstractaccount";
import { validateCrossVmUpdateParams, validateRdkUpdateParams, validateSvmUpdateParams } from "../governance";

/**
 * A generated message type with the methods the composers use.
 *
 * `fromPartial` is typed to *return* `T` and accept a structurally-partial
 * input; inferring `T` from the return position (covariant) keeps the emitted
 * `.d.ts` rollup honest. Inferring from the argument position instead caused the
 * bundled declarations to collapse the composer parameters to `never`.
 */
interface MsgType<T> {
  fromPartial(object: never): T;
}

/** A structurally-partial value accepted by a composer. */
type PartialMsg<T> = {
  [K in keyof T]?: T[K] extends object ? PartialMsg<T[K]> : T[K];
};

/** Build a `{ typeUrl, value }` composer bound to a fixed typeUrl + message. */
function composer<T>(typeUrl: string, msg: MsgType<T>) {
  return (value: PartialMsg<T>): EncodeObject => ({
    typeUrl,
    value: msg.fromPartial(value as never),
  });
}

/**
 * Refuse a `MsgRegisterAuthenticator` without a possession proof (required
 * from chain v3.2.8), saying how to make one.
 */
export function requirePossessionProof(proof: Uint8Array | undefined | null): void {
  if (!proof || proof.length === 0) {
    throw new Error(
      "registerAuthenticator: possessionProof is required from chain v3.2.8. Sign " +
        "authenticatorLinkMessage(chainId, accountAddress, scheme, pubkey) with the key being linked " +
        "(signAuthenticatorLinkEd25519 / signAuthenticatorLinkSecp256k1 / signAuthenticatorLinkEip191, or " +
        "signAuthenticatorLinkPhantom / signAuthenticatorLinkMetaMask for a browser wallet) and pass the signature",
    );
  }
}

/** AMM (automated market maker) message composers. */
export const amm = {
  createPool: composer("/qorechain.amm.v1.MsgCreatePool", ammTx.MsgCreatePool),
  addLiquidity: composer(
    "/qorechain.amm.v1.MsgAddLiquidity",
    ammTx.MsgAddLiquidity,
  ),
  removeLiquidity: composer(
    "/qorechain.amm.v1.MsgRemoveLiquidity",
    ammTx.MsgRemoveLiquidity,
  ),
  swapExactIn: composer(
    "/qorechain.amm.v1.MsgSwapExactIn",
    ammTx.MsgSwapExactIn,
  ),
  swapExactOut: composer(
    "/qorechain.amm.v1.MsgSwapExactOut",
    ammTx.MsgSwapExactOut,
  ),
  pausePool: composer("/qorechain.amm.v1.MsgPausePool", ammTx.MsgPausePool),
  resumePool: composer("/qorechain.amm.v1.MsgResumePool", ammTx.MsgResumePool),
};

/** Bridge (cross-chain asset transfer) message composers. */
export const bridge = {
  bridgeDeposit: composer(
    "/qorechain.bridge.v1.MsgBridgeDeposit",
    bridgeTx.MsgBridgeDeposit,
  ),
  bridgeWithdraw: composer(
    "/qorechain.bridge.v1.MsgBridgeWithdraw",
    bridgeTx.MsgBridgeWithdraw,
  ),
  /**
   * Register a bridge validator. From chain v3.2.4 the registration carries
   * `proofOfPossession`: the PQC key's own signature in the x/pqc format with
   * the validator address as the account, from
   * `signProofOfPossession({ chainId, account: validatorAddress, keypair })`.
   */
  registerBridgeValidator: composer(
    "/qorechain.bridge.v1.MsgRegisterBridgeValidator",
    bridgeTx.MsgRegisterBridgeValidator,
  ),
  bridgeAttestation: composer(
    "/qorechain.bridge.v1.MsgBridgeAttestation",
    bridgeTx.MsgBridgeAttestation,
  ),
  /**
   * Advance the on-chain external light client with a verified update bundle
   * (carried as an opaque encoded blob). Signed by the `relayer`.
   */
  updateEthLightClient: composer(
    "/qorechain.bridge.v1.MsgUpdateEthLightClient",
    bridgeTx.MsgUpdateEthLightClient,
  ),
  /**
   * Register or update a chain's bridge config (contract address,
   * confirmations, architecture, status, active verifier). Merge semantics:
   * empty/zero fields keep the existing value, so a caller can flip just
   * `status` + one verifier flag to activate a chain post-deploy. Signed by the
   * bridge `admin`.
   */
  updateChainConfig: composer(
    "/qorechain.bridge.v1.MsgUpdateChainConfig",
    bridgeTx.MsgUpdateChainConfig,
  ),
  /**
   * Install the per-architecture trust root a chain's trustless verifier needs
   * (guardian set / ed25519 or BLS validator quorum / Bitcoin checkpoint /
   * Starknet state root). Exactly one of the sub-fields should be populated.
   * Signed by the bridge `admin`.
   */
  setVerifierBootstrap: composer(
    "/qorechain.bridge.v1.MsgSetVerifierBootstrap",
    bridgeTx.MsgSetVerifierBootstrap,
  ),
  /**
   * Set a chain's single-transfer and daily circuit-breaker limits (chain
   * v3.2.2). Amounts in the chain's base unit, "0" = unlimited. Signed by the
   * bridge admin, a qcb_bridge licence holder, or governance.
   */
  updateCircuitBreakerLimits: composer(
    "/qorechain.bridge.v1.MsgUpdateCircuitBreakerLimits",
    bridgeTx.MsgUpdateCircuitBreakerLimits,
  ),
};

/** RDK (rollup development kit) message composers. */
export const rdk = {
  createRollup: composer(
    "/qorechain.rdk.v1.MsgCreateRollup",
    rdkTx.MsgCreateRollup,
  ),
  submitBatch: composer(
    "/qorechain.rdk.v1.MsgSubmitBatch",
    rdkTx.MsgSubmitBatch,
  ),
  challengeBatch: composer(
    "/qorechain.rdk.v1.MsgChallengeBatch",
    rdkTx.MsgChallengeBatch,
  ),
  resolveChallenge: composer(
    "/qorechain.rdk.v1.MsgResolveChallenge",
    rdkTx.MsgResolveChallenge,
  ),
  pauseRollup: composer(
    "/qorechain.rdk.v1.MsgPauseRollup",
    rdkTx.MsgPauseRollup,
  ),
  resumeRollup: composer(
    "/qorechain.rdk.v1.MsgResumeRollup",
    rdkTx.MsgResumeRollup,
  ),
  stopRollup: composer("/qorechain.rdk.v1.MsgStopRollup", rdkTx.MsgStopRollup),
  /**
   * Finalize an L2->L1 withdrawal: prove a withdrawal leaf is committed in a
   * finalized batch's `withdrawalsRoot` and pay the committed recipient from the
   * rdk module escrow. Permissionless - anyone may submit a valid proof; funds
   * always go to the committed recipient. Replay-protected per
   * (rollupId, batchIndex, withdrawalIndex). `proof` is the list of binary-Merkle
   * sibling hashes from the leaf to the root.
   */
  executeWithdrawal: composer(
    "/qorechain.rdk.v1.MsgExecuteWithdrawal",
    rdkTx.MsgExecuteWithdrawal,
  ),
  /**
   * Governance (chain v3.2.5): replace the rdk parameters wholesale. From
   * chain v3.2.8 every field (1..14) must be given explicitly; build it with
   * `rdkUpdateParamsFromCurrent`. Checked first ({@link validateRdkUpdateParams}).
   */
  updateParams: (value: PartialMsg<rdkTx.MsgUpdateParams>): EncodeObject => {
    validateRdkUpdateParams(value);
    return composer("/qorechain.rdk.v1.MsgUpdateParams", rdkTx.MsgUpdateParams)(value);
  },
};

/** Multilayer (sidechain / paychain anchoring) message composers. */
export const multilayer = {
  registerSidechain: composer(
    "/qorechain.multilayer.v1.MsgRegisterSidechain",
    multilayerTx.MsgRegisterSidechain,
  ),
  registerPaychain: composer(
    "/qorechain.multilayer.v1.MsgRegisterPaychain",
    multilayerTx.MsgRegisterPaychain,
  ),
  anchorState: composer(
    "/qorechain.multilayer.v1.MsgAnchorState",
    multilayerTx.MsgAnchorState,
  ),
  routeTransaction: composer(
    "/qorechain.multilayer.v1.MsgRouteTransaction",
    multilayerTx.MsgRouteTransaction,
  ),
  updateLayerStatus: composer(
    "/qorechain.multilayer.v1.MsgUpdateLayerStatus",
    multilayerTx.MsgUpdateLayerStatus,
  ),
  challengeAnchor: composer(
    "/qorechain.multilayer.v1.MsgChallengeAnchor",
    multilayerTx.MsgChallengeAnchor,
  ),
  /** Replace the multilayer parameters (chain v3.2.2). Governance only. */
  updateParams: composer(
    "/qorechain.multilayer.v1.MsgUpdateParams",
    multilayerTx.MsgUpdateParams,
  ),
};

/** PQC (post-quantum key) message composers. */
export const pqc = {
  registerPqcKey: composer(
    "/qorechain.pqc.v1.MsgRegisterPQCKey",
    pqcTx.MsgRegisterPQCKey,
  ),
  registerPqcKeyV2: composer(
    "/qorechain.pqc.v1.MsgRegisterPQCKeyV2",
    pqcTx.MsgRegisterPQCKeyV2,
  ),
  migratePqcKey: composer(
    "/qorechain.pqc.v1.MsgMigratePQCKey",
    pqcTx.MsgMigratePQCKey,
  ),
  deprecateAlgorithm: composer(
    "/qorechain.pqc.v1.MsgDeprecateAlgorithm",
    pqcTx.MsgDeprecateAlgorithm,
  ),
  disableAlgorithm: composer(
    "/qorechain.pqc.v1.MsgDisableAlgorithm",
    pqcTx.MsgDisableAlgorithm,
  ),
  /**
   * Replace an account's PQC key with a NEW key of the SAME algorithm (rotate a
   * compromised key, or migrate a legacy-derived key to the canonical
   * derivation). Dual-signed over the domain-separated rotation bytes (the old
   * key proves ownership, the new key proves control). Sender-signed; broadcast
   * BY the account, cosigned (hybrid) with the OLD key.
   */
  rotatePqcKey: composer(
    "/qorechain.pqc.v1.MsgRotatePQCKey",
    pqcTx.MsgRotatePQCKey,
  ),
  /**
   * Open a bounded authorisation window for the sender's EVM lane (chain
   * v3.2.0). From that release an EVM transaction is admitted only from an
   * account that holds a registered PQC key AND has a live window, so the
   * classical key alone can never move value.
   *
   * A Cosmos-lane message carrying the usual hybrid signature. Every field is
   * required; the chain refuses a missing one rather than defaulting it. Use
   * {@link ../pqc/evm-window.openEvmWindowMsg} to get the bounds checked before
   * you broadcast.
   *
   * NOTE: the identity is unified, so the Cosmos sequence IS the EVM nonce and
   * broadcasting this ADVANCES it. Open the window, then read the nonce, then
   * sign the EVM transaction.
   */
  openEvmWindow: composer(
    "/qorechain.pqc.v1.MsgOpenEVMWindow",
    pqcTx.MsgOpenEVMWindow,
  ),
  /** Revoke the sender's EVM authorisation window; effective in the same block. */
  closeEvmWindow: composer(
    "/qorechain.pqc.v1.MsgCloseEVMWindow",
    pqcTx.MsgCloseEVMWindow,
  ),
  /**
   * Consent, with the post-quantum key, to one EIP-7702 delegation of the
   * sender's own account (chain v3.2.2). From that release the EVM lane refuses
   * a type-4 transaction whose authorization would change an account's code
   * unless that account consented to exactly that delegate. Single use, bounded
   * in blocks, replaces any earlier consent. Use
   * {@link ../pqc/evm-delegation.authorizeEvmDelegationMsg} to get the bounds
   * checked first.
   */
  authorizeEvmDelegation: composer(
    "/qorechain.pqc.v1.MsgAuthorizeEVMDelegation",
    pqcTx.MsgAuthorizeEVMDelegation,
  ),
  /**
   * Remove the sender's EIP-7702 delegation on the Cosmos lane, with no EVM
   * transaction, window or classical key (chain v3.2.2).
   */
  clearEvmDelegation: composer(
    "/qorechain.pqc.v1.MsgClearEVMDelegation",
    pqcTx.MsgClearEVMDelegation,
  ),
  /**
   * Publish the sender's KEM (key-encapsulation) public key so anyone can
   * encrypt to the account (chain v3.2.5). `algorithmId` defaults to
   * ML-KEM-1024 (2), whose key is 1568 bytes and is checked first
   * ({@link validateKemPublicKey}). Sending it again replaces the key. Needs the
   * account's hybrid signature.
   */
  registerKemKey: (value: PartialMsg<pqcTx.MsgRegisterKEMKey>): EncodeObject => {
    const algorithmId = value.algorithmId ?? KEM_ALGORITHM_ML_KEM_1024;
    if (!value.sender) throw new Error("registerKemKey: sender is required");
    validateKemPublicKey(value.publicKey as Uint8Array | undefined, algorithmId);
    return composer("/qorechain.pqc.v1.MsgRegisterKEMKey", pqcTx.MsgRegisterKEMKey)({ ...value, algorithmId });
  },
  /** Withdraw the sender's published KEM key (chain v3.2.5). Needs the hybrid signature. */
  removeKemKey: (value: PartialMsg<pqcTx.MsgRemoveKEMKey>): EncodeObject => {
    if (!value.sender) throw new Error("removeKemKey: sender is required");
    return composer("/qorechain.pqc.v1.MsgRemoveKEMKey", pqcTx.MsgRemoveKEMKey)(value);
  },
};

/** SVM (virtual machine programs/accounts) message composers. */
export const svm = {
  deployProgram: composer(
    "/qorechain.svm.v1.MsgDeployProgram",
    svmTx.MsgDeployProgram,
  ),
  createAccount: composer(
    "/qorechain.svm.v1.MsgCreateAccount",
    svmTx.MsgCreateAccount,
  ),
  executeProgram: composer(
    "/qorechain.svm.v1.MsgExecuteProgram",
    svmTx.MsgExecuteProgram,
  ),
  registerSvmPqcKey: composer(
    "/qorechain.svm.v1.MsgRegisterSVMPQCKey",
    svmTx.MsgRegisterSVMPQCKey,
  ),
  /**
   * Replace the x/svm runtime parameters wholesale (chain v3.1.97).
   *
   * GOVERNANCE ONLY: `authority` must be the governance module account, so this
   * message is submitted inside a gov proposal, not signed by a user. It is what
   * makes enabling/disabling the SVM lane a proposal rather than a binary
   * release. `params` is replaced in full - send every field, not just the ones
   * you mean to change. `rentExemptionMulti` is a `LegacyDec` string (e.g.
   * `"2.000000000000000000"`).
   *
   * From chain v3.2.8 every `SVMParams` field (1..12, among them the custody
   * ceilings `maxCustodyUqor`, `maxCustodyHardUqor`, `maxAccountExcessUqor`)
   * must be given explicitly, and `enabled: true` needs `maxCustodyHardUqor >
   * 0`. Checked first ({@link validateSvmUpdateParams}); build it with
   * `svmUpdateParamsFromCurrent`.
   */
  updateParams: (value: PartialMsg<svmTx.MsgUpdateParams>): EncodeObject => {
    validateSvmUpdateParams(value as Parameters<typeof validateSvmUpdateParams>[0]);
    return composer("/qorechain.svm.v1.MsgUpdateParams", svmTx.MsgUpdateParams)(value);
  },
};

/** Light-node lifecycle message composers. */
export const lightnode = {
  registerLightNode: composer(
    "/qorechain.lightnode.v1.MsgRegisterLightNode",
    lightnodeTx.MsgRegisterLightNode,
  ),
  heartbeat: composer(
    "/qorechain.lightnode.v1.MsgHeartbeat",
    lightnodeTx.MsgHeartbeat,
  ),
  deregisterLightNode: composer(
    "/qorechain.lightnode.v1.MsgDeregisterLightNode",
    lightnodeTx.MsgDeregisterLightNode,
  ),
  claimLightNodeRewards: composer(
    "/qorechain.lightnode.v1.MsgClaimLightNodeRewards",
    lightnodeTx.MsgClaimLightNodeRewards,
  ),
};

/** Feature-license message composers. */
export const license = {
  grantLicense: composer(
    "/qorechain.license.v1.MsgGrantLicense",
    licenseTx.MsgGrantLicense,
  ),
  revokeLicense: composer(
    "/qorechain.license.v1.MsgRevokeLicense",
    licenseTx.MsgRevokeLicense,
  ),
  suspendLicense: composer(
    "/qorechain.license.v1.MsgSuspendLicense",
    licenseTx.MsgSuspendLicense,
  ),
  resumeLicense: composer(
    "/qorechain.license.v1.MsgResumeLicense",
    licenseTx.MsgResumeLicense,
  ),
  /**
   * Replace the licence grant authority (chain v3.2.3). Signed by the
   * governance module account, so it only executes from a passed proposal.
   */
  updateAuthority: composer(
    "/qorechain.license.v1.MsgUpdateAuthority",
    licenseTx.MsgUpdateAuthority,
  ),
};

/** Abstract-account message composers. */
export const abstractaccount = {
  createAbstractAccount: composer(
    "/qorechain.abstractaccount.v1.MsgCreateAbstractAccount",
    abstractaccountTx.MsgCreateAbstractAccount,
  ),
  /**
   * Set an account's spending rules. Owner-signed. The rules are checked
   * first ({@link validateSpendingRules}): an enabled rule that bounds nothing
   * is refused here rather than stored as a limit that limits nothing.
   */
  updateSpendingRules: (value: PartialMsg<abstractaccountTx.MsgUpdateSpendingRules>): EncodeObject => {
    validateSpendingRules(value.rules as Parameters<typeof validateSpendingRules>[0]);
    return composer(
      "/qorechain.abstractaccount.v1.MsgUpdateSpendingRules",
      abstractaccountTx.MsgUpdateSpendingRules,
    )(value);
  },
  /**
   * Link a foreign-scheme wallet key (e.g. a Phantom ed25519 key) to an account
   * so it may act for that account under least-privilege, time-bounded, revocable
   * terms. Owner-signed.
   *
   * From chain v3.2.8 `possessionProof` is required: the linked key's own
   * signature over `authenticatorLinkMessage(chainId, accountAddress, scheme,
   * pubkey)`. An empty proof is refused here. A key with a value permission
   * also needs a bounding spending rule on the account; `linkAuthenticatorMsgs`
   * builds both messages together.
   */
  registerAuthenticator: (value: PartialMsg<abstractaccountTx.MsgRegisterAuthenticator>): EncodeObject => {
    requirePossessionProof(value.possessionProof as Uint8Array | undefined);
    return composer(
      "/qorechain.abstractaccount.v1.MsgRegisterAuthenticator",
      abstractaccountTx.MsgRegisterAuthenticator,
    )(value);
  },
  /** Instantly disable a previously linked wallet key. Owner-signed. */
  revokeAuthenticator: composer(
    "/qorechain.abstractaccount.v1.MsgRevokeAuthenticator",
    abstractaccountTx.MsgRevokeAuthenticator,
  ),
  /**
   * EVM-lane spend: execute an EVM call/transfer FROM the canonical account's
   * 0x address, authorized by a linked authenticator's signature over the EVM
   * auth sign-bytes. Relayer-signed (it submits + pays fees). See
   * {@link ../tx/authenticator.evmAuthSignBytes}.
   */
  executeEvm: composer(
    "/qorechain.abstractaccount.v1.MsgExecuteEVM",
    abstractaccountTx.MsgExecuteEVM,
  ),
  /**
   * Native-lane spend: move native QOR FROM the canonical account via x/bank,
   * authorized by a linked authenticator's signature over the Cosmos auth
   * sign-bytes. Relayer-signed (it submits + pays fees). See
   * {@link ../tx/authenticator.cosmosAuthSignBytes}.
   */
  executeCosmos: composer(
    "/qorechain.abstractaccount.v1.MsgExecuteCosmos",
    abstractaccountTx.MsgExecuteCosmos,
  ),
  /**
   * Governance (chain v3.2.5): replace the module configuration wholesale,
   * among it the `enabled` switch. Checked first ({@link validateUpdateConfig}).
   */
  updateConfig: (value: PartialMsg<abstractaccountTx.MsgUpdateConfig>): EncodeObject => {
    validateUpdateConfig(value);
    return composer("/qorechain.abstractaccount.v1.MsgUpdateConfig", abstractaccountTx.MsgUpdateConfig)(value);
  },
};

/** `asyncGasLimit` the chain uses when an async CosmWasm call leaves it 0. */
export const CROSSVM_ASYNC_GAS_LIMIT_DEFAULT = 500_000;
/** Smallest `asyncGasLimit` the chain accepts when one is set. */
export const CROSSVM_ASYNC_GAS_LIMIT_MIN = 250_000;
/** Largest `asyncGasLimit` the chain accepts. */
export const CROSSVM_ASYNC_GAS_LIMIT_MAX = 10_000_000;
/** `asyncMaxFactor` unit: 1,000,000 millionths is a factor of 1x. */
export const CROSSVM_ASYNC_FACTOR_ONE = 1_000_000;
/** Default bound on the async calls one sender may have pending (chain v3.2.8). */
export const CROSSVM_MAX_PENDING_PER_SENDER_DEFAULT = 100;

/**
 * The client-side checks on the async gas fields of `MsgCrossVMCall` (chain
 * v3.2.8). `asyncGasLimit` (0 = 500,000, otherwise 250,000 to 10,000,000) and
 * `asyncMaxFactor` (millionths, 1,000,000 = 1x; 0 = four times the factor at
 * submission) apply only to an async call into CosmWasm; a non-zero value on a
 * synchronous call or another target VM is refused.
 */
export function validateCrossVmAsyncGas(value: {
  async?: boolean;
  targetVm?: string;
  asyncGasLimit?: string | number | bigint;
  asyncMaxFactor?: string | number | bigint;
}): void {
  const n = (v: string | number | bigint | undefined, name: string): bigint => {
    let x: bigint;
    try {
      x = BigInt(v ?? 0);
    } catch {
      throw new Error(`crossVmCall: ${name} must be a non-negative integer, got ${String(v)}`);
    }
    if (x < 0n) throw new Error(`crossVmCall: ${name} must be a non-negative integer, got ${String(v)}`);
    return x;
  };
  const gas = n(value.asyncGasLimit, "asyncGasLimit");
  const factor = n(value.asyncMaxFactor, "asyncMaxFactor");
  if (gas === 0n && factor === 0n) return;
  if (value.async !== true) {
    throw new Error("crossVmCall: asyncGasLimit and asyncMaxFactor apply only to async calls (set async: true)");
  }
  if (value.targetVm !== "cosmwasm") {
    throw new Error(`crossVmCall: asyncGasLimit and asyncMaxFactor apply only to async calls into cosmwasm, not ${JSON.stringify(value.targetVm ?? "")}`);
  }
  if (gas !== 0n && (gas < BigInt(CROSSVM_ASYNC_GAS_LIMIT_MIN) || gas > BigInt(CROSSVM_ASYNC_GAS_LIMIT_MAX))) {
    throw new Error(
      `crossVmCall: asyncGasLimit must be 0 (the default ${CROSSVM_ASYNC_GAS_LIMIT_DEFAULT}) or ` +
        `${CROSSVM_ASYNC_GAS_LIMIT_MIN}..${CROSSVM_ASYNC_GAS_LIMIT_MAX}, got ${gas}`,
    );
  }
}

/** Cross-VM message composers. */
export const crossvm = {
  /**
   * A cross-VM call. From chain v3.2.8 an async call into CosmWasm may set
   * `asyncGasLimit` and `asyncMaxFactor`; both are checked first
   * ({@link validateCrossVmAsyncGas}) and refused on a synchronous call or
   * another target VM.
   */
  crossVmCall: (value: PartialMsg<crossvmTx.MsgCrossVMCall>): EncodeObject => {
    validateCrossVmAsyncGas(value);
    return composer("/qorechain.crossvm.v1.MsgCrossVMCall", crossvmTx.MsgCrossVMCall)(value);
  },
  processQueue: composer(
    "/qorechain.crossvm.v1.MsgProcessQueue",
    crossvmTx.MsgProcessQueue,
  ),
  /**
   * Governance (chain v3.2.5): replace the crossvm parameters wholesale, among
   * them the allowlist of CosmWasm contracts the EVM bridge precompile may call.
   * From chain v3.2.8 every field (1..18) must be given explicitly (a left-out
   * `bridgeTargetPins` would wipe the pins); build it with
   * `crossvmUpdateParamsFromCurrent`. Checked first
   * ({@link validateCrossVmUpdateParams}).
   */
  updateParams: (value: PartialMsg<crossvmTx.MsgUpdateParams>): EncodeObject => {
    validateCrossVmUpdateParams(value);
    return composer("/qorechain.crossvm.v1.MsgUpdateParams", crossvmTx.MsgUpdateParams)(value);
  },
};

/** RL-consensus (governance authority) message composers. */
export const rlconsensus = {
  setAgentMode: composer(
    "/qorechain.rlconsensus.v1.MsgSetAgentMode",
    rlconsensusTx.MsgSetAgentMode,
  ),
  resumeAgent: composer(
    "/qorechain.rlconsensus.v1.MsgResumeAgent",
    rlconsensusTx.MsgResumeAgent,
  ),
  updatePolicy: composer(
    "/qorechain.rlconsensus.v1.MsgUpdatePolicy",
    rlconsensusTx.MsgUpdatePolicy,
  ),
  updateRewardWeights: composer(
    "/qorechain.rlconsensus.v1.MsgUpdateRewardWeights",
    rlconsensusTx.MsgUpdateRewardWeights,
  ),
};

/**
 * Staking-tier composers (chain v3.2.4): lock part of a delegation for 3, 6
 * or 12 months for a bonus on top of the staking reward, leave a lock early
 * (a penalty is burned and the bonus forfeited), and claim the accrued bonus.
 */
export const stakingtier = {
  /** Lock `amount` (base units) of the delegator's existing delegation to `validator`. */
  lockDelegation: (value: PartialMsg<stakingtierTx.MsgLockDelegation>): EncodeObject => {
    validateLockDelegation(value);
    return composer("/qorechain.stakingtier.v1.MsgLockDelegation", stakingtierTx.MsgLockDelegation)(value);
  },
  /** Release lock `lockId` before its term ends. */
  unlockEarly: composer("/qorechain.stakingtier.v1.MsgUnlockEarly", stakingtierTx.MsgUnlockEarly),
  /** Claim the holder's accrued bonus. */
  claimBonus: composer("/qorechain.stakingtier.v1.MsgClaimBonus", stakingtierTx.MsgClaimBonus),
  /** Governance: replace the module parameters. */
  updateParams: composer("/qorechain.stakingtier.v1.MsgUpdateParams", stakingtierTx.MsgUpdateParams),
};
