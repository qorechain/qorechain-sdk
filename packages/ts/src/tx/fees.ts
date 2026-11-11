/**
 * Native-transaction fee estimation for QoreChain.
 *
 * QoreChain exposes an AI-assisted fee oracle at the REST route
 * `/qorechain/ai/v1/fee-estimate?urgency=fast|normal|slow` (see the core
 * `AI_ENGINE.md` / `API_REFERENCE.md`). {@link estimateFee} queries it via the
 * shared {@link RestClient} and shapes the answer as a Native `StdFee`
 * (`{ amount: Coin[]; gas: string }`).
 *
 * The oracle can be unavailable (node still syncing, sidecar down, custom RPC
 * without the AI module). To keep transaction building robust, this falls back
 * to a deterministic static fee computed from a configurable gas price in the
 * base denom - `ceil(gas * gasPrice)` - exactly as a wallet would compute a
 * minimum-gas-price fee. The fallback is transparent and never throws on a
 * missing/erroring endpoint; only a successful response is preferred.
 */

import type { StdFee } from "@cosmjs/amino";
import type { RestClient, FeeUrgency } from "../query/rest";
import type { FetchLike } from "../query/http";

/**
 * Re-export cosmjs's canonical `StdFee` so the SDK shares one fee type with what
 * `SigningStargateClient.signAndBroadcast` expects. This is the cosmjs shape
 * (`{ amount: readonly Coin[]; gas: string; granter?; payer? }`), so feegrant
 * `granter`/`payer` are supported.
 */
export type { StdFee };

/**
 * Default static-fallback parameters, used when the AI fee oracle is
 * unavailable. The gas price (`uqor` per unit of gas) sits above the chain's
 * genesis min-gas-price (BaseFee) of `0.1uqor` per unit of gas, which is
 * enforced on both networks.
 */
export const STATIC_FALLBACK = {
  /** Fallback gas price, in base denom per unit of gas. */
  gasPrice: "0.15",
  /** Base denomination fees are paid in. */
  denom: "uqor",
  /** Default gas limit when the caller does not supply one. */
  gas: "200000",
} as const;

/** Options for {@link estimateFee}. */
export interface EstimateFeeOptions {
  /** Relative urgency tier passed to the oracle. Defaults to `"normal"`. */
  urgency?: FeeUrgency;
  /**
   * Gas limit to request, as a number or decimal string. Defaults to
   * {@link STATIC_FALLBACK.gas}. The oracle only suggests a *fee amount*; the
   * gas limit is chosen by the caller (or via {@link TxClient.simulate}).
   */
  gas?: number | string;
  /**
   * Static-fallback gas price (base denom per gas unit) used only when the
   * oracle is unavailable. Defaults to {@link STATIC_FALLBACK.gasPrice}.
   */
  fallbackGasPrice?: string;
  /** Base denomination for the fee. Defaults to {@link STATIC_FALLBACK.denom}. */
  denom?: string;
  /**
   * The messages the fee is for. When they carry a CosmWasm execute /
   * instantiate / migrate or a `MsgCrossVMCall` and no `gas` is given, the
   * fixed {@link STATIC_FALLBACK.gas} is refused (see {@link carriesWasmExecution}).
   */
  messages?: ReadonlyArray<{ typeUrl: string }>;
}

/**
 * Shape of the AI fee-estimate REST response.
 *
 * Mirrors the core `FeeEstimateResponse` proto (gateway JSON): `suggested_fee_uqor`
 * is a `uint64`, which proto3 JSON encodes as a string, but tolerate a number too.
 */
interface FeeEstimateResponse {
  suggested_fee_uqor?: string | number;
  estimated_blocks?: number;
  current_congestion?: number;
  predicted_congestion?: number;
  confidence?: number;
}

/** Normalize a `number | string` gas value to a decimal string. */
function gasString(gas: number | string | undefined): string {
  if (gas === undefined) return STATIC_FALLBACK.gas;
  return typeof gas === "number" ? Math.ceil(gas).toString() : gas;
}

/**
 * Compute a static fee as `ceil(gas * gasPrice)` in `denom`.
 *
 * Uses BigInt math on a scaled integer to avoid floating-point drift on the
 * fee amount; the gas price is parsed to a fixed number of decimal places.
 */
function staticFee(gas: string, gasPrice: string, denom: string): StdFee {
  const gasUnits = BigInt(gas);
  // Parse "0.025" into (numerator=25, scale=1000) so amount = gas*num/scale.
  const [intPart, fracPart = ""] = gasPrice.split(".");
  const scale = 10n ** BigInt(fracPart.length);
  const numerator = BigInt(intPart || "0") * scale + BigInt(fracPart || "0");
  // ceil division: (gas*numerator + scale - 1) / scale
  const raw = gasUnits * numerator;
  const amount = (raw + scale - 1n) / scale;
  return { amount: [{ denom, amount: amount.toString() }], gas };
}

/**
 * Estimate a transaction fee for the given urgency.
 *
 * Queries the QoreChain AI fee oracle and returns a Native `StdFee`. If the
 * oracle is unavailable or returns no usable fee, falls back to a deterministic
 * static fee computed from {@link EstimateFeeOptions.fallbackGasPrice}.
 *
 * @param rest - A {@link RestClient} bound to the network's REST endpoint.
 * @param opts - Urgency, gas limit, and static-fallback parameters.
 */
export async function estimateFee(
  rest: RestClient,
  opts: EstimateFeeOptions = {},
): Promise<StdFee> {
  const urgency: FeeUrgency = opts.urgency ?? "normal";
  if (opts.gas === undefined && opts.messages && carriesWasmExecution(opts.messages)) {
    throw new Error(WASM_FIXED_GAS_REFUSAL);
  }
  const gas = gasString(opts.gas);
  checkCosmosGasLimit(gas);
  const denom = opts.denom ?? STATIC_FALLBACK.denom;
  const fallbackGasPrice = opts.fallbackGasPrice ?? STATIC_FALLBACK.gasPrice;

  try {
    const res = await rest.getFeeEstimate<FeeEstimateResponse>(urgency);
    const suggested = res?.suggested_fee_uqor;
    if (suggested !== undefined && suggested !== null) {
      const amount =
        typeof suggested === "number"
          ? Math.ceil(suggested).toString()
          : suggested;
      // Treat a zero/empty suggestion as "no answer" and fall through.
      if (amount !== "" && amount !== "0") {
        return { amount: [{ denom, amount }], gas };
      }
    }
  } catch {
    // Oracle unavailable - fall through to the static fee.
  }

  return staticFee(gas, fallbackGasPrice, denom);
}

// ---- gas caps and wasm gas (chain v3.2.8) -------------------------------

/** Most gas one Cosmos-lane transaction may declare (chain v3.2.8 default). */
export const COSMOS_TX_MAX_GAS = 50_000_000;
/** Most gas one EVM transaction may ask for on chain v3.2.8, when not queried ({@link fetchEvmLimits}). */
export const EVM_TX_MAX_GAS_DEFAULT = 30_000_000;
/** Smallest multiplier applied to the simulated gas of a tx that runs CosmWasm or cross-VM code. */
export const WASM_GAS_MULTIPLIER_MIN = 1.3;

/** Messages whose gas depends on whether the contract code already ran in the block. */
export const WASM_EXECUTION_TYPE_URLS: ReadonlySet<string> = new Set([
  "/cosmwasm.wasm.v1.MsgExecuteContract",
  "/cosmwasm.wasm.v1.MsgInstantiateContract",
  "/cosmwasm.wasm.v1.MsgInstantiateContract2",
  "/cosmwasm.wasm.v1.MsgMigrateContract",
  "/qorechain.crossvm.v1.MsgCrossVMCall",
]);

const WASM_FIXED_GAS_REFUSAL =
  "this transaction runs CosmWasm or cross-VM code, whose first call of a contract code in a block costs much " +
  'more than later ones (a cw20 transfer about 533k gas, repeats about 84k): use fee "auto" (simulation) or ' +
  "pass an explicit gas limit instead of the fixed fallback gas";

/**
 * Whether a transaction carries a CosmWasm execute / instantiate / migrate or a
 * `MsgCrossVMCall`. Such a transaction is never given a fixed fallback gas,
 * and its simulated gas gets at least {@link WASM_GAS_MULTIPLIER_MIN}.
 */
export function carriesWasmExecution(messages: ReadonlyArray<{ typeUrl: string }>): boolean {
  return messages.some((m) => WASM_EXECUTION_TYPE_URLS.has(m.typeUrl));
}

/** Throw when a Cosmos-lane gas limit is above {@link COSMOS_TX_MAX_GAS}. */
export function checkCosmosGasLimit(gas: number | string | bigint): void {
  const g = BigInt(typeof gas === "number" ? Math.ceil(gas) : gas);
  if (g > BigInt(COSMOS_TX_MAX_GAS)) {
    throw new Error(`gas limit ${g} is above the chain's Cosmos transaction cap of ${COSMOS_TX_MAX_GAS} (chain v3.2.8); the transaction would be refused`);
  }
}

/**
 * Throw when an EVM gas limit is above the chain's EVM cap (`cap`, from
 * {@link fetchEvmLimits}; {@link EVM_TX_MAX_GAS_DEFAULT} when not given).
 */
export function checkEvmGasLimit(gas: number | string | bigint, cap: number | bigint = EVM_TX_MAX_GAS_DEFAULT): void {
  const g = BigInt(typeof gas === "number" ? Math.ceil(gas) : gas);
  if (g > BigInt(cap)) {
    throw new Error(`EVM gas limit ${g} is above the chain's EVM transaction cap of ${cap} (chain v3.2.8); the transaction would be refused`);
  }
}

/** The EVM execution limits in force. */
export interface EvmLimits {
  /** Most gas one EVM transaction may ask for. */
  txMaxGas: bigint;
  /** Largest input a guarded stateful precompile accepts, in bytes. */
  precompileInputMaxBytes: bigint;
}

/**
 * Read the EVM execution limits in force (`GET /qorechain/pqc/v1/evm_limits`,
 * chain v3.2.8): the top-level `tx_max_gas` / `precompile_input_max_bytes`,
 * falling back to the governance-set `limits` object and then to
 * {@link EVM_TX_MAX_GAS_DEFAULT} for the gas cap.
 */
export async function fetchEvmLimits(opts: { rest: string; fetch?: FetchLike }): Promise<EvmLimits> {
  const f = opts.fetch ?? (globalThis.fetch as FetchLike);
  const url = `${opts.rest.replace(/\/+$/, "")}/qorechain/pqc/v1/evm_limits`;
  const res = await f(url);
  if (!res.ok) throw new Error(`evm limits query failed: HTTP ${res.status} from ${url}`);
  const body = (await res.json()) as Record<string, unknown>;
  const limits = (body.limits ?? {}) as Record<string, unknown>;
  const read = (snake: string, camel: string): bigint => {
    for (const v of [body[snake], body[camel], limits[snake], limits[camel]]) {
      if (v !== undefined && v !== null && v !== "" && BigInt(v as string) > 0n) return BigInt(v as string);
    }
    return 0n;
  };
  const txMaxGas = read("tx_max_gas", "txMaxGas");
  return {
    txMaxGas: txMaxGas > 0n ? txMaxGas : BigInt(EVM_TX_MAX_GAS_DEFAULT),
    precompileInputMaxBytes: read("precompile_input_max_bytes", "precompileInputMaxBytes"),
  };
}

// ---- minimum gas price (opt-in) -----------------------------------------

/** Fixed-point scale (decimal places) of the min-gas-price arithmetic. */
const PRICE_SCALE = 30;

/** Parse a non-negative decimal string exactly into an integer at {@link PRICE_SCALE}, shifted `shift` places right. */
function decToScaled(dec: string, shift = 0): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(dec.trim());
  if (!m) throw new Error(`invalid decimal ${JSON.stringify(dec)}`);
  const frac = m[2] ?? "";
  const digits = BigInt(m[1] + frac);
  const exp = PRICE_SCALE - frac.length - shift;
  return exp >= 0 ? digits * 10n ** BigInt(exp) : digits / 10n ** BigInt(-exp);
}

/** Render an integer at {@link PRICE_SCALE} as a trimmed decimal string. */
function scaledToDec(n: bigint): string {
  const s = n.toString().padStart(PRICE_SCALE + 1, "0");
  const int = s.slice(0, s.length - PRICE_SCALE);
  const frac = s.slice(s.length - PRICE_SCALE).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

/** The chain's floor on the gas price, in uqor per gas. */
export const MIN_GAS_PRICE_FLOOR_UQOR = "0.1";

/**
 * The minimum gas price the chain enforces, in uqor per gas, as an exact
 * decimal string: `max(min_gas_price / 1e12, 0.1)`, where `min_gas_price` is
 * the feemarket minimum (`GET /cosmos/evm/feemarket/v1/params`,
 * `params.min_gas_price`, in the 18-decimal EVM unit). Opt-in: nothing in the
 * SDK calls this by default ({@link DEFAULT_GAS_PRICE} stays `0.15uqor`).
 */
export async function fetchMinGasPriceUqor(opts: { rest: string; fetch?: FetchLike }): Promise<string> {
  const f = opts.fetch ?? (globalThis.fetch as FetchLike);
  const url = `${opts.rest.replace(/\/+$/, "")}/cosmos/evm/feemarket/v1/params`;
  const res = await f(url);
  if (!res.ok) throw new Error(`feemarket params query failed: HTTP ${res.status} from ${url}`);
  const body = (await res.json()) as { params?: { min_gas_price?: unknown; minGasPrice?: unknown } };
  const raw = body?.params?.min_gas_price ?? body?.params?.minGasPrice;
  if (typeof raw !== "string" && typeof raw !== "number") {
    throw new Error(`feemarket params from ${url} carry no params.min_gas_price`);
  }
  const value = decToScaled(String(raw), 12);
  const floor = decToScaled(MIN_GAS_PRICE_FLOOR_UQOR);
  return scaledToDec(value > floor ? value : floor);
}

/**
 * A gas price with headroom over the chain minimum, in uqor per gas, as an
 * exact decimal string: `max(0.15, fetchMinGasPriceUqor() x margin)`. Use it
 * as `autoFee.gasPrice` (append `"uqor"`) if you want the fee to follow a
 * minimum governance may move. Opt-in, one REST call.
 */
export async function recommendedGasPriceUqor(opts: {
  rest: string;
  fetch?: FetchLike;
  /** Multiplier over the minimum. Default 1.5. */
  margin?: number | string;
}): Promise<string> {
  const min = decToScaled(await fetchMinGasPriceUqor(opts));
  const marginStr = String(opts.margin ?? 1.5);
  if (!/^\d+(\.\d+)?$/.test(marginStr)) throw new Error(`margin must be a non-negative decimal, got ${marginStr}`);
  const margin = decToScaled(marginStr);
  const product = (min * margin) / 10n ** BigInt(PRICE_SCALE);
  const base = decToScaled(STATIC_FALLBACK.gasPrice);
  return scaledToDec(product > base ? product : base);
}
