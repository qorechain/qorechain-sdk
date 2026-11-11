package io.github.qorechain.messages;

import com.fasterxml.jackson.databind.JsonNode;
import com.google.protobuf.Descriptors.FieldDescriptor;
import com.google.protobuf.Message;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Support for the governance {@code MsgUpdateParams} composers, which replace a
 * module's parameters wholesale (a field left out is set to zero).
 *
 * <p>A built proto3 message cannot tell a field that was left out from one set to
 * zero, so the composers treat every field still at its zero value ({@code 0},
 * {@code ""}, {@code false}, an empty list) as MISSING unless the caller names it in
 * {@code explicitZero}. The {@code ...FromCurrent} builders copy every field from the
 * chain's params query, so they never trip this.
 */
public final class ParamsUpdates {

    private ParamsUpdates() {}

    private static final com.fasterxml.jackson.databind.ObjectMapper MAPPER =
            new com.fasterxml.jackson.databind.ObjectMapper();

    /**
     * The fields of {@code msg} (except those in {@code skip}) that are at their zero
     * value and not listed in {@code explicitZero}.
     */
    public static List<String> missingFields(Message msg, Set<String> skip, Set<String> explicitZero) {
        List<String> out = new ArrayList<>();
        for (FieldDescriptor f : msg.getDescriptorForType().getFields()) {
            String name = f.getName();
            if (skip.contains(name)) continue;
            boolean zero;
            if (f.isRepeated()) {
                zero = msg.getRepeatedFieldCount(f) == 0;
            } else if (f.getJavaType() == FieldDescriptor.JavaType.MESSAGE) {
                zero = !msg.hasField(f);
            } else {
                zero = msg.getField(f).equals(f.getDefaultValue());
            }
            if (zero && (explicitZero == null || !explicitZero.contains(name))) {
                out.add(name);
            }
        }
        return out;
    }

    /**
     * Throw naming the missing fields ({@link #missingFields}).
     *
     * @throws IllegalArgumentException when any field is missing.
     */
    static void requireAll(String what, Message msg, Set<String> skip, Set<String> explicitZero, String hint) {
        if (explicitZero != null) {
            Set<String> known = new HashSet<>();
            for (FieldDescriptor f : msg.getDescriptorForType().getFields()) known.add(f.getName());
            for (String z : explicitZero) {
                if (!known.contains(z)) {
                    throw new IllegalArgumentException(what + ": explicitZero names unknown field \"" + z + "\"");
                }
            }
        }
        List<String> missing = missingFields(msg, skip, explicitZero);
        if (!missing.isEmpty()) {
            throw new IllegalArgumentException(what + " replaces every parameter, and these are not set: "
                    + String.join(", ", missing) + ". Copy the current values with " + hint
                    + ", or name the fields meant to be zero, empty or false in explicitZero.");
        }
    }

    /** Set every field of {@code b} named in {@code src} (JSON, snake_case or camelCase names); return the names set. */
    static Set<String> applyJson(Message.Builder b, JsonNode src, Set<String> skip) {
        Set<String> given = new HashSet<>();
        if (src == null || !src.isObject()) return given;
        for (FieldDescriptor f : b.getDescriptorForType().getFields()) {
            if (skip.contains(f.getName())) continue;
            JsonNode v = src.get(f.getName());
            if (v == null) v = src.get(f.getJsonName());
            if (v == null || v.isNull()) continue;
            setField(b, f, v);
            given.add(f.getName());
        }
        return given;
    }

    /** Apply {@code changes} (proto field name to value) to {@code b}; unknown names are refused. */
    static Set<String> applyChanges(String what, Message.Builder b, Map<String, ?> changes) {
        Set<String> given = new HashSet<>();
        if (changes == null) return given;
        for (Map.Entry<String, ?> e : changes.entrySet()) {
            FieldDescriptor f = b.getDescriptorForType().findFieldByName(e.getKey());
            if (f == null) {
                throw new IllegalArgumentException(what + ": unknown parameter \"" + e.getKey() + "\"");
            }
            b.clearField(f);
            Object v = e.getValue();
            if (v instanceof Collection<?> c) {
                if (!f.isRepeated()) {
                    throw new IllegalArgumentException(what + ": parameter " + f.getName() + " is not a list");
                }
                for (Object o : c) {
                    b.addRepeatedField(f, o instanceof Message ? o : scalarOrMessage(b, f, toTree(o)));
                }
            } else if (v != null) {
                if (f.isRepeated()) {
                    throw new IllegalArgumentException(what + ": parameter " + f.getName() + " is a list");
                }
                b.setField(f, v instanceof Message ? v : scalarOrMessage(b, f, toTree(v)));
            }
            given.add(f.getName());
        }
        return given;
    }

    private static void setField(Message.Builder b, FieldDescriptor f, JsonNode v) {
        if (f.isRepeated()) {
            if (!v.isArray()) throw new IllegalArgumentException("parameter " + f.getName() + " is not a list");
            for (JsonNode e : v) b.addRepeatedField(f, scalarOrMessage(b, f, e));
            return;
        }
        b.setField(f, scalarOrMessage(b, f, v));
    }

    private static JsonNode toTree(Object o) {
        return MAPPER.valueToTree(o);
    }

    private static Object scalarOrMessage(Message.Builder parent, FieldDescriptor f, JsonNode v) {
        String s = v.asText().trim();
        try {
            switch (f.getJavaType()) {
                case STRING:
                    return v.asText();
                case BOOLEAN:
                    if (v.isBoolean()) return v.asBoolean();
                    if ("true".equals(s) || "false".equals(s)) return Boolean.parseBoolean(s);
                    throw new IllegalArgumentException("not a boolean");
                case LONG:
                    return isUnsigned(f) ? Long.parseUnsignedLong(s) : Long.parseLong(s);
                case INT:
                    return isUnsigned(f) ? Integer.parseUnsignedInt(s) : Integer.parseInt(s);
                case MESSAGE: {
                    Message.Builder nb = parent.newBuilderForField(f);
                    applyJson(nb, v, Set.of());
                    return nb.build();
                }
                default:
                    throw new IllegalArgumentException("unsupported type " + f.getJavaType());
            }
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException(
                    "parameter " + f.getName() + ": \"" + v + "\" is not valid (" + e.getMessage() + ")");
        }
    }

    private static boolean isUnsigned(FieldDescriptor f) {
        return f.getType() == FieldDescriptor.Type.UINT64 || f.getType() == FieldDescriptor.Type.UINT32
                || f.getType() == FieldDescriptor.Type.FIXED64 || f.getType() == FieldDescriptor.Type.FIXED32;
    }

    /** All field names of a message type, to mark every field of a copied params answer as given. */
    static Set<String> allFieldNames(Message.Builder b) {
        Set<String> out = new HashSet<>();
        for (FieldDescriptor f : b.getDescriptorForType().getFields()) out.add(f.getName());
        return out;
    }
}
