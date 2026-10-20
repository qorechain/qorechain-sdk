/**
 * Structured decoding of failed QoreChain Native transaction results.
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
 * These mirror the canonical QoreChain Native error registry. Only the codes a dApp
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

/**
 * Known error codes in the `abstractaccount` codespace (v3.1.85 authenticator
 * lanes). These are raised when a relayer-submitted `MsgExecuteEVM` /
 * `MsgExecuteCosmos` fails authorization: the authenticator's scope, its
 * spending rule, its session TTL, or its replay-protecting nonce.
 */
const ABSTRACTACCOUNT_CODES: Record<number, { kind: string; message: string }> = {
  5: {
    kind: "spending_limit_exceeded",
    message:
      "spending limit exceeded — the amount is over the authenticator's per-tx or daily SpendingRule",
  },
  6: {
    kind: "session_key_expired",
    message:
      "session key expired — the authenticator's expiry_unix has passed; re-register the key",
  },
  10: {
    kind: "permission_denied",
    message:
      "permission denied — the authenticator lacks the permission this message requires (check the permission_schema)",
  },
  11: {
    kind: "authenticator_replay",
    message:
      "authenticator replay — the nonce is not the linked key's current authenticator sequence (a per-key counter, NOT the account's EVM nonce or Cosmos sequence); re-sign with the key's next sequence",
  },
};

/**
 * Known error codes in the `pqc` codespace surfaced to dApps. Code 21 is raised
 * when a hybrid (classical + ML-DSA-87) signature fails verification — the
 * signature was made with the wrong key, over the wrong sign-bytes form for the
 * network, or the body / authInfo changed after signing. (Hedged and
 * deterministic ML-DSA signatures are both accepted.)
 */
const PQC_CODES: Record<number, { kind: string; message: string }> = {
  21: {
    kind: "hybrid_verify_failed",
    message:
      "hybrid signature verification failed — the ML-DSA-87 signature did not verify (check the PQC key, the sign-bytes form for this network, and that the body / authInfo did not change after signing)",
  },
  60: {
    kind: "evm_delegation_no_consent",
    message:
      "no post-quantum consent for this EIP-7702 delegation — broadcast MsgAuthorizeEVMDelegation for exactly this delegate first (chain v3.2.2)",
  },
  230: {
    kind: "pqc_key_weak",
    message:
      "the registration carries no usable post-quantum key (classical_only, empty, or a degenerate key) — register a real ML-DSA-87 key",
  },
  231: {
    kind: "pqc_proof_of_possession_invalid",
    message:
      "the proof of possession does not verify — sign it with the key being registered over the v1 proof-of-possession bytes for this chain and account",
  },
  232: {
    kind: "pqc_key_reused",
    message: "this account used that PQC key before — rotate or migrate to a key it has never had",
  },
  233: {
    kind: "pqc_last_signature_algorithm",
    message: "no active PQC signature algorithm would remain",
  },
  234: {
    kind: "pqc_maintenance_needs_hybrid",
    message:
      "an account with a registered PQC key must send key registration or migration with the hybrid signature — use migratePqcKeyHybrid",
  },
  61: {
    kind: "evm_delegation_invalid",
    message:
      "invalid EIP-7702 delegation request — check the delegate address and the blocks bound, and that the account has a registered PQC key",
  },
};

// The per-sender transaction rate limit (both lanes' ante handler) is
// codespace "ai", code 3, with the text "sender <addr> has sent <n> transactions
// in the last 30 blocks, at the configured limit of <limit> per minute". Code 3
// also carries other AI-engine rejections, so the text decides; a transport
// that drops the codespace (EVM JSON-RPC) is matched on the text alone.
// pqc 8 and pqc 20 cover two different remedies. pqc 8 is always an account
// without a PQC key (classical fallback disabled). pqc 20 is either a keyless
// account (register the key first) or a keyed account that sent no hybrid
// extension (sign hybrid); only the text tells them apart.
function classifyPqcKeyRequirement(
  codespace: string | undefined,
  code: number,
  rawLog: string | undefined,
): "pqc_key_required" | "hybrid_signature_required" | undefined {
  if (codespace !== "pqc" || (code !== 8 && code !== 20)) return undefined;
  const log = rawLog ?? "";
  if (/has a registered PQC key and must include/i.test(log)) return "hybrid_signature_required";
  if (code === 8 || /has no (registered )?PQC key|must include a PQC hybrid signature extension/i.test(log)) {
    return "pqc_key_required";
  }
  return undefined;
}

const PQC_KEY_REQUIREMENT_MESSAGES = {
  pqc_key_required:
    "this account has no registered PQC key — register one (MsgRegisterPQCKeyV2) before sending",
  hybrid_signature_required:
    "this account has a registered PQC key — sign the transaction with the hybrid (ML-DSA-87) extension",
} as const;

function isRateLimitLog(codespace: string | undefined, code: number, rawLog: string | undefined): boolean {
  if (!rawLog || !/transactions in the last/i.test(rawLog) || !/per minute/i.test(rawLog)) return false;
  return !codespace || (codespace === "ai" && code === 3);
}

/** Per-codespace code maps for QoreChain custom modules. */
const MODULE_CODES: Record<number | string, Record<number, { kind: string; message: string }>> = {
  abstractaccount: ABSTRACTACCOUNT_CODES,
  pqc: PQC_CODES,
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
 * Also accepts a thrown error as is: cosmjs's `BroadcastTxError` (a CheckTx
 * refusal) carries its log as `log`, and a failed simulation carries only a
 * `message`; either stands in for `rawLog`.
 *
 * @param input - The `code`, `codespace`, and `rawLog` from the result.
 */
export function decodeTxError(input: TxErrorInput): DecodedTxError {
  const codespace = input.codespace || DEFAULT_CODESPACE;
  const alt = input as { log?: unknown; message?: unknown };
  const rawLog =
    input.rawLog ??
    (typeof alt.log === "string" ? alt.log : undefined) ??
    (typeof alt.message === "string" && alt.message !== "" ? alt.message : undefined);

  const keyRequirement = classifyPqcKeyRequirement(input.codespace, input.code, rawLog);
  if (keyRequirement) {
    const base = PQC_KEY_REQUIREMENT_MESSAGES[keyRequirement];
    return {
      code: input.code,
      codespace,
      kind: keyRequirement,
      message: rawLog ? `${base} (${rawLog})` : base,
      rawLog,
    };
  }

  if (isRateLimitLog(input.codespace, input.code, rawLog)) {
    return {
      code: input.code,
      codespace,
      kind: "rate_limited",
      message: `the network is limiting this sender's transaction rate — wait and retry (${rawLog})`,
      rawLog,
    };
  }

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
  } else {
    // Known QoreChain custom-module codespace (abstractaccount, pqc, …).
    const known = MODULE_CODES[codespace]?.[input.code];
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
