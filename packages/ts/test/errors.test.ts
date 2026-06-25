import { describe, it, expect } from "vitest";
import {
  decodeTxError,
  isTxFailure,
  QoreTxError,
  txErrorFrom,
} from "../src/errors";

describe("decodeTxError", () => {
  it("maps known sdk codespace codes to friendly messages", () => {
    expect(decodeTxError({ code: 5, codespace: "sdk" }).kind).toBe(
      "insufficient_funds",
    );
    expect(decodeTxError({ code: 11, codespace: "sdk" }).kind).toBe("out_of_gas");
    expect(decodeTxError({ code: 13, codespace: "sdk" }).kind).toBe(
      "insufficient_fee",
    );
  });

  it("defaults the codespace to sdk", () => {
    const d = decodeTxError({ code: 5 });
    expect(d.codespace).toBe("sdk");
    expect(d.kind).toBe("insufficient_funds");
  });

  it("includes the raw log for context", () => {
    const d = decodeTxError({ code: 5, codespace: "sdk", rawLog: "spendable 1 < 2" });
    expect(d.message).toContain("insufficient funds");
    expect(d.message).toContain("spendable 1 < 2");
    expect(d.rawLog).toBe("spendable 1 < 2");
  });

  it("falls back to the raw log for module (incl. qorechain) codespaces", () => {
    const d = decodeTxError({
      code: 7,
      codespace: "pqc",
      rawLog: "hybrid signature verification failed",
    });
    expect(d.kind).toBe("pqc_7");
    expect(d.codespace).toBe("pqc");
    expect(d.message).toContain("module \"pqc\"");
    expect(d.message).toContain("hybrid signature verification failed");
  });

  it("handles an unmapped sdk code gracefully", () => {
    const d = decodeTxError({ code: 999, codespace: "sdk", rawLog: "weird" });
    expect(d.message).toContain("999");
    expect(d.message).toContain("weird");
  });
});

describe("isTxFailure", () => {
  it("is true for non-zero codes", () => {
    expect(isTxFailure({ code: 5 })).toBe(true);
    expect(isTxFailure({ code: 0 })).toBe(false);
  });
});

describe("QoreTxError", () => {
  it("carries decoded fields and the tx hash", () => {
    const err = txErrorFrom({
      code: 13,
      codespace: "sdk",
      rawLog: "fee too low",
      txHash: "ABCD",
    });
    expect(err).toBeInstanceOf(QoreTxError);
    expect(err.code).toBe(13);
    expect(err.codespace).toBe("sdk");
    expect(err.kind).toBe("insufficient_fee");
    expect(err.txHash).toBe("ABCD");
    expect(err.message).toContain("ABCD");
  });
});
