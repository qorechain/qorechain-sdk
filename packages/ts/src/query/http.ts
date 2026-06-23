/**
 * Shared HTTP transport for the read/query clients.
 *
 * Provides two primitives — {@link getJson} for REST GETs and
 * {@link postJsonRpc} for JSON-RPC POSTs — both built on the global `fetch`.
 * `fetch` is injectable so tests can mock the network entirely; nothing here
 * ever performs a real request on its own.
 *
 * Failures surface as a typed {@link QoreHttpError} (non-2xx HTTP responses).
 * Transient transport failures (5xx and network errors) are retried with a
 * small fixed backoff up to a configurable count; 4xx responses are never
 * retried. Each attempt is bounded by an `AbortSignal`-driven timeout.
 */

/** A `fetch`-compatible function. Defaults to `globalThis.fetch`. */
export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

/** A JSON-serializable value usable as a query-string parameter. */
export type QueryValue = string | number | boolean | undefined | null;

/** Options shared by all HTTP helpers. */
export interface HttpOptions {
  /** Injectable `fetch`. Defaults to `globalThis.fetch`. */
  fetch?: FetchLike;
  /** Per-attempt timeout in milliseconds. Defaults to 30000. `0` disables it. */
  timeoutMs?: number;
  /** Number of retries after the initial attempt for retryable errors. Defaults to 2. */
  retries?: number;
  /** Fixed delay between retries in milliseconds. Defaults to 250. */
  retryDelayMs?: number;
  /** Extra request headers, merged over the defaults. */
  headers?: Record<string, string>;
}

/** Options for {@link getJson}, adding query-string parameters. */
export interface GetJsonOptions extends HttpOptions {
  /** Query parameters; `undefined`/`null` values are omitted. */
  query?: Record<string, QueryValue>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 250;

/** Thrown when an HTTP response has a non-2xx status. */
export class QoreHttpError extends Error {
  /** HTTP status code of the failing response. */
  readonly status: number;
  /** The URL that was requested. */
  readonly url: string;
  /** Raw response body text, when available. */
  readonly body?: string;

  constructor(status: number, url: string, body?: string) {
    super(`HTTP ${status} for ${url}`);
    this.name = "QoreHttpError";
    this.status = status;
    this.url = url;
    this.body = body;
    Object.setPrototypeOf(this, QoreHttpError.prototype);
  }
}

function resolveFetch(opts?: HttpOptions): FetchLike {
  const f = opts?.fetch ?? (globalThis.fetch as FetchLike | undefined);
  if (!f) {
    throw new Error(
      "no fetch implementation available — pass `fetch` in the client options",
    );
  }
  return f;
}

/** Append query params to a URL, skipping `undefined`/`null` values. */
export function buildUrl(base: string, query?: Record<string, QueryValue>): string {
  if (!query) return base;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  if (parts.length === 0) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${parts.join("&")}`;
}

/** Join a base URL and a path without producing double slashes. */
export function joinUrl(base: string, path: string): string {
  const left = base.replace(/\/+$/, "");
  const right = path.replace(/^\/+/, "");
  return `${left}/${right}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 5xx responses are retryable; 4xx are not. */
function isRetryableStatus(status: number): boolean {
  return status >= 500 && status < 600;
}

/**
 * Run one `fetch` attempt with an abort-driven timeout, parsing the JSON body
 * on success and throwing {@link QoreHttpError} on a non-2xx response.
 */
async function attempt<T>(
  url: string,
  init: RequestInit,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<T> {
  const controller = timeoutMs > 0 ? new AbortController() : undefined;
  const timer =
    controller && timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;
  try {
    const res = await fetchImpl(url, {
      ...init,
      signal: controller?.signal,
    });
    if (!res.ok) {
      let body: string | undefined;
      try {
        body = await res.text();
      } catch {
        body = undefined;
      }
      throw new QoreHttpError(res.status, url, body);
    }
    return (await res.json()) as T;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Execute `attempt` with retry on retryable HTTP/transport errors. */
async function withRetry<T>(
  url: string,
  init: RequestInit,
  opts: HttpOptions | undefined,
): Promise<T> {
  const fetchImpl = resolveFetch(opts);
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = opts?.retries ?? DEFAULT_RETRIES;
  const retryDelayMs = opts?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  let lastError: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await attempt<T>(url, init, fetchImpl, timeoutMs);
    } catch (err) {
      lastError = err;
      const retryable =
        err instanceof QoreHttpError ? isRetryableStatus(err.status) : true;
      if (!retryable || i === retries) throw err;
      if (retryDelayMs > 0) await delay(retryDelayMs);
    }
  }
  throw lastError;
}

/**
 * Perform a GET request and parse the JSON response.
 *
 * @param url - Fully-qualified URL (without query string).
 * @param opts - Query params, injectable `fetch`, timeout, and retry settings.
 * @throws {@link QoreHttpError} on a non-2xx response.
 */
export function getJson<T>(url: string, opts?: GetJsonOptions): Promise<T> {
  const fullUrl = buildUrl(url, opts?.query);
  const init: RequestInit = {
    method: "GET",
    headers: { accept: "application/json", ...(opts?.headers ?? {}) },
  };
  return withRetry<T>(fullUrl, init, opts);
}

/**
 * POST a JSON-RPC body and parse the JSON response.
 *
 * This handles only the HTTP layer; JSON-RPC error envelopes are interpreted by
 * the {@link JsonRpcClient}.
 *
 * @throws {@link QoreHttpError} on a non-2xx response.
 */
export function postJsonRpc<T>(
  url: string,
  body: unknown,
  opts?: HttpOptions,
): Promise<T> {
  const init: RequestInit = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...(opts?.headers ?? {}),
    },
    body: JSON.stringify(body),
  };
  return withRetry<T>(url, init, opts);
}
