package io.github.qorechain.query;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;

/**
 * The chain's protocol feature switches (chain v3.2.4,
 * {@code /qorechain/pqc/v1/protocol_features}).
 *
 * <p>Each consensus change ships behind a named switch that a governance upgrade
 * turns on at its height. Reading the switch tells a client whether the network
 * enforces a rule today, without inferring it from upgrade plan names. Networks
 * below v3.2.4 do not serve the route: use {@link ChainUpgrades#isApplied} there.
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
}
