import { describe, it, expect } from "vitest";
import { decodeSvmError } from "../src/errors";

describe("decodeSvmError", () => {
  it("parses a SendTransactionError with logs and a custom program error", () => {
    const err = new Error("Transaction simulation failed") as Error & {
      name: string;
      logs: string[];
    };
    err.name = "SendTransactionError";
    err.logs = [
      "Program 11111111111111111111111111111111 invoke [1]",
      "Program log: Error processing Instruction 2: custom program error: 0x1",
      "Program 11111111111111111111111111111111 failed: custom program error: 0x1",
    ];
    const decoded = decodeSvmError(err);
    expect(decoded.kind).toBe("instruction_error");
    expect(decoded.instructionIndex).toBe(2);
    expect(decoded.customErrorCode).toBe(1);
    expect(decoded.message).toContain("instruction #2");
    expect(decoded.logs).toHaveLength(3);
  });

  it("reads logs from a transactionLogs field", () => {
    const err = {
      name: "SendTransactionError",
      transactionMessage: "Transaction simulation failed",
      transactionLogs: ["Program X failed: custom program error: 0x10"],
    };
    const decoded = decodeSvmError(err);
    expect(decoded.customErrorCode).toBe(16);
    expect(decoded.logs).toHaveLength(1);
  });

  it("classifies a simulation failure without an instruction index", () => {
    const err = new Error("Transaction simulation failed: blockhash not found");
    const decoded = decodeSvmError(err);
    expect(decoded.kind).toBe("simulation");
    expect(decoded.message).toContain("blockhash not found");
  });

  it("falls back for a plain Error", () => {
    const decoded = decodeSvmError(new Error("connection refused"));
    expect(decoded.kind).toBe("send");
    expect(decoded.message).toBe("connection refused");
  });

  it("handles non-Error values", () => {
    const decoded = decodeSvmError("nope");
    expect(decoded.kind).toBe("unknown");
    expect(decoded.message).toBe("nope");
  });
});
