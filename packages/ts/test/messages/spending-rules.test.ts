import { describe, it, expect } from "vitest";

import { abstractaccount } from "../../src/messages/qorechain";
import { validateSpendingRules, MAX_DENOM_LIMITS } from "../../src/messages/spending-rules";

const OWNER = "qor1hkkxx5jmmw02wcz26c74lsp74qysj6h495vv0k";
const msg = (rules: object[]) => abstractaccount.updateSpendingRules({ owner: OWNER, accountAddress: OWNER, rules } as never);

describe("spending rules: an enabled rule must bound something", () => {
  it("refuses an enabled rule with no bound at all (as the chain does)", () => {
    expect(() => msg([{ enabled: true }])).toThrow(/bounds nothing/);
  });

  it("refuses a denom limit with empty or zero amounts: it would remove the limit for that denom", () => {
    for (const amounts of [{ perTxLimit: "", dailyLimit: "" }, { perTxLimit: "0", dailyLimit: "0" }, {}]) {
      expect(() => msg([{ enabled: true, denomLimits: [{ denom: "uqor", ...amounts }] }])).toThrow(
        /remove the limit for uqor/,
      );
      // Also inside a rule bounded otherwise: the entry replaces the rule-level limits for uqor.
      expect(() => msg([{ enabled: true, dailyLimit: "100", denomLimits: [{ denom: "uqor", ...amounts }] }])).toThrow(
        /remove the limit for uqor/,
      );
    }
  });

  it("accepts real bounds", () => {
    expect(() => msg([{ enabled: true, dailyLimit: "5" }])).not.toThrow();
    expect(() => msg([{ enabled: true, denomLimits: [{ denom: "uqor", dailyLimit: "5" }] }])).not.toThrow();
    expect(() => msg([{ enabled: true, allowedDenoms: ["uqor"] }])).not.toThrow();
    expect(() => msg([{ enabled: true, allowedEvmCalls: ["0x63C0c19a282a1B52b07dD5a65b58948A07DAE32B"] }])).not.toThrow();
    expect(() => msg([{ enabled: true, dailyLimit: "100", denomLimits: [{ denom: "uqor", perTxLimit: "7" }] }])).not.toThrow();
    // A disabled rule bounds nothing by design.
    expect(() => msg([{ enabled: false }])).not.toThrow();
  });

  it("checks amounts, denoms and counts like the chain", () => {
    expect(() => validateSpendingRules([{ dailyLimit: "-1" }])).toThrow(/non-negative/);
    expect(() => validateSpendingRules([{ enabled: true, denomLimits: [{ denom: "uqor", dailyLimit: "-5" }] }])).toThrow(
      /non-negative decimal/,
    );
    expect(() => validateSpendingRules([{ enabled: true, denomLimits: [{ denom: "uqor", dailyLimit: "1.5" }] }])).toThrow(
      /non-negative decimal/,
    );
    expect(() => validateSpendingRules([{ enabled: true, denomLimits: [{ denom: " ", dailyLimit: "1" }] }])).toThrow(
      /no denom/,
    );
    expect(() =>
      validateSpendingRules([
        { enabled: true, denomLimits: [{ denom: "uqor", dailyLimit: "1" }, { denom: "uqor", perTxLimit: "1" }] },
      ]),
    ).toThrow(/more than one limit/);
    const many = Array.from({ length: MAX_DENOM_LIMITS + 1 }, (_, i) => ({ denom: `d${i}`, dailyLimit: "1" }));
    expect(() => validateSpendingRules([{ enabled: true, denomLimits: many }])).toThrow(/at most 64/);
  });
});
