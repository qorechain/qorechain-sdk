/**
 * Native-transaction fee estimation for QoreChain.
 *
 * QoreChain exposes an AI-assisted fee oracle at the REST route
 * `/qorechain/ai/v1/fee-estimate?urgency=fast|normal|slow` (see the core
 * `AI_ENGINE.md` / `API_REFERENCE.md`). {@link estimateFee} queries it via the
 * shared {@link RestClient} and shapes the answer as a Cosmos `StdFee`
 * (`{ amount: Coin[]; gas: string }`).
 *
 * The oracle can be unavailable (node still syncing, sidecar down, custom RPC
 * without the AI module). To keep transaction building robust, this falls back
 * to a deterministic static fee computed from a configurable gas price in the
 * base denom — `ceil(gas * gasPrice)` — exactly as a wallet would compute a
 * minimum-gas-price fee. The fallback is transparent and never throws on a
 * missing/erroring endpoint; only a successful response is preferred.
 */

import type { StdFee } from "@cosmjs/amino";
import type { RestClient, FeeUrgency } from "../query/rest";

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
 * Queries the QoreChain AI fee oracle and returns a Cosmos `StdFee`. If the
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
  const gas = gasString(opts.gas);
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
    // Oracle unavailable — fall through to the static fee.
  }

  return staticFee(gas, fallbackGasPrice, denom);
}
