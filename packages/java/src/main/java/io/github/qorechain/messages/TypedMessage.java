package io.github.qorechain.messages;

import com.google.protobuf.Message;

/**
 * A protobuf message paired with its Cosmos type URL — the unit transactions are
 * built from. Produced by the typed composers in {@link QorechainMessages} and
 * {@link CosmosMessages}, and packed into an {@code Any} by {@link Messages#pack}.
 */
public final class TypedMessage {
    /** The on-chain type URL, e.g. {@code /qorechain.amm.v1.MsgCreatePool}. */
    public final String typeUrl;
    /** The concrete protobuf message. */
    public final Message message;

    public TypedMessage(String typeUrl, Message message) {
        this.typeUrl = typeUrl;
        this.message = message;
    }
}
