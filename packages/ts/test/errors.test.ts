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

describe("authenticator-lane codespaces (v3.1.85)", () => {
  it("maps abstractaccount codes to friendly kinds", () => {
    expect(decodeTxError({ code: 5, codespace: "abstractaccount" }).kind).toBe(
      "spending_limit_exceeded",
    );
    expect(decodeTxError({ code: 6, codespace: "abstractaccount" }).kind).toBe(
      "session_key_expired",
    );
    expect(decodeTxError({ code: 10, codespace: "abstractaccount" }).kind).toBe(
      "permission_denied",
    );
    expect(decodeTxError({ code: 11, codespace: "abstractaccount" }).kind).toBe(
      "authenticator_replay",
    );
  });

  it("maps pqc code 21 to hybrid_verify_failed", () => {
    const d = decodeTxError({
      code: 21,
      codespace: "pqc",
      rawLog: "hedged sig rejected",
    });
    expect(d.kind).toBe("hybrid_verify_failed");
    expect(d.message).toContain("ML-DSA-87");
    expect(d.message).toContain("hedged sig rejected");
  });

  it("includes the raw log for a mapped module code", () => {
    const d = decodeTxError({
      code: 5,
      codespace: "abstractaccount",
      rawLog: "spent 200 > per-tx 100",
    });
    expect(d.message).toContain("spending limit exceeded");
    expect(d.message).toContain("spent 200 > per-tx 100");
  });

  it("still falls back for an unmapped abstractaccount code", () => {
    const d = decodeTxError({ code: 99, codespace: "abstractaccount" });
    expect(d.kind).toBe("abstractaccount_99");
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
