package io.github.qorechain.crossvm;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.protobuf.Any;
import com.google.protobuf.ByteString;
import com.google.protobuf.CodedInputStream;
import com.google.protobuf.InvalidProtocolBufferException;
import io.github.qorechain.messages.QorechainMessages;
import io.github.qorechain.messages.TypedMessage;
import io.github.qorechain.query.QorClient;
import io.github.qorechain.tx.Broadcaster;
import io.github.qorechain.tx.NativeTx;
import io.github.qorechain.tx.StdFee;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * High-level helper for QoreChain's unified cross-VM call surface
 * ({@code x/crossvm}). Wraps the {@code MsgCrossVMCall} composer with
 * build / sign / broadcast convenience and an atomic multi-call mode.
 *
 * <p>A cross-VM call routes a {@code payload} to a contract on a
 * {@code targetVm}. The three supported VM identifiers are exposed as
 * {@link VMType} constants.
 *
 * <p>A call executes INSIDE the transaction and returns the callee's answer:
 * {@link CallResponse} carries {@code executed}, {@code data} (the return value)
 * and {@code gasUsed} alongside the chain-assigned message id. Set
 * {@link CallOptions#async} to queue the call for a later {@code ProcessQueue}
 * dispatch instead — nothing has run yet then, and only the message id is
 * meaningful.
 *
 * <p>Payload handling: callers supply either a raw {@code byte[]} (used as-is)
 * or a {@code cosmwasm} object that is serialized to UTF-8 JSON via Jackson.
 * ABI-encoding of high-level arguments for EVM targets is not performed here;
 * for EVM targets supply the already-encoded call data as a raw {@code byte[]}.
 */
public final class CrossVMClient {

    /** Supported cross-VM target/source VM identifiers (wire strings). */
    public static final class VMType {
        private VMType() {}

        /** The EVM execution environment. */
        public static final String EVM = "evm";
        /** The CosmWasm execution environment. */
        public static final String COSMWASM = "cosmwasm";
        /** The SVM (Solana VM) execution environment. */
        public static final String SVM = "svm";
    }

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** Per-call cross-VM options. */
    public static final class CallOptions {
        /** Sender bech32 address (defaults to the signing context's sender). */
        public String sender;
        /**
         * Source VM (default {@link VMType#EVM}).
         *
         * <p>The chain IGNORES this on input — it derives the origin lane from the
         * execution context, because a caller describing itself is not evidence of what
         * it is. It is still sent (and still accepted) so older clients keep working;
         * setting it changes nothing about how the call is routed or charged.
         */
        public String sourceVm = VMType.EVM;
        /** Target VM ({@link VMType}). */
        public String targetVm;
        /** Target contract identifier/address on the target VM. */
        public String targetContract;
        /** Funds to attach to the call. */
        public List<StdFee.Coin> funds = new ArrayList<>();
        /**
         * Queue the call instead of executing it, leaving it for a later
         * {@code ProcessQueue} dispatch.
         *
         * <p>Default {@code false}: execute now and return the callee's answer, which is
         * what a caller that needs the result requires. When {@code true}, the response
         * carries {@code executed == false}, no {@code data} and no {@code gasUsed} — only
         * the message id, which {@link #getMessage} can be polled with.
         */
        public boolean async = false;

        /** Raw payload bytes (mutually exclusive with {@link #cosmwasm}). */
        public byte[] payload;
        /** A CosmWasm message object serialized to UTF-8 JSON (mutually exclusive with {@link #payload}). */
        public Object cosmwasm;
    }

    /**
     * The signing / broadcasting context shared across calls: secp256k1 keys,
     * chain id, account identity, and fee. Mirrors {@link NativeTx.Options}
     * minus the per-call messages.
     */
    public static final class Signer {
        public String sender;
        public byte[] secp256k1PrivateKey;
        public byte[] secp256k1PublicKey;
        public StdFee fee;
        public String memo = "";
        public String chainId;
        public long accountNumber;
        public long sequence;
        public long timeoutHeight = 0L;
        /**
         * Broadcast mode for {@link #call} / {@link #callAtomic} (default
         * {@link Broadcaster.Mode#SYNC}).
         *
         * <p>Only {@link Broadcaster.Mode#COMMIT} waits for the tx to land, so only a
         * COMMIT broadcast comes back carrying the per-message responses that
         * {@link #decodeCallResponses(Broadcaster.Result)} reads. With SYNC the call has
         * not run yet when the result returns; poll {@link #getMessage} instead.
         */
        public Broadcaster.Mode broadcastMode = Broadcaster.Mode.SYNC;
    }

    /** The type URL of the response the chain returns for a {@code MsgCrossVMCall}. */
    public static final String CALL_RESPONSE_TYPE_URL =
            "/qorechain.crossvm.v1.MsgCrossVMCallResponse";

    /** One decoded {@code MsgCrossVMCallResponse}. */
    public static final class CallResponse {
        /** The cross-VM message id assigned by the chain. */
        public final String messageId;
        /**
         * Whether the callee actually ran inside this transaction. {@code false} for a
         * queued ({@link CallOptions#async}) call, whose result is not known yet.
         */
        public final boolean executed;
        /** The callee's return value; empty when the call was queued. */
        public final byte[] data;
        /** Gas consumed by the callee; {@code 0} when the call was queued. */
        public final long gasUsed;

        CallResponse(String messageId, boolean executed, byte[] data, long gasUsed) {
            this.messageId = messageId;
            this.executed = executed;
            this.data = data;
            this.gasUsed = gasUsed;
        }
    }

    private final Signer signer;
    private final Broadcaster broadcaster;
    private final QorClient qor;

    /**
     * @param signer the signing context (keys, chain id, account, fee).
     * @param broadcaster the consensus-RPC broadcaster used by {@link #call} / {@link #callAtomic}.
     * @param qor optional {@link QorClient} backing {@link #getMessage}; may be {@code null}
     *     if {@code getMessage} is not used.
     */
    public CrossVMClient(Signer signer, Broadcaster broadcaster, QorClient qor) {
        this.signer = signer;
        this.broadcaster = broadcaster;
        this.qor = qor;
    }

    /** Build a single {@code MsgCrossVMCall} {@link TypedMessage} (no signing). */
    public TypedMessage buildCall(CallOptions opts) {
        String sender = opts.sender != null ? opts.sender : (signer != null ? signer.sender : null);
        String sourceVm = opts.sourceVm != null ? opts.sourceVm : VMType.EVM;

        qorechain.crossvm.v1.Tx.MsgCrossVMCall.Builder msg =
                qorechain.crossvm.v1.Tx.MsgCrossVMCall.newBuilder()
                        .setSender(sender == null ? "" : sender)
                        .setSourceVm(sourceVm)
                        .setTargetVm(opts.targetVm == null ? "" : opts.targetVm)
                        .setTargetContract(opts.targetContract == null ? "" : opts.targetContract)
                        .setPayload(ByteString.copyFrom(resolvePayload(opts)))
                        .setAsync(opts.async);

        if (opts.funds != null) {
            for (StdFee.Coin c : opts.funds) {
                msg.addFunds(
                        cosmos.base.v1beta1.CoinOuterClass.Coin.newBuilder()
                                .setDenom(c.denom)
                                .setAmount(c.amount)
                                .build());
            }
        }
        return QorechainMessages.crossvm.crossVmCall(msg.build());
    }

    /** Build, sign, and broadcast a single cross-VM call (SYNC mode). */
    public Broadcaster.Result call(CallOptions opts) {
        return callAtomic(List.of(opts));
    }

    /**
     * Build, sign, and broadcast ONE transaction containing N
     * {@code MsgCrossVMCall} messages — all-or-nothing atomic execution.
     */
    public Broadcaster.Result callAtomic(List<CallOptions> opts) {
        List<TypedMessage> messages = new ArrayList<>(opts.size());
        for (CallOptions o : opts) {
            messages.add(buildCall(o));
        }

        NativeTx.Options txOpts = new NativeTx.Options();
        txOpts.messages = messages;
        txOpts.secp256k1PrivateKey = signer.secp256k1PrivateKey;
        txOpts.secp256k1PublicKey = signer.secp256k1PublicKey;
        txOpts.fee = signer.fee;
        txOpts.memo = signer.memo;
        txOpts.chainId = signer.chainId;
        txOpts.accountNumber = signer.accountNumber;
        txOpts.sequence = signer.sequence;
        txOpts.timeoutHeight = signer.timeoutHeight;

        NativeTx.Built built = NativeTx.buildAndSign(txOpts);
        Broadcaster.Mode mode =
                signer.broadcastMode == null ? Broadcaster.Mode.SYNC : signer.broadcastMode;
        return broadcaster.broadcast(built.txRawBytes, mode);
    }

    /**
     * Decode the {@code MsgCrossVMCallResponse} entries carried by a broadcast result.
     *
     * <p>Returns an empty list when the node returned no per-message responses — a
     * {@code sync}/{@code async} broadcast returns before the messages have run, so set
     * {@link Signer#broadcastMode} to {@link Broadcaster.Mode#COMMIT} to get them.
     * Responses of other types (a mixed transaction body) are skipped.
     */
    public static List<CallResponse> decodeCallResponses(Broadcaster.Result result) {
        return result == null ? List.of() : decodeCallResponses(result.data);
    }

    /**
     * Decode the {@code MsgCrossVMCallResponse} entries out of a tx result's {@code data}
     * — a protobuf {@code TxMsgData} whose field 2 holds the per-message response
     * {@code Any}s.
     *
     * <p>{@code TxMsgData} is read field-by-field rather than through a generated class
     * because the SDK does not vendor {@code cosmos.base.abci}; unknown fields (including
     * the deprecated field-1 list) are skipped.
     */
    public static List<CallResponse> decodeCallResponses(byte[] txResultData) {
        if (txResultData == null || txResultData.length == 0) {
            return List.of();
        }
        List<CallResponse> out = new ArrayList<>();
        try {
            CodedInputStream in = CodedInputStream.newInstance(txResultData);
            while (true) {
                int tag = in.readTag();
                if (tag == 0) {
                    break;
                }
                // field 2 (msg_responses), wire type 2 (length-delimited).
                if (tag == ((2 << 3) | 2)) {
                    Any any = Any.parseFrom(in.readBytes());
                    if (CALL_RESPONSE_TYPE_URL.equals(any.getTypeUrl())) {
                        out.add(decodeCallResponse(any.getValue().toByteArray()));
                    }
                } else if (!in.skipField(tag)) {
                    break;
                }
            }
        } catch (IOException e) {
            throw new IllegalArgumentException("failed to decode tx result data (TxMsgData)", e);
        }
        return out;
    }

    /** Decode one {@code MsgCrossVMCallResponse} from its raw protobuf bytes. */
    public static CallResponse decodeCallResponse(byte[] responseBytes) {
        try {
            qorechain.crossvm.v1.Tx.MsgCrossVMCallResponse r =
                    qorechain.crossvm.v1.Tx.MsgCrossVMCallResponse.parseFrom(responseBytes);
            return new CallResponse(
                    r.getMessageId(), r.getExecuted(), r.getData().toByteArray(), r.getGasUsed());
        } catch (InvalidProtocolBufferException e) {
            throw new IllegalArgumentException("failed to decode MsgCrossVMCallResponse", e);
        }
    }

    /**
     * Fetch a cross-VM message by id via {@code qor_getCrossVMMessage}.
     *
     * @throws IllegalStateException if this client was constructed without a {@link QorClient}.
     */
    public JsonNode getMessage(String id) {
        if (qor == null) {
            throw new IllegalStateException(
                    "CrossVMClient was constructed without a QorClient; cannot getMessage");
        }
        return qor.getCrossVmMessage(id);
    }

    /** Resolve the call payload: raw bytes, or Jackson-serialized cosmwasm JSON (UTF-8). */
    static byte[] resolvePayload(CallOptions opts) {
        if (opts.payload != null && opts.cosmwasm != null) {
            throw new IllegalArgumentException(
                    "provide either payload or cosmwasm, not both");
        }
        if (opts.payload != null) {
            return opts.payload;
        }
        if (opts.cosmwasm != null) {
            try {
                return MAPPER.writeValueAsBytes(opts.cosmwasm);
            } catch (JsonProcessingException e) {
                throw new IllegalArgumentException("failed to serialize cosmwasm payload to JSON", e);
            }
        }
        return new byte[0];
    }

    /** The UTF-8 JSON bytes a {@code cosmwasm} payload would serialize to (for inspection/tests). */
    public static byte[] encodeCosmwasmPayload(Object cosmwasm) {
        try {
            return MAPPER.writeValueAsBytes(cosmwasm);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("failed to serialize cosmwasm payload to JSON", e);
        }
    }
}
