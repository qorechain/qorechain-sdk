/**
 * REST (LCD) read client for QoreChain.
 *
 * Wraps the standard Native bank endpoints plus QoreChain's custom module
 * read routes under `/qorechain/<module>/v1/...`. All requests go through the
 * shared {@link getJson} helper, so `fetch` is injectable and failures surface
 * as {@link QoreHttpError}.
 *
 * Response shapes are modeled only where they are simple and stable (e.g. bank
 * balances); richer module responses are returned as a caller-supplied generic
 * defaulting to {@link Record}<string, unknown> rather than over-modeled here.
 */

import type { Coin } from "@cosmjs/amino";
import {
  getJson,
  joinUrl,
  type FetchLike,
  type HttpOptions,
  type QueryValue,
} from "./http";

/**
 * A Native coin amount. Re-exported from `@cosmjs/amino` so the SDK has a single
 * canonical `Coin` type shared across query, fee, and tx code (no duplicated
 * structural definition).
 */
export type { Coin };

/** Native pagination response metadata. */
export interface PageResponse {
  next_key: string | null;
  total?: string;
}

/** Response of the all-balances endpoint. */
export interface AllBalancesResponse {
  balances: Coin[];
  pagination?: PageResponse;
}

/** Response of the single-denom balance endpoint. */
export interface BalanceResponse {
  balance: Coin;
}

/** Native key/limit pagination input. */
export interface Pagination {
  key?: string;
  limit?: number;
}

/** Options accepted by paginated list endpoints. */
export interface PaginatedOptions {
  pagination?: Pagination;
}

/** Options for {@link RestClient}. */
export type RestClientOptions = HttpOptions;

/** Relative urgency of a fee estimate. */
export type FeeUrgency = "fast" | "normal" | "slow";

/**
 * REST shape of `GET /qorechain/abstractaccount/v1/permission_schema` — the
 * canonical authenticator permission taxonomy (v3.1.85). `schema_version` bumps
 * whenever the taxonomy or the mapping changes, so clients compare it to their
 * embedded copy to detect drift.
 */
export interface PermissionSchemaResponse {
  /** Version tag that bumps on any taxonomy/mapping change. */
  schema_version: string;
  /** Every valid permission string (e.g. `send`, `evm`, `svm`, `all`). */
  permissions: string[];
  /** Maps a message typeURL to the permission it requires. */
  msg_permissions: Record<string, string>;
  /** TypeURLs that are NEVER delegable to a linked authenticator key. */
  key_management_msgs: string[];
}

/** REST shape of an abstract-account view (subset of `AccountView`). */
export interface AbstractAccountView {
  address: string;
  contract_address?: string;
  account_type?: string;
  spending_rules_count?: number;
  session_keys_count?: number;
  created_at?: string;
  owner?: string;
}

/** REST shape of the abstractaccount module config view. */
export interface AbstractAccountConfigView {
  enabled: boolean;
  max_session_keys?: number;
  max_spending_rules?: number;
  default_session_ttl?: string;
}

/** Map a {@link Pagination} into Native `pagination.*` query params. */
function paginationQuery(p?: Pagination): Record<string, QueryValue> {
  const q: Record<string, QueryValue> = {};
  if (p?.key !== undefined) q["pagination.key"] = p.key;
  if (p?.limit !== undefined) q["pagination.limit"] = p.limit;
  return q;
}

/** Native + QoreChain REST read client. */
export class RestClient {
  private readonly baseUrl: string;
  private readonly opts: RestClientOptions;

  /**
   * @param baseUrl - The network's REST endpoint (e.g. `endpoints.rest`).
   * @param opts - Injectable `fetch`, timeout, and retry settings.
   */
  constructor(baseUrl: string, opts: RestClientOptions = {}) {
    this.baseUrl = baseUrl;
    this.opts = opts;
  }

  /** Injectable fetch passthrough so the escape hatch reuses the same transport. */
  private get fetchImpl(): FetchLike | undefined {
    return this.opts.fetch;
  }

  /**
   * Generic GET escape hatch for any documented REST route.
   *
   * @param path - Path beginning with `/` (e.g. `/qorechain/foo/v1/bar`).
   *   Embedded path params must be URL-encoded by the caller.
   * @param query - Optional query parameters.
   */
  get<T = Record<string, unknown>>(
    path: string,
    query?: Record<string, QueryValue>,
  ): Promise<T> {
    return getJson<T>(joinUrl(this.baseUrl, path), {
      ...this.opts,
      query,
    });
  }

  // --- Standard Native bank ------------------------------------------------

  /** All balances of `address` (`/cosmos/bank/v1beta1/balances/{address}`). */
  getAllBalances(
    address: string,
    opts?: PaginatedOptions,
  ): Promise<AllBalancesResponse> {
    return this.get<AllBalancesResponse>(
      `/cosmos/bank/v1beta1/balances/${encodeURIComponent(address)}`,
      paginationQuery(opts?.pagination),
    );
  }

  /** Balance of `address` in `denom` (`.../balances/{address}/by_denom`). */
  getBalance(address: string, denom: string): Promise<BalanceResponse> {
    return this.get<BalanceResponse>(
      `/cosmos/bank/v1beta1/balances/${encodeURIComponent(address)}/by_denom`,
      { denom },
    );
  }

  // --- Custom QoreChain module reads ---------------------------------------

  /** QCAI fee/network stats (`/qorechain/ai/v1/stats`). */
  getAiStats<T = Record<string, unknown>>(): Promise<T> {
    return this.get<T>("/qorechain/ai/v1/stats");
  }

  /** QCAI fee estimate for an urgency level (`/qorechain/ai/v1/fee-estimate`). */
  getFeeEstimate<T = Record<string, unknown>>(urgency: FeeUrgency): Promise<T> {
    return this.get<T>("/qorechain/ai/v1/fee-estimate", { urgency });
  }

  /** Supported bridge chains (`/qorechain/bridge/v1/chains`). */
  getBridgeChains<T = Record<string, unknown>>(): Promise<T> {
    return this.get<T>("/qorechain/bridge/v1/chains");
  }

  /** PQC account record (`/qorechain/pqc/v1/accounts/{address}`). */
  getPqcAccount<T = Record<string, unknown>>(address: string): Promise<T> {
    return this.get<T>(`/qorechain/pqc/v1/accounts/${encodeURIComponent(address)}`);
  }

  /** Validator reputation (`/qorechain/reputation/v1/validators/{address}`). */
  getReputation<T = Record<string, unknown>>(
    validatorAddress: string,
  ): Promise<T> {
    return this.get<T>(
      `/qorechain/reputation/v1/validators/${encodeURIComponent(validatorAddress)}`,
    );
  }

  /** Token burn statistics (`/qorechain/burn/v1/stats`). */
  getBurnStats<T = Record<string, unknown>>(): Promise<T> {
    return this.get<T>("/qorechain/burn/v1/stats");
  }

  /** xQORE staking position (`/qorechain/xqore/v1/position/{address}`). */
  getXqorePosition<T = Record<string, unknown>>(address: string): Promise<T> {
    return this.get<T>(`/qorechain/xqore/v1/position/${encodeURIComponent(address)}`);
  }

  /** Current inflation rate (`/qorechain/inflation/v1/rate`). */
  getInflationRate<T = Record<string, unknown>>(): Promise<T> {
    return this.get<T>("/qorechain/inflation/v1/rate");
  }

  // --- Abstract-account authenticator lanes (v3.1.85) ----------------------

  /**
   * The canonical authenticator permission taxonomy
   * (`/qorechain/abstractaccount/v1/permission_schema`): the valid permission
   * strings, the message-typeURL→permission mapping, the never-delegable
   * key-management typeURLs, and a `schema_version` for drift detection.
   */
  getPermissionSchema(): Promise<PermissionSchemaResponse> {
    return this.get<PermissionSchemaResponse>(
      "/qorechain/abstractaccount/v1/permission_schema",
    );
  }

  /** Abstract-account module config (`/qorechain/abstractaccount/v1/config`). */
  getAbstractAccountConfig<T = { config: AbstractAccountConfigView }>(): Promise<T> {
    return this.get<T>("/qorechain/abstractaccount/v1/config");
  }

  /** All abstract accounts (`/qorechain/abstractaccount/v1/accounts`). */
  getAbstractAccounts<T = { accounts: AbstractAccountView[] }>(): Promise<T> {
    return this.get<T>("/qorechain/abstractaccount/v1/accounts");
  }

  /**
   * A single abstract account by address
   * (`/qorechain/abstractaccount/v1/accounts/{address}`).
   */
  getAbstractAccount<T = { account: AbstractAccountView }>(
    address: string,
  ): Promise<T> {
    return this.get<T>(
      `/qorechain/abstractaccount/v1/accounts/${encodeURIComponent(address)}`,
    );
  }
}
