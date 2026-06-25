/**
 * Human-readable decoding of EVM execution errors.
 *
 * viem throws richly-typed error objects, but the useful detail (a revert
 * reason, a custom-error name and args, or a low-level RPC message) is often
 * buried several layers deep in the error's `cause` chain. {@link decodeEvmError}
 * walks that chain with viem's `BaseError.walk`, decodes custom-error revert
 * data against an optional ABI via `decodeErrorResult`, and returns a flat,
 * readable summary.
 */

import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  type Abi,
  type Hex,
} from "viem";

/** A decoded EVM error. */
export interface DecodedEvmError {
  /** A readable summary message. */
  message: string;
  /** A short, stable kind discriminator. */
  kind:
    | "revert"
    | "custom_error"
    | "panic"
    | "rpc"
    | "execution"
    | "unknown";
  /** The custom-error or revert function name, when decoded. */
  errorName?: string;
  /** Decoded custom-error arguments, when available. */
  args?: readonly unknown[];
  /** The raw revert data, when present. */
  data?: Hex;
}

/** Extract a `0x`-prefixed revert data blob from common viem error shapes. */
function extractRevertData(err: unknown): Hex | undefined {
  const e = err as { data?: unknown; cause?: { data?: unknown } };
  const d = e?.data ?? e?.cause?.data;
  if (typeof d === "string" && d.startsWith("0x")) return d as Hex;
  if (d && typeof d === "object" && "data" in (d as object)) {
    const inner = (d as { data?: unknown }).data;
    if (typeof inner === "string" && inner.startsWith("0x")) return inner as Hex;
  }
  return undefined;
}

/**
 * Decode an EVM error thrown by viem into a readable, structured form.
 *
 * @param error - The thrown error (a viem `BaseError`, an RPC error, or any value).
 * @param abi - Optional contract ABI used to decode custom-error revert data.
 * @returns A {@link DecodedEvmError}.
 */
export function decodeEvmError(error: unknown, abi?: Abi): DecodedEvmError {
  if (error instanceof BaseError) {
    // Prefer a contract-level revert: it carries the reason or custom error.
    const revert = error.walk(
      (e) => e instanceof ContractFunctionRevertedError,
    ) as ContractFunctionRevertedError | null;

    if (revert instanceof ContractFunctionRevertedError) {
      const data = revert.data;
      if (data?.errorName === "Error") {
        const reason = (data.args?.[0] as string) ?? revert.reason ?? "reverted";
        return { message: `reverted: ${reason}`, kind: "revert", errorName: "Error" };
      }
      if (data?.errorName === "Panic") {
        return {
          message: `panic: ${String(data.args?.[0])}`,
          kind: "panic",
          errorName: "Panic",
          args: data.args,
        };
      }
      if (data?.errorName) {
        return {
          message: `custom error ${data.errorName}(${(data.args ?? [])
            .map((a) => String(a))
            .join(", ")})`,
          kind: "custom_error",
          errorName: data.errorName,
          args: data.args,
        };
      }
      if (revert.reason) {
        return { message: `reverted: ${revert.reason}`, kind: "revert" };
      }
    }

    // No decoded contract revert: try to decode raw revert data with the ABI.
    const data = extractRevertData(error);
    if (data && abi) {
      try {
        const decoded = decodeErrorResult({ abi, data });
        return {
          message: `custom error ${decoded.errorName}(${(decoded.args ?? [])
            .map((a) => String(a))
            .join(", ")})`,
          kind: "custom_error",
          errorName: decoded.errorName,
          args: decoded.args as readonly unknown[] | undefined,
          data,
        };
      } catch {
        // fall through to the generic message
      }
    }

    // Fall back to viem's own short message off the deepest cause.
    const deepest = error.walk() as BaseError;
    return {
      message: deepest.shortMessage ?? error.shortMessage ?? error.message,
      kind: "execution",
      data,
    };
  }

  if (error instanceof Error) {
    return { message: error.message, kind: "rpc" };
  }
  return { message: String(error), kind: "unknown" };
}
