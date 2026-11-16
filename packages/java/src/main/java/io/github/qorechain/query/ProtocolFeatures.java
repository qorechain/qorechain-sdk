package io.github.qorechain.query;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;

/**
 * The chain's protocol feature switches (chain v3.2.4,
 * {@code /qorechain/pqc/v1/protocol_features}).
 *
 * <p>Each consensus change ships behind a named switch that a governance upgrade
 * turns on at its height. Reading the switch tells a client whether the network
 * enforces a rule today, without inferring it from upgrade plan names. Networks
 * below v3.2.4 do not serve the route: use {@link ChainUpgrades#isApplied} there.
 *
 * <p>{@link #lookup} classifies one switch for a client that must pick a wire form
 * ({@link State}): read the switch first, fall back to the upgrade plans ONLY when the
 * node definitively does not serve the switch, and fail loudly on anything else. A
 * fork, a fresh devnet or a fest chain answers {@code applied_plan} height 0 while it
 * runs the new rules, so a silent fallback on a network hiccup picks the old form and
 * the chain refuses the transaction.
 */
public final class ProtocolFeatures {

    /** One switch. */
    public static final class Feature {
        public final String name;
        /** On at the current height. */
        public final boolean enabled;
        /** False for a switch a newer release enabled and this node does not know. */
        public final boolean known;
        /** Carried by the node's binary but not enabled by any release yet. */
        public final boolean staged;

        public Feature(String name, boolean enabled, boolean known, boolean staged) {
            this.name = name;
            this.enabled = enabled;
            this.known = known;
            this.staged = staged;
        }
    }

    /** Every switch the node knows. */
    public final List<Feature> features;
    /** The height the answer was read at. */
    public final long height;

    public ProtocolFeatures(List<Feature> features, long height) {
        this.features = List.copyOf(features);
        this.height = height;
    }

    /** The REST path of the query. */
    public static final String PATH = "/qorechain/pqc/v1/protocol_features";

    /** Decode the REST body. */
    public static ProtocolFeatures of(JsonNode body) {
        if (body == null || body.isNull()) {
            throw new IllegalArgumentException("protocol_features: empty response");
        }
        List<Feature> out = new ArrayList<>();
        JsonNode a = body.get("features");
        if (a != null && a.isArray()) {
            for (JsonNode x : a) {
                JsonNode n = x.get("name");
                out.add(
                        new Feature(
                                n != null && n.isTextual() ? n.asText() : "",
                                isTrue(x, "enabled"),
                                isTrue(x, "known"),
                                isTrue(x, "staged")));
            }
        }
        JsonNode h = body.get("height");
        long height = 0L;
        if (h != null && !h.isNull() && !h.asText().trim().isEmpty()) {
            try {
                height = Long.parseLong(h.asText().trim());
            } catch (NumberFormatException e) {
                throw new IllegalArgumentException("protocol_features height is not an integer: \"" + h.asText() + "\"");
            }
        }
        return new ProtocolFeatures(out, height);
    }

    /** Read the network's protocol feature switches. */
    public static ProtocolFeatures fetch(RestClient rest) {
        return of(rest.get(PATH));
    }

    /** Whether the switch {@code name} is on in this answer. A switch the node does not list is off. */
    public boolean isEnabled(String name) {
        for (Feature f : features) {
            if (f.name.equals(name) && f.enabled) {
                return true;
            }
        }
        return false;
    }

    /** Whether the switch {@code name} is on. A switch the node does not list is off. */
    public static boolean isEnabled(RestClient rest, String name) {
        return fetch(rest).isEnabled(name);
    }

    private static boolean isTrue(JsonNode node, String field) {
        JsonNode v = node.get(field);
        return v != null && v.isBoolean() && v.asBoolean();
    }

    // ---- classification of one switch ----

    /** What the node said about one switch. */
    public enum State {
        /** HTTP 200, the switch is listed and on. */
        ENABLED,
        /** HTTP 200, the switch is listed and off. */
        DISABLED,
        /**
         * The node definitively does not serve the answer: HTTP 404 or 501 (route not
         * implemented), an empty feature list, or a list without this switch. The
         * caller may fall back to the upgrade plans.
         */
        NOT_SERVED,
        /**
         * The node could not be asked: transport failure, timeout, HTTP 429, HTTP 5xx
         * other than 501, any other refusal, or a body that cannot be read. The caller
         * must NOT fall back and must NOT guess.
         */
        ERROR
    }

    /** The answer of {@link #lookup} for one switch. */
    public static final class Lookup {
        public final String name;
        public final State state;
        /** The failure behind {@link State#ERROR}; {@code null} otherwise. */
        public final Exception error;

        public Lookup(String name, State state, Exception error) {
            this.name = name;
            this.state = state;
            this.error = error;
        }

        /** Whether the answer is one the caller may use or fall back from (not an error). */
        public boolean isDefinitive() {
            return state != State.ERROR;
        }

        /** A short reason for an error message. */
        public String reason() {
            if (error == null) {
                return state.name();
            }
            String m = error.getMessage();
            return m == null || m.isEmpty() ? error.getClass().getSimpleName() : m;
        }
    }

    /** Thrown when a switch must be read and the node could not be asked. */
    public static final class FeatureQueryException extends RuntimeException {
        public FeatureQueryException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    /**
     * Classify a switch from a body the node answered with HTTP 200: {@link State#ENABLED}
     * or {@link State#DISABLED} when listed, {@link State#NOT_SERVED} when the list is
     * empty (or missing, as the gateway renders an empty list) or does not name it,
     * {@link State#ERROR} when the body is not a feature list.
     */
    public static Lookup classify(String name, JsonNode body) {
        if (body == null || body.isNull() || body.isMissingNode() || !body.isObject()) {
            return new Lookup(name, State.ERROR, new IllegalArgumentException(
                    "protocol_features: unexpected response: " + body));
        }
        JsonNode list = body.get("features");
        if (list != null && !list.isNull() && !list.isArray()) {
            return new Lookup(name, State.ERROR, new IllegalArgumentException(
                    "protocol_features: features is not a list: " + list));
        }
        ProtocolFeatures parsed;
        try {
            parsed = of(body);
        } catch (RuntimeException e) {
            return new Lookup(name, State.ERROR, e);
        }
        for (Feature f : parsed.features) {
            if (f.name.equals(name)) {
                return new Lookup(name, f.enabled ? State.ENABLED : State.DISABLED, null);
            }
        }
        return new Lookup(name, State.NOT_SERVED, null);
    }

    /**
     * Classify a failed request: HTTP 404 or 501 is {@link State#NOT_SERVED} (a node
     * below v3.2.4); everything else is {@link State#ERROR}.
     */
    public static Lookup classifyFailure(String name, Exception failure) {
        Throwable t = failure;
        while (t != null) {
            if (t instanceof Http.QoreHttpException) {
                int status = ((Http.QoreHttpException) t).status;
                if (status == 404 || status == 501) {
                    return new Lookup(name, State.NOT_SERVED, null);
                }
                break;
            }
            t = t.getCause();
        }
        return new Lookup(name, State.ERROR, failure);
    }

    /** Ask {@code fetch} for the features body and classify {@code name}. Never throws. */
    public static Lookup lookup(String name, Callable<JsonNode> fetch) {
        JsonNode body;
        try {
            body = fetch.call();
        } catch (Exception e) {
            return classifyFailure(name, e);
        }
        return classify(name, body);
    }

    /** {@link #lookup(String, Callable)} over {@code rest}. */
    public static Lookup lookup(RestClient rest, String name) {
        return lookup(name, () -> rest.get(PATH));
    }
}
