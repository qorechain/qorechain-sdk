/**
 * High-level Rollup client — ergonomic RDK (rollup) operations.
 *
 * The rdk module lets an app create app-specific rollups, submit settlement
 * batches, run the fraud-proof challenge game, pause/resume/stop a rollup, and
 * finalize L2->L1 withdrawals. This helper wraps the typed message composers
 * ({@link msg.rdk}) and the typed query client so a developer can drive a
 * rollup's full lifecycle without hand-building messages or remembering ABCI
 * service/method names.
 *
 * Lifecycle, end to end:
 *  1. `createRollup` — declare a new rollup (profile + VM + stake).
 *  2. `submitBatch` — the sequencer posts a settlement batch (state root, data
 *     hash, optional `withdrawalsRoot` committing L2->L1 messages).
 *  3. `challengeBatch` / `resolveChallenge` — the fraud-proof game.
 *  4. `pause` / `resume` / `stop` — operator lifecycle controls.
 *  5. `executeWithdrawal` — anyone proves a withdrawal leaf against a finalized
 *     batch's `withdrawalsRoot` and the recipient is paid.
 *  6. `getRollup` / `listRollups` / `getBatch` / `getLatestBatch` — typed reads,
 *     plus the `qor_*` conveniences (`getRollupStatus`, `suggestRollupProfile`,
 *     `getDaBlobStatus`).
 *
 * Construct one with {@link createRollupClient}, passing a connected
 * {@link TxClient} (for writes) and, optionally, an {@link RdkQueryClient} and a
 * {@link QorClient} (for the typed and `qor_*` reads respectively).
 *
 * Note on SDK vs RDK: this SDK is the *app-developer* interaction surface (submit
 * and read rollup transactions). The separate Rollup Development Kit is for
 * *operating* a rollup node (sequencer, prover, data-availability). They are
 * complementary: build your app against this SDK; run the rollup with the RDK.
 */

import type { EncodeObject } from "@cosmjs/proto-signing";

import { rdk as rdkMsg } from "../messages/qorechain";
import type { TxClient, FeeInput, AutoFeeOptions } from "../tx/builder";
import type { BroadcastResult } from "../tx/broadcast";
import type { RdkQueryClient } from "../query/grpc";
import type { QorClient } from "../query/qor";
import type {
  QueryBatchResponse,
  QueryLatestBatchResponse,
  QueryParamsResponse,
  QueryRollupResponse,
  QueryRollupsResponse,
} from "../codegen/qorechain/rdk/v1/query";

/** Shared write-path options forwarded to {@link TxClient.signAndBroadcast}. */
export interface RollupWriteOptions {
  /** Fee: an explicit `StdFee` or `"auto"` (simulate + price). Default `"auto"`. */
  fee?: FeeInput;
  /** Optional memo string. */
  memo?: string;
  /** Auto-fee tuning (gas multiplier / gas price) when `fee` is `"auto"`. */
  autoFee?: AutoFeeOptions;
}

/** Options for {@link RollupClient.createRollup}. */
export interface CreateRollupOptions extends RollupWriteOptions {
  /** Unique rollup identifier (e.g. `"my-app-rollup"`). */
  rollupId: string;
  /** Rollup profile preset (e.g. `"default"`, `"high-throughput"`). */
  profile?: string;
  /** Execution VM type (e.g. `"evm"`, `"wasm"`, `"svm"`). */
  vmType?: string;
  /** Stake to bond for the rollup, in base units. */
  stakeAmount?: bigint | number | string;
}

/** Options for {@link RollupClient.submitBatch}. */
export interface SubmitBatchOptions extends RollupWriteOptions {
  /** The rollup the batch belongs to. */
  rollupId: string;
  /** Monotonic batch index. */
  batchIndex: bigint | number | string;
  /** The new state root after applying this batch. */
  stateRoot: Uint8Array;
  /** The previous state root (the batch's parent). */
  prevStateRoot?: Uint8Array;
  /** Number of transactions in the batch. */
  txCount?: bigint | number | string;
  /** Hash of the batch's transaction data (for data availability). */
  dataHash?: Uint8Array;
  /** Validity/fraud proof bytes (empty for optimistic batches). */
  proof?: Uint8Array;
  /**
   * Binary-Merkle root committing the L2->L1 messages (withdrawals) in this
   * batch. Leave empty when the batch carries no cross-layer messages; set it so
   * `executeWithdrawal` proofs can later be verified against this batch.
   */
  withdrawalsRoot?: Uint8Array;
}

/** Options for {@link RollupClient.challengeBatch}. */
export interface ChallengeBatchOptions extends RollupWriteOptions {
  /** The rollup the disputed batch belongs to. */
  rollupId: string;
  /** Index of the batch being challenged. */
  batchIndex: bigint | number | string;
  /** Fraud proof bytes backing the challenge. */
  proof?: Uint8Array;
}

/** Options for {@link RollupClient.resolveChallenge}. */
export interface ResolveChallengeOptions extends RollupWriteOptions {
  /** The rollup the disputed batch belongs to. */
  rollupId: string;
  /** Index of the challenged batch. */
  batchIndex: bigint | number | string;
  /**
   * `true`: fraud confirmed — batch rejected, challenger refunded + rewarded.
   * `false`: challenge dismissed — challenger bond forfeited, batch finalizable.
   */
  fraudUpheld: boolean;
}

/** Options for the operator lifecycle controls (pause/resume/stop). */
export interface RollupLifecycleOptions extends RollupWriteOptions {
  /** The rollup to act on. */
  rollupId: string;
  /** Reason for the action (used by `pause`; ignored otherwise). */
  reason?: string;
}

/** Options for {@link RollupClient.executeWithdrawal}. */
export interface ExecuteWithdrawalOptions extends RollupWriteOptions {
  /** The rollup the withdrawal was committed in. */
  rollupId: string;
  /** Index of the finalized batch whose `withdrawalsRoot` commits the leaf. */
  batchIndex: bigint | number | string;
  /** Index of the withdrawal leaf within the batch. */
  withdrawalIndex: bigint | number | string;
  /** Address that receives the funds (committed in the leaf). */
  recipient: string;
  /** Denom of the withdrawn asset. */
  denom: string;
  /** Amount to release, in base units. */
  amount: bigint | number | string;
  /** Binary-Merkle sibling hashes from the leaf up to `withdrawalsRoot`. */
  proof: Uint8Array[];
}

/**
 * Ergonomic client for the rdk (rollup) module.
 *
 * Writes return the raw {@link BroadcastResult}; typed reads return the query
 * responses; the `qor_*` conveniences return loosely-typed JSON. Build a message
 * offline with the `*Msg` methods to batch several into one tx yourself.
 */
export interface RollupClient {
  /** Create a new rollup. */
  createRollup(opts: CreateRollupOptions): Promise<BroadcastResult>;
  /** Submit a settlement batch (sequencer). */
  submitBatch(opts: SubmitBatchOptions): Promise<BroadcastResult>;
  /** Challenge a batch with a fraud proof. */
  challengeBatch(opts: ChallengeBatchOptions): Promise<BroadcastResult>;
  /** Resolve an open challenge. */
  resolveChallenge(opts: ResolveChallengeOptions): Promise<BroadcastResult>;
  /** Pause a rollup. */
  pause(opts: RollupLifecycleOptions): Promise<BroadcastResult>;
  /** Resume a paused rollup. */
  resume(opts: RollupLifecycleOptions): Promise<BroadcastResult>;
  /** Stop a rollup permanently. */
  stop(opts: RollupLifecycleOptions): Promise<BroadcastResult>;
  /** Finalize an L2->L1 withdrawal by proving it against a finalized batch. */
  executeWithdrawal(opts: ExecuteWithdrawalOptions): Promise<BroadcastResult>;

  /** Build the `CreateRollup` message without broadcasting. */
  createRollupMsg(opts: Omit<CreateRollupOptions, keyof RollupWriteOptions>): EncodeObject;
  /** Build the `SubmitBatch` message without broadcasting. */
  submitBatchMsg(opts: Omit<SubmitBatchOptions, keyof RollupWriteOptions>): EncodeObject;
  /** Build the `ExecuteWithdrawal` message without broadcasting. */
  executeWithdrawalMsg(opts: Omit<ExecuteWithdrawalOptions, keyof RollupWriteOptions>): EncodeObject;

  /** Read a single rollup config by id. Requires a query client. */
  getRollup(rollupId: string): Promise<QueryRollupResponse>;
  /** List all rollups. Requires a query client. */
  listRollups(): Promise<QueryRollupsResponse>;
  /** Read a settlement batch by (rollupId, batchIndex). Requires a query client. */
  getBatch(rollupId: string, batchIndex: bigint | number | string): Promise<QueryBatchResponse>;
  /** Read the latest settlement batch for a rollup. Requires a query client. */
  getLatestBatch(rollupId: string): Promise<QueryLatestBatchResponse>;
  /** Read the module parameters. Requires a query client. */
  getParams(): Promise<QueryParamsResponse>;

  /** `qor_getRollupStatus` convenience. Requires a `qor` client. */
  getRollupStatus<T = Record<string, unknown>>(rollupId: string): Promise<T>;
  /** `qor_suggestRollupProfile` convenience. Requires a `qor` client. */
  suggestRollupProfile<T = Record<string, unknown>>(useCase: string): Promise<T>;
  /** `qor_getDABlobStatus` convenience. Requires a `qor` client. */
  getDaBlobStatus<T = Record<string, unknown>>(rollupId: string, blobIndex: number): Promise<T>;
}

/** Options for {@link createRollupClient}. */
export interface CreateRollupClientOptions {
  /**
   * Typed query client for the typed reads (`getRollup`, `getBatch`, …). Obtain
   * it via {@link connectQueryClients} / {@link createQueryClients}. If omitted,
   * the typed read methods throw.
   */
  query?: RdkQueryClient;
  /**
   * `qor_` JSON-RPC client for the convenience reads (`getRollupStatus`,
   * `suggestRollupProfile`, `getDaBlobStatus`). Available on `client.qor`. If
   * omitted, those methods throw.
   */
  qor?: QorClient;
}

/** Coerce a numeric-ish input to the string ts-proto expects for 64-bit ints. */
function toUint(value: bigint | number | string | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

function requireQuery(q: RdkQueryClient | undefined): RdkQueryClient {
  if (!q) {
    throw new Error(
      "rollup typed reads require a query client — pass { query } to createRollupClient (e.g. from connectQueryClients)",
    );
  }
  return q;
}

function requireQor(q: QorClient | undefined): QorClient {
  if (!q) {
    throw new Error(
      "rollup qor_ reads require a qor client — pass { qor } to createRollupClient (e.g. client.qor)",
    );
  }
  return q;
}

/**
 * Create a {@link RollupClient} bound to a connected {@link TxClient}.
 *
 * The `TxClient`'s sender address is used as the message signer
 * (creator/sequencer/challenger/resolver/submitter depending on the message), so
 * the caller never repeats their address.
 *
 * @param tx - A connected signing client (from `client.connectTx(signer)`).
 * @param opts - Optional typed query client and/or `qor_` client for reads.
 */
export function createRollupClient(
  tx: TxClient,
  opts: CreateRollupClientOptions = {},
): RollupClient {
  const sender = tx.senderAddress;
  const query = opts.query;
  const qor = opts.qor;

  const send = (
    message: EncodeObject,
    w: RollupWriteOptions,
  ): Promise<BroadcastResult> =>
    tx.signAndBroadcast([message], w.fee ?? "auto", w.memo ?? "", {
      autoFee: w.autoFee,
    });

  const createRollupMsg = (
    o: Omit<CreateRollupOptions, keyof RollupWriteOptions>,
  ): EncodeObject =>
    rdkMsg.createRollup({
      creator: sender,
      rollupId: o.rollupId,
      profile: o.profile,
      vmType: o.vmType,
      stakeAmount: toUint(o.stakeAmount),
    });

  const submitBatchMsg = (
    o: Omit<SubmitBatchOptions, keyof RollupWriteOptions>,
  ): EncodeObject =>
    rdkMsg.submitBatch({
      sequencer: sender,
      rollupId: o.rollupId,
      batchIndex: toUint(o.batchIndex),
      stateRoot: o.stateRoot,
      prevStateRoot: o.prevStateRoot,
      txCount: toUint(o.txCount),
      dataHash: o.dataHash,
      proof: o.proof,
      withdrawalsRoot: o.withdrawalsRoot,
    });

  const executeWithdrawalMsg = (
    o: Omit<ExecuteWithdrawalOptions, keyof RollupWriteOptions>,
  ): EncodeObject =>
    rdkMsg.executeWithdrawal({
      submitter: sender,
      rollupId: o.rollupId,
      batchIndex: toUint(o.batchIndex),
      withdrawalIndex: toUint(o.withdrawalIndex),
      recipient: o.recipient,
      denom: o.denom,
      amount: toUint(o.amount),
      proof: o.proof,
    });

  return {
    createRollupMsg,
    submitBatchMsg,
    executeWithdrawalMsg,

    createRollup: (o) => send(createRollupMsg(o), o),
    submitBatch: (o) => send(submitBatchMsg(o), o),
    challengeBatch: (o) =>
      send(
        rdkMsg.challengeBatch({
          challenger: sender,
          rollupId: o.rollupId,
          batchIndex: toUint(o.batchIndex),
          proof: o.proof,
        }),
        o,
      ),
    resolveChallenge: (o) =>
      send(
        rdkMsg.resolveChallenge({
          resolver: sender,
          rollupId: o.rollupId,
          batchIndex: toUint(o.batchIndex),
          fraudUpheld: o.fraudUpheld,
        }),
        o,
      ),
    pause: (o) =>
      send(
        rdkMsg.pauseRollup({
          creator: sender,
          rollupId: o.rollupId,
          reason: o.reason,
        }),
        o,
      ),
    resume: (o) =>
      send(rdkMsg.resumeRollup({ creator: sender, rollupId: o.rollupId }), o),
    stop: (o) =>
      send(rdkMsg.stopRollup({ creator: sender, rollupId: o.rollupId }), o),
    executeWithdrawal: (o) => send(executeWithdrawalMsg(o), o),

    getRollup: (rollupId) => requireQuery(query).rollup({ rollupId }),
    listRollups: () => requireQuery(query).rollups({}),
    getBatch: (rollupId, batchIndex) =>
      requireQuery(query).batch({ rollupId, batchIndex: String(batchIndex) }),
    getLatestBatch: (rollupId) =>
      requireQuery(query).latestBatch({ rollupId }),
    getParams: () => requireQuery(query).params({}),

    getRollupStatus: <T = Record<string, unknown>>(rollupId: string) =>
      requireQor(qor).getRollupStatus<T>(rollupId),
    suggestRollupProfile: <T = Record<string, unknown>>(useCase: string) =>
      requireQor(qor).suggestRollupProfile<T>(useCase),
    getDaBlobStatus: <T = Record<string, unknown>>(
      rollupId: string,
      blobIndex: number,
    ) => requireQor(qor).getDaBlobStatus<T>(rollupId, blobIndex),
  };
}
