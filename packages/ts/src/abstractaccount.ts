/**
 * Abstract-account reads and governance checks added in chain v3.2.5.
 *
 * - {@link fetchSpendingRules}: the rules an account stored, account-wide and
 *   per linked key (`GET /qorechain/abstractaccount/v1/accounts/{address}/spending_rules`).
 * - {@link fetchAuthenticators}: the keys linked to an account, revoked ones
 *   included (`GET /qorechain/abstractaccount/v1/accounts/{address}/authenticators`).
 * - {@link validateUpdateConfig}: the checks on `MsgUpdateConfig`, the
 *   governance message that replaces the module configuration (among it the
 *   `enabled` switch of account creation, authenticator registration and both
 *   execute lanes).
 */

import type { FetchLike } from "./query/http";

/** A spending rule as the chain returns it. */
export interface SpendingRuleView {
  id: string;
  dailyLimit: bigint;
  perTxLimit: bigint;
  allowedDenoms: string[];
  enabled: boolean;
  allowedEvmCalls: string[];
  denomLimits: { denom: string; perTxLimit: string; dailyLimit: string }[];
}

/** The rule a linked key carries itself. */
export interface AuthenticatorRuleView {
  scheme: string;
  /** The key, hex encoded. */
  pubkeyHex: string;
  rule: SpendingRuleView;
}

/** An account's stored spending rules. */
export interface SpendingRules {
  /** Account-wide rules in stored order; the first enabled one bounds every linked key without its own. */
  rules: SpendingRuleView[];
  /** The per-key rules. */
  authenticatorRules: AuthenticatorRuleView[];
}

/** A key linked to an account. */
export interface AuthenticatorView {
  scheme: string;
  /** The key, hex encoded. */
  pubkeyHex: string;
  permissions: string[];
  /** Unix seconds. */
  expiryUnix: bigint;
  label: string;
  /** Unix seconds. */
  createdAtUnix: bigint;
  revoked: boolean;
  /** Whether the key carries a rule of its own (see {@link fetchSpendingRules}). */
  hasSpendRule: boolean;
}

type Raw = Record<string, unknown>;
const int = (v: unknown): bigint => (typeof v === "string" || typeof v === "number" ? BigInt(v || 0) : 0n);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const list = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);

function parseRule(r: Raw | undefined): SpendingRuleView {
  const rule = r ?? {};
  return {
    id: str(rule.id),
    dailyLimit: int(rule.daily_limit),
    perTxLimit: int(rule.per_tx_limit),
    allowedDenoms: strs(rule.allowed_denoms),
    enabled: rule.enabled === true,
    allowedEvmCalls: strs(rule.allowed_evm_calls),
    denomLimits: list(rule.denom_limits).map((d) => ({
      denom: str(d.denom),
      perTxLimit: str(d.per_tx_limit),
      dailyLimit: str(d.daily_limit),
    })),
  };
}

/** Parse the JSON of the spending-rules route. */
export function parseSpendingRules(body: unknown): SpendingRules {
  const b = (body ?? {}) as Raw;
  return {
    rules: list(b.rules).map(parseRule),
    authenticatorRules: list(b.authenticator_rules).map((a) => ({
      scheme: str(a.scheme),
      pubkeyHex: str(a.pubkey_hex),
      rule: parseRule(a.rule as Raw | undefined),
    })),
  };
}

/** Parse the JSON of the authenticators route. */
export function parseAuthenticators(body: unknown): AuthenticatorView[] {
  return list(((body ?? {}) as Raw).authenticators).map((a) => ({
    scheme: str(a.scheme),
    pubkeyHex: str(a.pubkey_hex),
    permissions: strs(a.permissions),
    expiryUnix: int(a.expiry_unix),
    label: str(a.label),
    createdAtUnix: int(a.created_at_unix),
    revoked: a.revoked === true,
    hasSpendRule: a.has_spend_rule === true,
  }));
}

async function getJson(opts: { rest: string; fetch?: FetchLike }, path: string): Promise<unknown> {
  const f = opts.fetch ?? (globalThis.fetch as FetchLike);
  const url = `${opts.rest.replace(/\/+$/, "")}${path}`;
  const res = await f(url);
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { message?: string }).message ?? "";
    } catch {
      /* no JSON body */
    }
    throw new Error(`abstractaccount query failed: HTTP ${res.status} from ${url}${detail ? `: ${detail}` : ""}`);
  }
  return res.json();
}

/** Read the spending rules an account stored (chain v3.2.5). */
export async function fetchSpendingRules(opts: { rest: string; address: string; fetch?: FetchLike }): Promise<SpendingRules> {
  return parseSpendingRules(
    await getJson(opts, `/qorechain/abstractaccount/v1/accounts/${encodeURIComponent(opts.address)}/spending_rules`),
  );
}

/** Read the keys linked to an account, revoked ones included (chain v3.2.5). */
export async function fetchAuthenticators(opts: {
  rest: string;
  address: string;
  fetch?: FetchLike;
}): Promise<AuthenticatorView[]> {
  return parseAuthenticators(
    await getJson(opts, `/qorechain/abstractaccount/v1/accounts/${encodeURIComponent(opts.address)}/authenticators`),
  );
}

/**
 * The chain's checks on `MsgUpdateConfig` (governance only: `authority` is the
 * governance module account). `maxSessionKeys`, `maxSpendingRules` and
 * `defaultSessionTtl` (seconds) must be positive. A proposal copies the current
 * values from `/qorechain/abstractaccount/v1/config` and changes only what it
 * means to change. Throws an `Error` naming the field.
 */
export function validateUpdateConfig(value: {
  authority?: string;
  maxSessionKeys?: number;
  maxSpendingRules?: number;
  defaultSessionTtl?: bigint | number | string;
}): void {
  if (!value.authority) throw new Error("updateConfig: authority (the governance module account) is required");
  for (const [name, v] of [
    ["maxSessionKeys", value.maxSessionKeys],
    ["maxSpendingRules", value.maxSpendingRules],
  ] as const) {
    if (!Number.isInteger(v) || (v as number) <= 0 || (v as number) > 0x7fffffff) {
      throw new Error(`updateConfig: ${name} must be a positive integer, got ${String(v)}`);
    }
  }
  let ttl: bigint;
  try {
    ttl = BigInt(value.defaultSessionTtl ?? 0);
  } catch {
    throw new Error(`updateConfig: defaultSessionTtl must be a positive integer, got ${String(value.defaultSessionTtl)}`);
  }
  if (ttl <= 0n) {
    throw new Error(`updateConfig: defaultSessionTtl must be a positive integer, got ${String(value.defaultSessionTtl)}`);
  }
}
