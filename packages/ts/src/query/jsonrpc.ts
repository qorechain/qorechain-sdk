/**
 * Generic JSON-RPC 2.0 client.
 *
 * Manages request ids (auto-incrementing per client), serializes the standard
 * `{ jsonrpc, id, method, params }` envelope, and maps JSON-RPC error responses
 * to a typed {@link JsonRpcError}. It is the transport base for both the EVM
 * `eth_*`/`net_*`/`web3_*` methods and the QoreChain `qor_*` namespace.
 *
 * The underlying `fetch` is injectable via {@link HttpOptions} so callers and
 * tests can supply their own transport.
 */

import { postJsonRpc, type HttpOptions } from "./http";

/** A JSON-RPC 2.0 error object. */
export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

/** A JSON-RPC 2.0 response envelope. */
export interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: T;
  error?: JsonRpcErrorObject;
}

/** Thrown when a JSON-RPC response carries an `error` member. */
export class JsonRpcError extends Error {
  /** JSON-RPC error code. */
  readonly code: number;
  /** Optional implementation-defined error data. */
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "JsonRpcError";
    this.code = code;
    this.data = data;
    Object.setPrototypeOf(this, JsonRpcError.prototype);
  }
}

/** Options for {@link JsonRpcClient}. */
export type JsonRpcClientOptions = HttpOptions;

/** A minimal JSON-RPC 2.0 client over HTTP POST. */
export class JsonRpcClient {
  protected readonly url: string;
  protected readonly opts: JsonRpcClientOptions;
  private nextId = 1;

  constructor(url: string, opts: JsonRpcClientOptions = {}) {
    this.url = url;
    this.opts = opts;
  }

  /**
   * Invoke a JSON-RPC method and return its `result`.
   *
   * @param method - Wire method name (e.g. `"eth_chainId"`).
   * @param params - Positional params; defaults to an empty array.
   * @throws {@link JsonRpcError} when the response contains an `error`.
   * @throws {@link QoreHttpError} on a non-2xx transport response.
   */
  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const id = this.nextId++;
    const body = { jsonrpc: "2.0", id, method, params };
    const res = await postJsonRpc<JsonRpcResponse<T>>(this.url, body, this.opts);
    if (res.error) {
      throw new JsonRpcError(res.error.code, res.error.message, res.error.data);
    }
    return res.result as T;
  }

  /** `eth_chainId` — the chain id as a hex quantity string. */
  ethChainId(): Promise<string> {
    return this.call<string>("eth_chainId", []);
  }

  /** `eth_blockNumber` — the latest block height as a hex quantity string. */
  ethBlockNumber(): Promise<string> {
    return this.call<string>("eth_blockNumber", []);
  }

  /** `eth_getBalance` — wei balance of `address` as a hex quantity string. */
  ethGetBalance(address: string, block: string = "latest"): Promise<string> {
    return this.call<string>("eth_getBalance", [address, block]);
  }

  /** `net_version` — the network id as a decimal string. */
  netVersion(): Promise<string> {
    return this.call<string>("net_version", []);
  }

  /** `web3_clientVersion` — the node client version string. */
  web3ClientVersion(): Promise<string> {
    return this.call<string>("web3_clientVersion", []);
  }
}
