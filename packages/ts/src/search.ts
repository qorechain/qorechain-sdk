/**
 * Block and transaction lookup/search over the Cosmos REST (LCD) endpoints.
 *
 * Wraps the standard `/cosmos/tx/v1beta1` and `/cosmos/base/tendermint/v1beta1`
 * routes: fetch a single transaction by hash, fetch a block by height (or the
 * latest), and search transactions by an events query. A small query builder
 * turns an attribute map (e.g. `{ "message.sender": addr }`) into the
 * `events=...` parameter the REST API expects.
 *
 * Responses are typed loosely (the gateway JSON is large and version-sensitive)
 * via a caller-supplied generic; the shapes here cover the common fields.
 */

import type { RestClient } from "./query/rest";
import type { QueryValue } from "./query/http";

/** A transaction-response envelope from `/cosmos/tx/v1beta1/txs/{hash}`. */
export interface GetTxResponse {
  tx?: unknown;
  tx_response?: {
    txhash: string;
    height: string;
    code: number;
    codespace?: string;
    raw_log?: string;
    gas_used?: string;
    gas_wanted?: string;
    [k: string]: unknown;
  };
}

/** A block-response envelope from the consensus REST block routes. */
export interface GetBlockResponse {
  block_id?: unknown;
  block?: {
    header?: { height?: string; time?: string; chain_id?: string };
    data?: { txs?: string[] };
    [k: string]: unknown;
  };
}

/** A paginated tx-search response from `/cosmos/tx/v1beta1/txs`. */
export interface SearchTxsResponse {
  txs?: unknown[];
  tx_responses?: GetTxResponse["tx_response"][];
  total?: string;
  pagination?: { next_key: string | null; total?: string };
}

/** Ordering for tx search. */
export type TxOrderBy = "asc" | "desc";

/** Options for {@link searchTxs}. */
export interface SearchTxsOptions {
  /** 1-based page number. */
  page?: number;
  /** Page size. */
  limit?: number;
  /** Result ordering by block height. Defaults to the node default. */
  orderBy?: TxOrderBy;
}

/** Attribute filters for {@link buildEventsQuery}, e.g. `{ "message.sender": addr }`. */
export type EventFilters = Record<string, string | number>;

/**
 * Build the `events` query value for the REST tx-search endpoint.
 *
 * Each `key=value` pair is rendered as `key='value'` (numbers unquoted) and
 * joined with `&` — the format `/cosmos/tx/v1beta1/txs?events=...` expects.
 *
 * @example buildEventsQuery({ "message.sender": "qor1..." })
 *   // => "message.sender='qor1...'"
 */
export function buildEventsQuery(filters: EventFilters): string {
  return Object.entries(filters)
    .map(([key, value]) =>
      typeof value === "number" ? `${key}=${value}` : `${key}='${value}'`,
    )
    .join("&");
}

/** Map a REST `order_by` enum value from the friendly {@link TxOrderBy}. */
function orderByParam(orderBy?: TxOrderBy): QueryValue {
  if (orderBy === "asc") return "ORDER_BY_ASC";
  if (orderBy === "desc") return "ORDER_BY_DESC";
  return undefined;
}

/** Fetch a single transaction by its (hex) hash. */
export function getTx(rest: RestClient, hash: string): Promise<GetTxResponse> {
  return rest.get<GetTxResponse>(
    `/cosmos/tx/v1beta1/txs/${encodeURIComponent(hash)}`,
  );
}

/** Fetch a block by height (`/cosmos/base/tendermint/v1beta1/blocks/{height}`). */
export function getBlock(
  rest: RestClient,
  height: number | string,
): Promise<GetBlockResponse> {
  return rest.get<GetBlockResponse>(
    `/cosmos/base/tendermint/v1beta1/blocks/${encodeURIComponent(String(height))}`,
  );
}

/** Fetch the latest block (`/cosmos/base/tendermint/v1beta1/blocks/latest`). */
export function getLatestBlock(rest: RestClient): Promise<GetBlockResponse> {
  return rest.get<GetBlockResponse>(
    "/cosmos/base/tendermint/v1beta1/blocks/latest",
  );
}

/**
 * Search transactions by an events query.
 *
 * @param rest - A {@link RestClient}.
 * @param query - An `events` query string (see {@link buildEventsQuery}) or an
 *   attribute-filter object passed through {@link buildEventsQuery}.
 * @param opts - Page, limit, and ordering.
 */
export function searchTxs(
  rest: RestClient,
  query: string | EventFilters,
  opts: SearchTxsOptions = {},
): Promise<SearchTxsResponse> {
  const events = typeof query === "string" ? query : buildEventsQuery(query);
  const params: Record<string, QueryValue> = {
    events,
    "pagination.limit": opts.limit,
    order_by: orderByParam(opts.orderBy),
  };
  if (opts.page !== undefined) {
    params["page"] = opts.page;
  }
  return rest.get<SearchTxsResponse>("/cosmos/tx/v1beta1/txs", params);
}
