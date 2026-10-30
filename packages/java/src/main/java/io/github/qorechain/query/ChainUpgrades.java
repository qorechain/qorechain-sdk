package io.github.qorechain.query;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Which chain releases a network has applied.
 *
 * <p>A release adds message fields, and a node below it does not know them: the
 * transaction decoder refuses a message carrying an unknown field, so setting
 * one of a release's new OPTIONAL fields before the upgrade gets the whole
 * transaction refused. Set such fields only after the network has applied the
 * release. Each release switches its protocol features on at its plan height,
 * which the upgrade module reports. Plan names are the same on every network.
 * From chain v3.2.4 the switches can also be read by name with
 * {@link ProtocolFeatures#fetch}.
 */
public final class ChainUpgrades {
    private ChainUpgrades() {}

    /**
     * EIP-7702 delegation consent, the measured EVM spending policy, the
     * {@code ecdsa_pubkey} check on PQC registration and the new bridge,
     * multilayer and RDK messages.
     */
    public static final String V3_2_2 = "v3.2.2";

    /**
     * PQC registration integrity and {@code proof_of_possession}, hybrid-only key
     * maintenance for keyed accounts, the EVM window scope ({@code native_only},
     * {@code allowed_targets}), the abstract-account v2 digest and
     * {@code MsgUpdateAuthority}.
     */
    public static final String V3_2_3 = "v3.2.3";

    /**
     * Staking tiers, the authenticator nonce and protocol-feature queries,
     * {@code possession_proven}, and the bridge validator's proof of possession.
     */
    public static final String V3_2_4 = "v3.2.4";

    /**
     * The KEM key registry ({@code MsgRegisterKEMKey} / {@code MsgRemoveKEMKey}),
     * exact simulation gas (simulation includes the post-quantum verification),
     * spending-rule bounds checked when the rules are saved, the abstract-account
     * {@code MsgUpdateConfig}, and the crossvm and rdk {@code MsgUpdateParams}.
     */
    public static final String V3_2_5 = "v3.2.5";

    /** How long a "not applied yet" answer is trusted, in milliseconds. */
    static final long NOT_APPLIED_TTL_MS = 60_000L;

    // An applied plan stays applied, so a positive answer is cached for the life
    // of the process; a negative one briefly, since the upgrade can land at any
    // block.
    private static final ConcurrentHashMap<String, long[]> CACHE = new ConcurrentHashMap<>();

    /** The REST path of the {@code applied_plan} query. */
    public static String appliedPlanPath(String plan) {
        return "/cosmos/upgrade/v1beta1/applied_plan/" + plan;
    }

    /**
     * The applied height in an {@code applied_plan} body; 0 = not applied.
     * Mainnet answers {@code {"height":"0"}} for a plan it has not applied, so
     * the number is parsed, never tested for presence.
     */
    public static long parseAppliedHeight(JsonNode body) {
        JsonNode h = body == null ? null : body.get("height");
        if (h == null || h.isNull() || h.asText().trim().isEmpty()) {
            return 0L;
        }
        try {
            return Long.parseUnsignedLong(h.asText().trim());
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("applied_plan height is not an integer: \"" + h.asText() + "\"");
        }
    }

    /**
     * The height at which {@code plan} was applied on the network behind
     * {@code rest}, or 0. {@code cacheKey} identifies the network (its REST
     * URL); {@code null} asks the node every time.
     *
     * <p>A transport failure propagates. Never read it as "not applied": the
     * guess sends the wrong wire format to the network.
     */
    public static long appliedHeight(RestClient rest, String plan, String cacheKey) {
        String key = cacheKey == null ? null : cacheKey + "|" + plan;
        if (key != null) {
            long[] hit = CACHE.get(key);
            if (hit != null && (hit[0] > 0 || System.currentTimeMillis() - hit[1] < NOT_APPLIED_TTL_MS)) {
                return hit[0];
            }
        }
        long height = parseAppliedHeight(rest.get(appliedPlanPath(plan)));
        if (key != null) {
            CACHE.put(key, new long[] {height, System.currentTimeMillis()});
        }
        return height;
    }

    /** Whether the network has applied {@code plan}. */
    public static boolean isApplied(RestClient rest, String plan, String cacheKey) {
        return appliedHeight(rest, plan, cacheKey) > 0;
    }

    /**
     * Refuse to set {@code what} (a release's new fields) on a network below
     * {@code plan}.
     *
     * @throws IllegalStateException when the network has not applied {@code plan}
     */
    public static void requireApplied(RestClient rest, String plan, String what, String cacheKey) {
        if (!isApplied(rest, plan, cacheKey)) {
            throw new IllegalStateException(
                    what + " needs chain " + plan + ", which this network has not applied yet; a node"
                            + " below " + plan + " refuses the whole transaction when the field is set,"
                            + " so leave it unset until the upgrade");
        }
    }

    /** Forget cached answers (tests, network switches). */
    public static void clearCache() {
        CACHE.clear();
    }
}
