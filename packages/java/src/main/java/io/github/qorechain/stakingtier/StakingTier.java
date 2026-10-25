package io.github.qorechain.stakingtier;

import com.fasterxml.jackson.databind.JsonNode;
import io.github.qorechain.query.RestClient;
import java.math.BigInteger;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import qorechain.stakingtier.v1.Tx.MsgLockDelegation;

/**
 * Staking tiers (chain v3.2.4, {@code x/stakingtier}).
 *
 * <p>A delegator locks part of an existing delegation for 3, 6 or 12 months and
 * earns a bonus on top of the staking reward (the terms and bonus rates are
 * governance parameters, read them with {@link #fetchParams}). Running a light
 * node or a validator adds to the bonus, up to a total cap. Leaving a lock early
 * burns a penalty and forfeits the bonus.
 *
 * <p>Messages: {@code QorechainMessages.stakingtier.lockDelegation},
 * {@code unlockEarly}, {@code claimBonus}. Reads (REST): {@link #fetchParams},
 * {@link #fetchLocks}, {@link #fetchPool}.
 *
 * <p>Amounts ({@code cosmos.Int}) decode to {@link BigInteger}; ids, heights and
 * times to {@code long}; decimal strings stay strings.
 */
public final class StakingTier {

    private StakingTier() {}

    /** The lock terms the chain accepts ({@code AllowedLockMonths}). */
    public static final List<Integer> STAKING_LOCK_MONTHS = List.of(3, 6, 12);

    private static final Pattern DECIMAL = Pattern.compile("^\\d+$");

    /**
     * The chain's stateless checks on {@code MsgLockDelegation}, run by
     * {@code QorechainMessages.stakingtier.lockDelegation} before anything is
     * signed.
     *
     * @throws IllegalArgumentException naming the field.
     */
    public static void validateLockDelegation(MsgLockDelegation m) {
        if (m.getDelegator().isEmpty()) {
            throw new IllegalArgumentException("lockDelegation: delegator is required");
        }
        if (m.getValidator().isEmpty()) {
            throw new IllegalArgumentException("lockDelegation: validator is required");
        }
        String amount = m.getAmount();
        if (!DECIMAL.matcher(amount).matches() || new BigInteger(amount).signum() <= 0) {
            throw new IllegalArgumentException(
                    "lockDelegation: amount must be a positive integer in base units, got \"" + amount + "\"");
        }
        if (!STAKING_LOCK_MONTHS.contains(m.getMonths())) {
            throw new IllegalArgumentException(
                    "lockDelegation: months must be one of 3, 6, 12, got " + m.getMonths());
        }
    }

    /** One offered term and its bonus, in basis points of APY. */
    public static final class LockTier {
        public final int months;
        public final int bonusBps;

        public LockTier(int months, int bonusBps) {
            this.months = months;
            this.bonusBps = bonusBps;
        }
    }

    /** Module parameters ({@code /qorechain/stakingtier/v1/params}). */
    public static final class Params {
        /** Offered terms and their bonus. */
        public final List<LockTier> lockTiers;
        /** Extra bonus for a holder that runs an active light node. */
        public final int lightNodeBonusBps;
        /** Extra bonus for a holder that runs a validator. */
        public final int validatorBonusBps;
        /** Cap on the total yield (staking reward plus every bonus). */
        public final int maxTotalApyBps;
        /** Share of the locked amount burned on an early unlock. */
        public final int earlyUnlockPenaltyBps;
        /** Whether governance has the module switched on. */
        public final boolean enabled;
        /** Smallest lock, in base units. */
        public final BigInteger minLockAmount;

        Params(JsonNode b) {
            List<LockTier> tiers = new ArrayList<>();
            JsonNode t = b.get("lock_tiers");
            if (t != null && t.isArray()) {
                for (JsonNode x : t) {
                    tiers.add(new LockTier(num(x, "months"), num(x, "bonus_bps")));
                }
            }
            this.lockTiers = List.copyOf(tiers);
            this.lightNodeBonusBps = num(b, "light_node_bonus_bps");
            this.validatorBonusBps = num(b, "validator_bonus_bps");
            this.maxTotalApyBps = num(b, "max_total_apy_bps");
            this.earlyUnlockPenaltyBps = num(b, "early_unlock_penalty_bps");
            this.enabled = bool(b, "enabled");
            this.minLockAmount = amount(b, "min_lock_amount");
        }

        /** Decode the REST body. */
        public static Params of(JsonNode body) {
            return new Params(nonNull(body));
        }
    }

    /** One lock ({@code /qorechain/stakingtier/v1/locks/{holder}}). */
    public static final class Lock {
        public final long id;
        public final String validator;
        public final BigInteger lockedAmount;
        public final String lockedShares;
        public final int months;
        public final int tierBonusBps;
        public final long startHeight;
        /** Unix seconds. */
        public final long startTime;
        /** Unix seconds; the lock is released at this block time. */
        public final long endTime;
        public final BigInteger accruedBonus;
        public final boolean released;
        public final int lightNodeBonusBps;
        public final int validatorBonusBps;
        /** Decimal string. */
        public final String projectedBonusBps;
        public final BigInteger projectedBonusToExpiry;

        Lock(JsonNode l) {
            this.id = number(l, "id");
            this.validator = str(l, "validator");
            this.lockedAmount = amount(l, "locked_amount");
            this.lockedShares = str(l, "locked_shares");
            this.months = num(l, "months");
            this.tierBonusBps = num(l, "tier_bonus_bps");
            this.startHeight = number(l, "start_height");
            this.startTime = number(l, "start_time");
            this.endTime = number(l, "end_time");
            this.accruedBonus = amount(l, "accrued_bonus");
            this.released = bool(l, "released");
            this.lightNodeBonusBps = num(l, "light_node_bonus_bps");
            this.validatorBonusBps = num(l, "validator_bonus_bps");
            this.projectedBonusBps = str(l, "projected_bonus_bps");
            this.projectedBonusToExpiry = amount(l, "projected_bonus_to_expiry");
        }
    }

    /** A holder's locks and claimable bonus. */
    public static final class Locks {
        public final List<Lock> locks;
        public final BigInteger claimable;
        public final BigInteger totalClaimable;

        Locks(JsonNode b) {
            List<Lock> out = new ArrayList<>();
            JsonNode a = b.get("locks");
            if (a != null && a.isArray()) {
                for (JsonNode l : a) {
                    out.add(new Lock(l));
                }
            }
            this.locks = List.copyOf(out);
            this.claimable = amount(b, "claimable");
            this.totalClaimable = amount(b, "total_claimable");
        }

        /** Decode the REST body. */
        public static Locks of(JsonNode body) {
            return new Locks(nonNull(body));
        }
    }

    /** The bonus pool ({@code /qorechain/stakingtier/v1/pool}). */
    public static final class Pool {
        public final BigInteger balance;
        public final BigInteger outstanding;
        public final BigInteger surplus;
        public final BigInteger totalMinted;
        public final BigInteger totalPaid;
        public final BigInteger totalForfeited;
        public final BigInteger totalPenaltyBurned;
        public final long lastSettleTime;
        public final long lastSettleHeight;
        /** Decimal string. */
        public final String lastBaseApyBps;
        public final long lockCount;

        Pool(JsonNode b) {
            this.balance = amount(b, "balance");
            this.outstanding = amount(b, "outstanding");
            this.surplus = amount(b, "surplus");
            this.totalMinted = amount(b, "total_minted");
            this.totalPaid = amount(b, "total_paid");
            this.totalForfeited = amount(b, "total_forfeited");
            this.totalPenaltyBurned = amount(b, "total_penalty_burned");
            this.lastSettleTime = number(b, "last_settle_time");
            this.lastSettleHeight = number(b, "last_settle_height");
            this.lastBaseApyBps = str(b, "last_base_apy_bps");
            this.lockCount = number(b, "lock_count");
        }

        /** Decode the REST body. */
        public static Pool of(JsonNode body) {
            return new Pool(nonNull(body));
        }
    }

    /** Read the module parameters. */
    public static Params fetchParams(RestClient rest) {
        return Params.of(rest.get("/qorechain/stakingtier/v1/params"));
    }

    /** Read a holder's ({@code qor1…}) locks and claimable bonus. */
    public static Locks fetchLocks(RestClient rest, String holder) {
        return Locks.of(
                rest.get("/qorechain/stakingtier/v1/locks/" + URLEncoder.encode(holder, StandardCharsets.UTF_8)));
    }

    /** Read the bonus pool. */
    public static Pool fetchPool(RestClient rest) {
        return Pool.of(rest.get("/qorechain/stakingtier/v1/pool"));
    }

    // ---- JSON decoding (numbers arrive as strings or bare tokens) ----

    private static JsonNode nonNull(JsonNode body) {
        if (body == null || body.isNull()) {
            throw new IllegalArgumentException("stakingtier: empty response");
        }
        return body;
    }

    private static String scalar(JsonNode node, String field) {
        JsonNode v = node.get(field);
        return v == null || v.isNull() ? "" : v.asText().trim();
    }

    private static String str(JsonNode node, String field) {
        JsonNode v = node.get(field);
        return v != null && v.isTextual() ? v.asText() : "";
    }

    private static boolean bool(JsonNode node, String field) {
        JsonNode v = node.get(field);
        return v != null && v.isBoolean() && v.asBoolean();
    }

    private static int num(JsonNode node, String field) {
        long v = number(node, field);
        if (v < 0 || v > Integer.MAX_VALUE) {
            throw new IllegalArgumentException("stakingtier: field " + field + " is out of range: " + v);
        }
        return (int) v;
    }

    private static long number(JsonNode node, String field) {
        String s = scalar(node, field);
        if (s.isEmpty()) {
            return 0L;
        }
        try {
            // uint64 fields (ids, the lock count) read unsigned; int64 ones may be negative.
            return s.startsWith("-") ? Long.parseLong(s) : Long.parseUnsignedLong(s);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("stakingtier: field " + field + " is not an integer: \"" + s + "\"");
        }
    }

    private static BigInteger amount(JsonNode node, String field) {
        String s = scalar(node, field);
        if (s.isEmpty()) {
            return BigInteger.ZERO;
        }
        try {
            return new BigInteger(s);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(
                    "stakingtier: field " + field + " is not an integer amount: \"" + s + "\"");
        }
    }
}
