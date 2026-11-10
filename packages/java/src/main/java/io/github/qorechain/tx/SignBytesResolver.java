package io.github.qorechain.tx;

import com.fasterxml.jackson.databind.JsonNode;
import io.github.qorechain.query.Http;
import io.github.qorechain.query.ProtocolFeatures;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;

/**
 * Resolves which hybrid sign-bytes form ({@link SignBytes.Version}) a network
 * verifies right now.
 *
 * <ul>
 *   <li>{@link SignBytes.Mode#V1} / {@link SignBytes.Mode#V2} - returned as-is, no
 *       network call.
 *   <li>{@link SignBytes.Mode#AUTO} on a chain that is not a legacy network - v2, no
 *       network call.
 *   <li>{@link SignBytes.Mode#AUTO} on {@code qorechain-vladi} /
 *       {@code qorechain-diana} - first {@code GET
 *       {restUrl}/qorechain/pqc/v1/protocol_features} (chain v3.2.4 and later): v2 when
 *       {@link #PQC_SIGN_BYTES_V2_FEATURE} is listed and enabled, v1 when the node lists
 *       its features and that one is disabled or absent. This also covers a fresh
 *       network that reuses a legacy chain id: it enables every feature at genesis and
 *       never applies an upgrade plan. Only when that query cannot answer (older node,
 *       transport error, unexpected or empty payload): {@code GET
 *       {restUrl}/cosmos/upgrade/v1beta1/applied_plan/{name}} for <b>every</b> name in
 *       {@link SignBytes#SIGN_BYTES_V2_UPGRADES}, in order, then apply
 *       {@link SignBytes#versionFor}: the first name whose {@code {"height":"<n>"}} is
 *       numerically greater than 0 means v2 and the rest are not asked; v1 only when
 *       every name answers {@code "0"}, {@code {}} or no height at all. With no
 *       {@code restUrl}, or when any applied-plan query fails, this throws: it never
 *       guesses.
 * </ul>
 *
 * <p>Asking a single name is the bug this class exists to avoid: the switch to v2 ships
 * under two plan names and each network keeps only the one it took (mainnet
 * {@code v3.2.0}, the testnet {@code v3.1.98}), so a one-name lookup resolves v1 on the
 * other network and every hybrid transaction there is refused with {@code pqc} code 21.
 * Mainnet after its own upgrade costs one request; the testnet costs two.
 *
 * <p>Answers are cached per {@code (restUrl, chainId)} for {@link #DEFAULT_TTL_MS}
 * (configurable), since a network can upgrade while an application is running.
 * {@link #resolve(SignBytes.Mode, String, String, boolean)} with
 * {@code forceRefresh = true} bypasses and replaces the cached answer;
 * {@link #clearCache()} drops everything. Thread-safe.
 */
public final class SignBytesResolver {

    /** Default cache lifetime: 60 seconds. */
    public static final long DEFAULT_TTL_MS = 60_000L;

    /** The protocol feature switch that moves a network to the v2 sign-bytes. */
    public static final String PQC_SIGN_BYTES_V2_FEATURE = "pqc-sign-bytes-v2";

    /** REST path prefix of the applied-plan query; the plan name follows it. */
    public static final String APPLIED_PLAN_PATH_PREFIX = "/cosmos/upgrade/v1beta1/applied_plan/";

    /**
     * REST path of the applied-plan query for the PRIMARY name
     * {@link SignBytes#SIGN_BYTES_V2_UPGRADE}. Kept for callers that had it; the
     * resolver itself walks every name via {@link #appliedPlanPath(String)}.
     */
    public static final String APPLIED_PLAN_PATH =
            APPLIED_PLAN_PATH_PREFIX + SignBytes.SIGN_BYTES_V2_UPGRADE;

    /** REST path of the applied-plan query for one upgrade plan name. */
    public static String appliedPlanPath(String upgradeName) {
        return APPLIED_PLAN_PATH_PREFIX + upgradeName;
    }

    /**
     * Fetches the protocol features and applied-plan JSON from a REST endpoint.
     * Pluggable for tests.
     */
    @FunctionalInterface
    public interface PlanFetcher {
        /** Return the parsed JSON of {@code GET {restUrl}{path}}; throw on failure. */
        JsonNode get(String restUrl, String path) throws Exception;
    }

    /** Thrown when the version cannot be determined (no REST URL, or the query failed). */
    public static final class SignBytesResolutionException extends RuntimeException {
        public SignBytesResolutionException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    private static final class Entry {
        final SignBytes.Version version;
        final long expiresAt;

        Entry(SignBytes.Version version, long expiresAt) {
            this.version = version;
            this.expiresAt = expiresAt;
        }
    }

    private static final SignBytesResolver SHARED = new SignBytesResolver();

    /** The process-wide resolver used when a caller does not supply one. */
    public static SignBytesResolver shared() {
        return SHARED;
    }

    private final PlanFetcher fetcher;
    private final long ttlMs;
    private final LongSupplier clock;
    private final Map<String, Entry> cache = new ConcurrentHashMap<>();

    /** A resolver using the SDK HTTP transport and the default 60 s TTL. */
    public SignBytesResolver() {
        this(defaultFetcher(new Http.Options()), DEFAULT_TTL_MS, System::currentTimeMillis);
    }

    /** A resolver using the SDK HTTP transport and a custom TTL (ms; 0 disables caching). */
    public SignBytesResolver(long ttlMs) {
        this(defaultFetcher(new Http.Options()), ttlMs, System::currentTimeMillis);
    }

    /** Fully configurable resolver (custom fetcher, TTL in ms, and clock in ms). */
    public SignBytesResolver(PlanFetcher fetcher, long ttlMs, LongSupplier clock) {
        this.fetcher = Objects.requireNonNull(fetcher, "fetcher");
        this.ttlMs = ttlMs;
        this.clock = Objects.requireNonNull(clock, "clock");
    }

    /** The default fetcher: {@link Http#getJson} with the given transport options. */
    public static PlanFetcher defaultFetcher(Http.Options options) {
        return (restUrl, path) -> Http.getJson(Http.joinUrl(restUrl, path), null, options);
    }

    /** {@link #resolve(SignBytes.Mode, String, String, boolean)} without forcing a refresh. */
    public SignBytes.Version resolve(SignBytes.Mode mode, String chainId, String restUrl) {
        return resolve(mode, chainId, restUrl, false);
    }

    /**
     * Resolve the sign-bytes version.
     *
     * @param mode AUTO, V1 or V2 ({@code null} = AUTO).
     * @param chainId the Cosmos chain id the transaction is signed for.
     * @param restUrl the network's REST (LCD) endpoint; required only for AUTO on a
     *     legacy chain.
     * @param forceRefresh ignore (and replace) any cached answer.
     * @throws SignBytesResolutionException when AUTO on a legacy chain cannot be
     *     answered (no {@code restUrl}, or the protocol features could not answer and
     *     an applied-plan query failed: transport failure, unparsable response).
     */
    public SignBytes.Version resolve(
            SignBytes.Mode mode, String chainId, String restUrl, boolean forceRefresh) {
        SignBytes.Mode m = mode == null ? SignBytes.Mode.AUTO : mode;
        SignBytes.Version explicit = m.explicitVersion();
        if (explicit != null) {
            return explicit;
        }
        if (!SignBytes.isLegacyChain(chainId)) {
            return SignBytes.Version.V2;
        }
        if (restUrl == null || restUrl.isBlank()) {
            throw new SignBytesResolutionException(
                    "cannot decide the hybrid sign-bytes version for \""
                            + chainId
                            + "\" without asking the network whether one of "
                            + SignBytes.upgradeNames()
                            + " is applied: pass restUrl, or an explicit sign-bytes"
                            + " version (V1 or V2)",
                    null);
        }
        String key = restUrl + "\u0000" + chainId;
        long now = clock.getAsLong();
        if (!forceRefresh) {
            Entry e = cache.get(key);
            if (e != null && now < e.expiresAt) {
                return e.version;
            }
        }
        SignBytes.Version v = fetchFeaturesVersion(restUrl);
        if (v == null) {
            v = SignBytes.versionFor(chainId, fetchAppliedHeight(restUrl));
        }
        if (ttlMs > 0) {
            cache.put(key, new Entry(v, now + ttlMs));
        } else {
            cache.remove(key);
        }
        return v;
    }

    /** Drop every cached answer. */
    public void clearCache() {
        cache.clear();
    }

    /** Drop the cached answer for one {@code (restUrl, chainId)}. */
    public void invalidate(String restUrl, String chainId) {
        cache.remove(restUrl + "\u0000" + chainId);
    }

    /**
     * The version the node reports through its protocol feature switches, or
     * {@code null} when they cannot answer (route not served, request failed,
     * unexpected or empty payload); the caller then asks the upgrade plans.
     */
    private SignBytes.Version fetchFeaturesVersion(String restUrl) {
        JsonNode res;
        try {
            res = fetcher.get(restUrl, ProtocolFeatures.PATH);
        } catch (Exception e) {
            return null;
        }
        return versionFromProtocolFeatures(res);
    }

    /**
     * The version a {@code protocol_features} payload implies: v2 when
     * {@link #PQC_SIGN_BYTES_V2_FEATURE} is listed and enabled, v1 when the payload
     * lists features and that one is disabled or absent, {@code null} when it is not
     * an object, lists no features or cannot be parsed.
     */
    public static SignBytes.Version versionFromProtocolFeatures(JsonNode body) {
        if (body == null || !body.isObject()) {
            return null;
        }
        ProtocolFeatures parsed;
        try {
            parsed = ProtocolFeatures.of(body);
        } catch (RuntimeException e) {
            return null;
        }
        if (parsed.features.isEmpty()) {
            return null;
        }
        return parsed.isEnabled(PQC_SIGN_BYTES_V2_FEATURE)
                ? SignBytes.Version.V2
                : SignBytes.Version.V1;
    }

    /**
     * Ask the network about EVERY name in {@link SignBytes#SIGN_BYTES_V2_UPGRADES} and
     * return the first height greater than zero, or 0 when none of the plans is
     * applied. A failed query throws: it is never read as "not applied".
     */
    private long fetchAppliedHeight(String restUrl) {
        for (String name : SignBytes.SIGN_BYTES_V2_UPGRADES) {
            long height = fetchAppliedHeight(restUrl, name);
            if (height > 0) {
                return height;
            }
        }
        return 0L;
    }

    /** The applied height of one plan name (0 when that plan is not applied). */
    private long fetchAppliedHeight(String restUrl, String upgradeName) {
        JsonNode res;
        try {
            res = fetcher.get(restUrl, appliedPlanPath(upgradeName));
        } catch (Exception e) {
            throw new SignBytesResolutionException(
                    "cannot ask "
                            + restUrl
                            + " whether "
                            + upgradeName
                            + " is applied (of "
                            + SignBytes.upgradeNames()
                            + "; "
                            + e.getMessage()
                            + "); pass an explicit sign-bytes version (V1 or V2)",
                    e);
        }
        if (res == null || res.isNull() || res.isMissingNode()) {
            return 0L;
        }
        if (!res.isObject()) {
            throw new SignBytesResolutionException(
                    "unexpected applied_plan response for "
                            + upgradeName
                            + " from "
                            + restUrl
                            + ": "
                            + res,
                    null);
        }
        JsonNode h = res.get("height");
        if (h == null || h.isNull()) {
            return 0L;
        }
        try {
            if (h.isNumber()) {
                return h.asLong();
            }
            String str = h.asText().trim();
            return str.isEmpty() ? 0L : Long.parseLong(str);
        } catch (NumberFormatException e) {
            throw new SignBytesResolutionException(
                    "unparsable applied_plan height for "
                            + upgradeName
                            + " from "
                            + restUrl
                            + ": "
                            + h,
                    e);
        }
    }
}
