/**
 * Structured decoding of failed Cosmos SDK transaction results.
 *
 * When a transaction fails, the node returns an ABCI result with a non-zero
 * `code`, a `codespace` naming the module that rejected it, and a `rawLog`
 * string. The numeric `code` is only meaningful *within* its codespace — code
 * `5` in the `sdk` codespace is "insufficient funds", but code `5` in another
 * module means something else entirely. {@link decodeTxError} maps the common
 * `sdk` codespace codes to readable messages and falls back to the raw log for
 * module-specific codespaces (including QoreChain's custom modules).
 *
 * {@link QoreTxError} is the typed error thrown by the tx client on a non-zero
 * broadcast code, carrying the decoded fields so callers can branch on
 * `codespace`/`code` rather than parse strings.
 */

/** The fields of a failed ABCI result needed to decode an error. */
export interface TxErrorInput {
  /** ABCI result code. `0` is success; any non-zero value is a failure. */
  code: number;
  /** The codespace (module) that produced the code. Defaults to `"sdk"`. */
  codespace?: string;
  /** The raw ABCI log string, used as a fallback message. */
  rawLog?: string;
  /** The transaction hash, when known. */
  txHash?: string;
}

/** A decoded, human-readable transaction error. */
export interface DecodedTxError {
  /** The ABCI result code. */
  code: number;
  /** The codespace the code belongs to. */
  codespace: string;
  /** A human-readable summary of what went wrong. */
  message: string;
  /** A short stable identifier for the error kind (e.g. `insufficient_funds`). */
  kind: string;
  /** The original raw log, preserved for debugging. */
  rawLog?: string;
}

/**
 * Known error codes in the core `sdk` codespace.
 *
 * These mirror the canonical Cosmos SDK error registry. Only the codes a dApp
 * commonly hits are mapped to friendly text; any other `sdk` code still decodes
 * (with the raw log) but uses a generic message.
 */
const SDK_CODES: Record<number, { kind: string; message: string }> = {
  2: { kind: "tx_decode_error", message: "failed to decode the transaction" },
  3: { kind: "invalid_sequence", message: "account sequence mismatch (nonce out of order) — refetch the account and retry" },
  4: { kind: "unauthorized", message: "unauthorized: signature or signer does not match" },
  5: { kind: "insufficient_funds", message: "insufficient funds to cover the transfer or fee" },
  6: { kind: "unknown_request", message: "unknown request" },
  7: { kind: "invalid_address", message: "invalid address" },
  8: { kind: "invalid_pubkey", message: "invalid public key" },
  9: { kind: "unknown_address", message: "unknown address (account does not exist on chain)" },
  10: { kind: "invalid_coins", message: "invalid coin amount or denomination" },
  11: { kind: "out_of_gas", message: "out of gas — raise the gas limit (or use the \"auto\" fee path with a higher multiplier)" },
  12: { kind: "memo_too_large", message: "memo is too large" },
  13: { kind: "insufficient_fee", message: "insufficient fee — the offered fee is below the node's minimum gas price" },
  14: { kind: "maximum_signatures_exceeded", message: "transaction has too many signatures" },
  15: { kind: "no_signatures", message: "transaction has no signatures" },
  16: { kind: "json_marshal_error", message: "failed to marshal JSON" },
  17: { kind: "json_unmarshal_error", message: "failed to unmarshal JSON" },
  18: { kind: "invalid_request", message: "invalid request" },
  19: { kind: "tx_in_mempool_cache", message: "transaction already exists in the mempool" },
  20: { kind: "mempool_is_full", message: "mempool is full — retry later" },
  21: { kind: "tx_too_large", message: "transaction is too large" },
  25: { kind: "invalid_gas_limit", message: "invalid gas limit" },
  30: { kind: "tx_timeout_height", message: "transaction timeout height exceeded" },
};

const DEFAULT_CODESPACE = "sdk";

/**
 * Decode a failed transaction result into a structured, readable error.
 *
 * For the `sdk` codespace, recognized codes get a friendly message; unrecognized
 * `sdk` codes and all other codespaces (including QoreChain module codespaces
 * such as `pqc`, `crossvm`, `bridge`, `amm`, …) fall back to the raw log, which
 * the module itself populates with a descriptive reason.
 *
 * @param input - The `code`, `codespace`, and `rawLog` from the result.
 */
export function decodeTxError(input: TxErrorInput): DecodedTxError {
  const codespace = input.codespace || DEFAULT_CODESPACE;
  const rawLog = input.rawLog;

  if (codespace === DEFAULT_CODESPACE) {
    const known = SDK_CODES[input.code];
    if (known) {
      return {
        code: input.code,
        codespace,
        kind: known.kind,
        message: rawLog ? `${known.message} (${rawLog})` : known.message,
        rawLog,
      };
    }
  }

  // Module codespace, or an unmapped sdk code: surface the raw log verbatim.
  const detail = rawLog && rawLog.length > 0 ? rawLog : "(no log provided)";
  return {
    code: input.code,
    codespace,
    kind: `${codespace}_${input.code}`,
    message: `transaction failed in module "${codespace}" with code ${input.code}: ${detail}`,
    rawLog,
  };
}

/** A result with an ABCI `code` field, as returned by broadcast/query. */
export interface TxResultLike {
  code: number;
}

/**
 * Test whether a broadcast/query result represents a failed transaction
 * (non-zero ABCI code). The inverse of "success".
 */
export function isTxFailure(result: TxResultLike): boolean {
  return result.code !== 0;
}

/**
 * The typed error thrown when a transaction is broadcast (or polled) with a
 * non-zero ABCI code. Carries the decoded fields so callers can branch on the
 * error kind without string-matching.
 */
export class QoreTxError extends Error {
  /** ABCI result code. */
  readonly code: number;
  /** The codespace (module) that rejected the transaction. */
  readonly codespace: string;
  /** A short stable identifier for the error kind. */
  readonly kind: string;
  /** The raw ABCI log, when present. */
  readonly rawLog?: string;
  /** The transaction hash, when known. */
  readonly txHash?: string;

  constructor(decoded: DecodedTxError, txHash?: string) {
    const suffix = txHash ? ` (tx ${txHash})` : "";
    super(decoded.message + suffix);
    this.name = "QoreTxError";
    this.code = decoded.code;
    this.codespace = decoded.codespace;
    this.kind = decoded.kind;
    this.rawLog = decoded.rawLog;
    this.txHash = txHash;
    Object.setPrototypeOf(this, QoreTxError.prototype);
  }
}

/**
 * Decode the given failed-tx fields and return a ready-to-throw
 * {@link QoreTxError}. Convenience for broadcast paths.
 */
export function txErrorFrom(input: TxErrorInput): QoreTxError {
  return new QoreTxError(decodeTxError(input), input.txHash);
}
