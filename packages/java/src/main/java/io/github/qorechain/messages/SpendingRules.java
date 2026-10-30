package io.github.qorechain.messages;

import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;
import qorechain.abstractaccount.v1.Tx.DenomLimit;
import qorechain.abstractaccount.v1.Tx.SpendingRule;

/**
 * Client-side checks for {@code MsgUpdateSpendingRules}, run by
 * {@link QorechainMessages.abstractaccount#updateSpendingRules} before anything is
 * signed.
 *
 * <p>They follow the chain's own {@code ValidateBasic} (limits non-negative, at
 * most {@link #MAX_DENOM_LIMITS} denom limits and {@link #MAX_ALLOWED_EVM_CALLS}
 * allowed calls, one limit per denom, amounts as non-negative decimal integers
 * with {@code ""} meaning "no limit of that kind") and refuse one shape the chain
 * does not yet: an ENABLED rule that bounds nothing. A rule bounds something when
 * it sets a rule-level per-tx or daily limit, a denom list, an allowed-call list,
 * or a denom limit with a non-zero amount.
 *
 * <p>A denom limit with both amounts empty or zero is refused too, whatever else
 * the rule sets. When a denom has an entry the chain applies only that entry and
 * skips the rule-level limits for the denom, so such an entry silently removes
 * every limit on it while the rule still reads as limited.
 *
 * <p>From chain v3.2.5 the chain refuses these shapes itself when the rules are
 * saved ({@code abstractaccount} code 8, "invalid spending rule"), and also an
 * EVM token denom whose contract address does not parse: an {@code erc20/},
 * {@code erc721/} or {@code erc1155/} denom (in {@code denom_limits} or
 * {@code allowed_denoms}) must carry a {@code 0x}-prefixed 20-byte address, and an
 * {@code erc20/} denom is the address alone. The same check runs here.
 */
public final class SpendingRules {

    private SpendingRules() {}

    /** At most this many {@code denom_limits} per rule (chain {@code MaxDenomLimits}). */
    public static final int MAX_DENOM_LIMITS = 64;

    /** At most this many {@code allowed_evm_calls} per rule (chain {@code MaxAllowedEVMCalls}). */
    public static final int MAX_ALLOWED_EVM_CALLS = 64;

    private static final Pattern DECIMAL = Pattern.compile("^\\d+$");

    /** The EVM token denom prefixes the chain parses (compared case-insensitively). */
    public static final List<String> EVM_DENOM_PREFIXES = List.of("erc20/", "erc721/", "erc1155/");

    private static final Pattern HEX_ADDRESS = Pattern.compile("^0[xX][0-9a-fA-F]{40}$");

    /**
     * Check one denom the way the chain's {@code ValidateEVMDenom} does (v3.2.5):
     * a denom starting with {@code erc20/}, {@code erc721/} or {@code erc1155/}
     * must continue with a {@code 0x}-prefixed 40-hex-digit contract address (up
     * to the next {@code /}), and an {@code erc20/} denom may not continue after
     * the address. Any other denom passes.
     *
     * @throws IllegalArgumentException naming the denom.
     */
    public static void validateEvmDenom(String denom) {
        String lower = denom.toLowerCase(Locale.ROOT);
        for (String p : EVM_DENOM_PREFIXES) {
            if (!lower.startsWith(p)) {
                continue;
            }
            String rest = denom.substring(p.length());
            int slash = rest.indexOf('/');
            String addr = slash >= 0 ? rest.substring(0, slash) : rest;
            if (!HEX_ADDRESS.matcher(addr).matches()) {
                throw new IllegalArgumentException("denom " + quote(denom) + ": " + p
                        + " must be followed by a 0x-prefixed 20-byte contract address");
            }
            if ("erc20/".equals(p) && slash >= 0) {
                throw new IllegalArgumentException(
                        "denom " + quote(denom) + ": an erc20/ denom is the contract address alone");
            }
            return;
        }
    }
    private static final Pattern WHITESPACE_OR_CONTROL = Pattern.compile("[\\x00-\\x20\\x7f]");

    /**
     * Check the rules of a {@code MsgUpdateSpendingRules}. Returns normally when
     * the rules are acceptable.
     *
     * @throws IllegalArgumentException naming the rule (by index) and the problem.
     */
    public static void validate(List<SpendingRule> rules) {
        if (rules == null) return;
        for (int i = 0; i < rules.size(); i++) {
            validateRule(rules.get(i), i);
        }
    }

    private static void validateRule(SpendingRule rule, int i) {
        long daily = rule.getDailyLimit();
        if (daily < 0) throw new IllegalArgumentException("spending rule " + i + ": daily limit must be non-negative");
        long perTx = rule.getPerTxLimit();
        if (perTx < 0) {
            throw new IllegalArgumentException("spending rule " + i + ": per-tx limit must be non-negative");
        }
        int calls = rule.getAllowedEvmCallsCount();
        if (calls > MAX_ALLOWED_EVM_CALLS) {
            throw new IllegalArgumentException("spending rule " + i + ": at most " + MAX_ALLOWED_EVM_CALLS
                    + " allowed EVM calls, got " + calls);
        }
        List<DenomLimit> limits = rule.getDenomLimitsList();
        if (limits.size() > MAX_DENOM_LIMITS) {
            throw new IllegalArgumentException("spending rule " + i + ": at most " + MAX_DENOM_LIMITS
                    + " denom limits, got " + limits.size());
        }
        Set<String> seen = new HashSet<>();
        boolean boundingDenomLimit = false;
        for (DenomLimit dl : limits) {
            String denom = dl.getDenom();
            if (isBlank(denom)) {
                throw new IllegalArgumentException("spending rule " + i + ": a denom limit has no denom");
            }
            if (denom.length() > 256 || WHITESPACE_OR_CONTROL.matcher(denom).find()) {
                throw new IllegalArgumentException("spending rule " + i + ": denom " + quote(denom)
                        + " is too long or contains whitespace");
            }
            try {
                validateEvmDenom(denom);
            } catch (IllegalArgumentException e) {
                throw new IllegalArgumentException("spending rule " + i + ": " + e.getMessage());
            }
            if (!seen.add(denom.toLowerCase(Locale.ROOT))) {
                throw new IllegalArgumentException(
                        "spending rule " + i + ": denom " + denom + " has more than one limit");
            }
            boolean perTxSet = isPositiveAmount(dl.getPerTxLimit(), "denom " + denom + " per-tx limit", i);
            boolean dailySet = isPositiveAmount(dl.getDailyLimit(), "denom " + denom + " daily limit", i);
            if (!perTxSet && !dailySet) {
                throw new IllegalArgumentException("spending rule " + i + ": the limit for " + denom
                        + " sets neither a per-tx nor a daily amount, which would remove the limit for " + denom
                        + " (an entry replaces the rule-level limits for its denom); set an amount or drop the entry");
            }
            boundingDenomLimit = true;
        }
        for (String d : rule.getAllowedDenomsList()) {
            try {
                validateEvmDenom(d);
            } catch (IllegalArgumentException e) {
                throw new IllegalArgumentException("spending rule " + i + ": " + e.getMessage());
            }
        }
        boolean bounded = daily > 0 || perTx > 0 || rule.getAllowedDenomsCount() > 0 || calls > 0
                || boundingDenomLimit;
        if (rule.getEnabled() && !bounded) {
            throw new IllegalArgumentException("spending rule " + i + " is enabled but bounds nothing: no per-tx"
                    + " or daily limit, no denom list, no allowed calls, and no denom limit with a non-zero amount."
                    + " It would permit everything while showing as a spending limit; set at least one bound or"
                    + " disable it.");
        }
    }

    /** A denom-limit amount: {@code ""} is zero, otherwise a non-negative decimal integer. True when non-zero. */
    private static boolean isPositiveAmount(String s, String what, int i) {
        if (s.isEmpty()) return false;
        if (!DECIMAL.matcher(s).matches()) {
            throw new IllegalArgumentException("spending rule " + i + ": " + what + " " + quote(s)
                    + " is not a non-negative decimal integer");
        }
        for (int k = 0; k < s.length(); k++) {
            if (s.charAt(k) != '0') return true;
        }
        return false;
    }

    /**
     * Empty or only whitespace, with whitespace as JavaScript's {@code trim} reads
     * it (so a no-break space counts, as in the other SDKs).
     */
    private static boolean isBlank(String s) {
        for (int k = 0; k < s.length(); k++) {
            char c = s.charAt(k);
            boolean ws = (c >= 0x09 && c <= 0x0d) || c == 0x20 || c == 0xa0 || c == 0x1680
                    || (c >= 0x2000 && c <= 0x200a) || c == 0x2028 || c == 0x2029 || c == 0x202f
                    || c == 0x205f || c == 0x3000 || c == 0xfeff;
            if (!ws) return false;
        }
        return true;
    }

    /** A JSON-style quoted string, for values that may hold whitespace or control characters. */
    private static String quote(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (int k = 0; k < s.length(); k++) {
            char c = s.charAt(k);
            if (c == '"' || c == '\\') {
                b.append('\\').append(c);
            } else if (c < 0x20 || c == 0x7f) {
                b.append(String.format("\\u%04x", (int) c));
            } else {
                b.append(c);
            }
        }
        return b.append('"').toString();
    }
}
