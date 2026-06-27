/**
 * High-level developer-experience helpers.
 *
 * These wrap the typed message composers and query clients into ergonomic,
 * strongly-typed clients so an app developer can build sidechains, paychains, and
 * rollups without reading chain source or hand-building protobuf `Any` payloads:
 *
 *  - {@link createMultilayerClient} — register sidechains/paychains, anchor state,
 *    route transactions, and read layers + routing stats.
 *  - {@link createRollupClient} — create rollups, submit batches, run the
 *    challenge game, manage lifecycle, execute withdrawals, and read rollup/batch
 *    state (plus the `qor_*` conveniences).
 */

export {
  createMultilayerClient,
  type MultilayerClient,
  type CreateMultilayerClientOptions,
  type MultilayerWriteOptions,
  type RegisterSidechainOptions,
  type RegisterPaychainOptions,
  type AnchorStateOptions,
  type RouteTransactionOptions,
} from "./multilayer";

export {
  createRollupClient,
  type RollupClient,
  type CreateRollupClientOptions,
  type RollupWriteOptions,
  type CreateRollupOptions,
  type SubmitBatchOptions,
  type ChallengeBatchOptions,
  type ResolveChallengeOptions,
  type RollupLifecycleOptions,
  type ExecuteWithdrawalOptions,
} from "./rollup";
