/**
 * Human-readable decoding of SVM (Solana-compatible) transaction errors.
 *
 * `@solana/web3.js` throws a `SendTransactionError` (and related shapes) whose
 * useful detail — the failing instruction index, a program's custom error code,
 * and the program logs — is spread across several fields that differ slightly
 * between library versions. {@link decodeSvmError} reads those fields
 * structurally (so it works across versions) and produces a flat summary with
 * the program logs and, where present, the failing instruction index.
 */

/** A decoded SVM error. */
export interface DecodedSvmError {
  /** A readable summary message. */
  message: string;
  /** A short, stable kind discriminator. */
  kind: "instruction_error" | "simulation" | "send" | "unknown";
  /** Zero-based index of the failing instruction, when determinable. */
  instructionIndex?: number;
  /** A program's custom error code, when present in the logs. */
  customErrorCode?: number;
  /** The program logs, when available. */
  logs?: string[];
}

/** Read the program logs from the various shapes web3.js uses. */
function extractLogs(err: unknown): string[] | undefined {
  const e = err as { logs?: unknown; transactionLogs?: unknown };
  const logs = e?.logs ?? e?.transactionLogs;
  if (Array.isArray(logs)) return logs as string[];
  return undefined;
}

/** Read a base message from the various shapes web3.js uses. */
function extractMessage(err: unknown): string {
  const e = err as { transactionMessage?: unknown; message?: unknown };
  if (typeof e?.transactionMessage === "string" && e.transactionMessage) {
    return e.transactionMessage;
  }
  if (typeof e?.message === "string" && e.message) return e.message;
  return String(err);
}

/**
 * Parse the failing instruction index and a custom program error code from the
 * program logs, if either is present.
 *
 * Logs commonly contain a line like:
 *   "Program <id> failed: custom program error: 0x1"
 * and the instruction index can appear as "Error processing Instruction 2:".
 */
function parseFromLogs(logs: string[] | undefined): {
  instructionIndex?: number;
  customErrorCode?: number;
} {
  if (!logs) return {};
  let instructionIndex: number | undefined;
  let customErrorCode: number | undefined;
  for (const line of logs) {
    const instr = /instruction\s+#?(\d+)/i.exec(line);
    if (instr) instructionIndex = Number(instr[1]);
    const custom = /custom program error:\s*(0x[0-9a-fA-F]+|\d+)/i.exec(line);
    if (custom) {
      customErrorCode = custom[1].startsWith("0x")
        ? parseInt(custom[1], 16)
        : Number(custom[1]);
    }
  }
  return { instructionIndex, customErrorCode };
}

/**
 * Decode an SVM error thrown by `@solana/web3.js` into a readable, structured
 * form.
 *
 * @param error - The thrown error (a `SendTransactionError` or any value).
 */
export function decodeSvmError(error: unknown): DecodedSvmError {
  const logs = extractLogs(error);
  const base = extractMessage(error);
  const { instructionIndex, customErrorCode } = parseFromLogs(logs);

  const name = (error as { name?: string })?.name;
  const isSendError =
    name === "SendTransactionError" ||
    /simulation failed|transaction simulation/i.test(base);

  const parts: string[] = [base];
  if (instructionIndex !== undefined) {
    parts.push(`(failing instruction #${instructionIndex})`);
  }
  if (customErrorCode !== undefined) {
    parts.push(`(custom program error ${customErrorCode})`);
  }

  let kind: DecodedSvmError["kind"];
  if (customErrorCode !== undefined || instructionIndex !== undefined) {
    kind = "instruction_error";
  } else if (isSendError) {
    kind = "simulation";
  } else if (error instanceof Error) {
    kind = "send";
  } else {
    kind = "unknown";
  }

  return {
    message: parts.join(" "),
    kind,
    instructionIndex,
    customErrorCode,
    logs,
  };
}
