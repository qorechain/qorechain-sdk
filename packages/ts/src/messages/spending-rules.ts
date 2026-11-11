/**
 * Client-side checks for `MsgUpdateSpendingRules`, run by the
 * `abstractaccount.updateSpendingRules` composer before anything is signed.
 *
 * They follow the chain's own `ValidateBasic` (limits non-negative, at most
 * {@link MAX_DENOM_LIMITS} denom limits and {@link MAX_ALLOWED_EVM_CALLS}
 * allowed calls, one limit per denom, amounts as non-negative decimal
 * integers with `""` meaning "no limit of that kind") and refuse one shape the
 * chain does not yet: an ENABLED rule that bounds nothing. A rule bounds
 * something when it sets a rule-level per-tx or daily limit, a denom list, an
 * allowed-call list, or a denom limit with a non-zero amount. A rule whose
 * only "bounds" are denom limits with empty or zero amounts permits
 * everything while showing as an active spending limit.
 *
 * From chain v3.2.5 the chain refuses these shapes itself when a rule is saved
 * (`abstractaccount` code 8, invalid spending rule), together with an EVM
 * denom whose contract address does not parse ({@link validateEvmDenom}).
 *
 * A denom limit with both amounts empty or zero is refused too, whatever else
 * the rule sets. When a denom has an entry the chain applies only that entry
 * and skips the rule-level limits for the denom, so such an entry silently
 * removes every limit on it while the rule still reads as limited.
 */

/** At most this many `denom_limits` per rule (chain `MaxDenomLimits`). */
export const MAX_DENOM_LIMITS = 64;
/** At most this many `allowed_evm_calls` per rule (chain `MaxAllowedEVMCalls`). */
export const MAX_ALLOWED_EVM_CALLS = 64;

type RuleInput = {
  id?: string;
  dailyLimit?: string | number | bigint;
  perTxLimit?: string | number | bigint;
  allowedDenoms?: readonly string[];
  enabled?: boolean;
  allowedEvmCalls?: readonly string[];
  denomLimits?: ReadonlyArray<{ denom?: string; perTxLimit?: string; dailyLimit?: string } | undefined>;
};

/** A rule-level limit as a bigint; throws on anything that is not an integer. */
function ruleLimit(v: string | number | bigint | undefined, what: string, i: number): bigint {
  if (v === undefined || v === "") return 0n;
  let n: bigint;
  try {
    n = BigInt(v);
  } catch {
    throw new Error(`spending rule ${i}: ${what} ${JSON.stringify(String(v))} is not an integer`);
  }
  if (n < 0n) throw new Error(`spending rule ${i}: ${what} must be non-negative`);
  return n;
}

/** A denom-limit amount: `""` is zero, otherwise a non-negative decimal integer. */
function limitAmount(s: string | undefined, what: string, i: number): bigint {
  if (s === undefined || s === "") return 0n;
  if (!/^\d+$/.test(s)) {
    throw new Error(`spending rule ${i}: ${what} ${JSON.stringify(s)} is not a non-negative decimal integer`);
  }
  return BigInt(s);
}

const EVM_DENOM_PREFIXES = ["erc20/", "erc721/", "erc1155/"] as const;

/**
 * The chain's check on an EVM token denom in a spending rule (chain v3.2.5):
 * a denom that starts with `erc20/`, `erc721/` or `erc1155/` (any case) must
 * continue with a `0x`-prefixed 20-byte contract address; an `erc20/` denom is
 * the address alone, while `erc721/` and `erc1155/` may add `/<token id>`.
 * Other denoms pass. Throws an `Error` naming the denom.
 */
export function validateEvmDenom(denom: string): void {
  const lower = denom.toLowerCase();
  for (const p of EVM_DENOM_PREFIXES) {
    if (!lower.startsWith(p)) continue;
    const rest = denom.slice(p.length);
    const slash = rest.indexOf("/");
    const addr = slash < 0 ? rest : rest.slice(0, slash);
    if (!/^0[xX][0-9a-fA-F]{40}$/.test(addr)) {
      throw new Error(`denom ${JSON.stringify(denom)}: ${p} must be followed by a 0x-prefixed 20-byte contract address`);
    }
    if (p === "erc20/" && slash >= 0) {
      throw new Error(`denom ${JSON.stringify(denom)}: an erc20/ denom is the contract address alone`);
    }
    return;
  }
}

/**
 * Check the rules of a `MsgUpdateSpendingRules`. Throws an `Error` naming the
 * rule and the problem; returns nothing when the rules are acceptable.
 */
export function validateSpendingRules(rules: readonly RuleInput[] | undefined): void {
  (rules ?? []).forEach((rule, i) => {
    const daily = ruleLimit(rule.dailyLimit, "daily limit", i);
    const perTx = ruleLimit(rule.perTxLimit, "per-tx limit", i);
    const calls = rule.allowedEvmCalls ?? [];
    const limits = rule.denomLimits ?? [];
    if (calls.length > MAX_ALLOWED_EVM_CALLS) {
      throw new Error(`spending rule ${i}: at most ${MAX_ALLOWED_EVM_CALLS} allowed EVM calls, got ${calls.length}`);
    }
    if (limits.length > MAX_DENOM_LIMITS) {
      throw new Error(`spending rule ${i}: at most ${MAX_DENOM_LIMITS} denom limits, got ${limits.length}`);
    }
    const seen = new Set<string>();
    let boundingDenomLimit = false;
    for (const dl of limits) {
      const denom = dl?.denom ?? "";
      if (denom.trim() === "") throw new Error(`spending rule ${i}: a denom limit has no denom`);
      if (denom.length > 256 || /[\x00-\x20\x7f]/.test(denom)) {
        throw new Error(`spending rule ${i}: denom ${JSON.stringify(denom)} is too long or contains whitespace`);
      }
      try {
        validateEvmDenom(denom);
      } catch (e) {
        throw new Error(`spending rule ${i}: ${(e as Error).message}`);
      }
      const key = denom.toLowerCase();
      if (seen.has(key)) throw new Error(`spending rule ${i}: denom ${denom} has more than one limit`);
      seen.add(key);
      const a = limitAmount(dl?.perTxLimit, `denom ${denom} per-tx limit`, i);
      const b = limitAmount(dl?.dailyLimit, `denom ${denom} daily limit`, i);
      if (a === 0n && b === 0n) {
        throw new Error(
          `spending rule ${i}: the limit for ${denom} sets neither a per-tx nor a daily amount, which would remove ` +
            `the limit for ${denom} (an entry replaces the rule-level limits for its denom); set an amount or drop the entry`,
        );
      }
      boundingDenomLimit = true;
    }
    for (const d of rule.allowedDenoms ?? []) {
      try {
        validateEvmDenom(d);
      } catch (e) {
        throw new Error(`spending rule ${i}: ${(e as Error).message}`);
      }
    }
    const bounded =
      daily > 0n || perTx > 0n || (rule.allowedDenoms ?? []).length > 0 || calls.length > 0 || boundingDenomLimit;
    if (rule.enabled && !bounded) {
      throw new Error(
        `spending rule ${i} is enabled but bounds nothing: no per-tx or daily limit, no denom list, no allowed ` +
          "calls, and no denom limit with a non-zero amount. It would permit everything while showing as a " +
          "spending limit; set at least one bound or disable it.",
      );
    }
  });
}

/**
 * The authenticator permissions that move value. From chain v3.2.8 a key
 * linked with any of them needs an enabled, bounding spending rule on the
 * account ({@link checkValuePermissionRules}).
 */
export const VALUE_PERMISSIONS = ["send", "evm", "deploy", "svm", "all"] as const;

/** Whether `permissions` contains a permission that moves value ({@link VALUE_PERMISSIONS}). */
export function hasValuePermission(permissions: readonly string[] | undefined): boolean {
  return (permissions ?? []).some((p) => (VALUE_PERMISSIONS as readonly string[]).includes(p));
}

/**
 * Whether a spending rule bounds every denom, the way the chain requires of
 * the rule that covers a value-permission key (chain v3.2.8): `perTxLimit > 0`
 * or `dailyLimit > 0`, or, when both are zero, a non-empty `allowedDenoms`
 * list where every listed denom has a `denomLimits` entry with an amount
 * (denoms compared case-insensitively). Does not look at `enabled`.
 */
export function ruleBoundsEveryDenom(rule: RuleInput): boolean {
  const asInt = (v: string | number | bigint | undefined): bigint => {
    if (v === undefined || v === "") return 0n;
    try {
      return BigInt(v);
    } catch {
      return 0n;
    }
  };
  if (asInt(rule.perTxLimit) > 0n || asInt(rule.dailyLimit) > 0n) return true;
  const denoms = rule.allowedDenoms ?? [];
  if (denoms.length === 0) return false;
  const limited = new Set<string>();
  for (const dl of rule.denomLimits ?? []) {
    if (!dl?.denom) continue;
    const amount = (s: string | undefined) => (s !== undefined && /^\d+$/.test(s) ? BigInt(s) : 0n);
    if (amount(dl.perTxLimit) > 0n || amount(dl.dailyLimit) > 0n) limited.add(dl.denom.toLowerCase());
  }
  return denoms.every((d) => limited.has(d.toLowerCase()));
}

/**
 * The client-side mirror of the chain's v3.2.8 rule for linking a key with a
 * value permission (`send`, `evm`, `deploy`, `svm`, `all`): the account's
 * FIRST enabled rule in `rules` (the one the chain applies) must bound every
 * denom ({@link ruleBoundsEveryDenom}). Throws an `Error` saying what to set;
 * returns nothing when `permissions` moves no value or the rules cover it.
 */
export function checkValuePermissionRules(
  permissions: readonly string[] | undefined,
  rules: readonly RuleInput[] | undefined,
): void {
  if (!hasValuePermission(permissions)) return;
  const first = (rules ?? []).find((r) => r.enabled === true);
  const perms = (permissions ?? []).filter((p) => (VALUE_PERMISSIONS as readonly string[]).includes(p)).join(", ");
  if (!first) {
    throw new Error(
      `a key with the permission(s) ${perms} needs an enabled spending rule on the account from chain v3.2.8: ` +
        "pass a spending rule that sets perTxLimit or dailyLimit, or lists allowedDenoms with a denomLimits amount for each",
    );
  }
  if (!ruleBoundsEveryDenom(first)) {
    throw new Error(
      `the account's first enabled spending rule${first.id ? ` (${first.id})` : ""} does not bound every denom, which a key ` +
        `with the permission(s) ${perms} needs from chain v3.2.8: set perTxLimit > 0 or dailyLimit > 0, or list ` +
        "allowedDenoms and give each one a denomLimits entry with an amount",
    );
  }
}
