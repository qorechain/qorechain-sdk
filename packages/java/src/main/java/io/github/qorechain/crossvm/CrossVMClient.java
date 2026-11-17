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
import io.github.qorechain.query.ProtocolFeatures;
import io.github.qorechain.query.QorClient;
import io.github.qorechain.query.RestClient;
import io.github.qorechain.tx.AutoGas;
import io.github.qorechain.tx.GasPrice;
import io.github.qorechain.tx.Broadcaster;
import io.github.qorechain.tx.NativeTx;
import io.github.qorechain.tx.StdFee;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

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
 * dispatch instead - nothing has run yet then, and only the message id is
 * meaningful.
 *
 * <p>Payload handling: callers supply either a raw {@code byte[]} (used as-is)
 * or a {@code cosmwasm} object that is serialized to UTF-8 JSON via Jackson.
 * ABI-encoding of high-level arguments for EVM targets is not performed here;
 * for EVM targets supply the already-encoded call data as a raw {@code byte[]}.
 *
 * <p>{@link CallOptions#asyncGasLimit} (field 8) and {@link CallOptions#asyncMaxFactor}
 * (field 9) exist only from chain v3.2.8; an older node refuses the whole transaction
 * with a protobuf parse error. {@link #buildCall} (and so {@link #call} /
 * {@link #callAtomic}) therefore checks the network's protocol feature switches before
 * a non-zero value goes into a message; see {@link #requireAsyncFieldsSupported}.
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

    /** The smallest non-zero {@link CallOptions#asyncGasLimit}. */
    public static final long MIN_ASYNC_GAS_LIMIT = 250_000L;
    /** The largest {@link CallOptions#asyncGasLimit}. */
    public static final long MAX_ASYNC_GAS_LIMIT = 10_000_000L;
    /** The default {@link CallOptions#asyncGasLimit} the chain applies for {@code 0}. */
    public static final long DEFAULT_ASYNC_GAS_LIMIT = 500_000L;

    /** The protocol feature switch that must be on for a non-zero {@link CallOptions#asyncGasLimit}. */
    public static final String ASYNC_GAS_PRICED_FEATURE = "crossvm-async-gas-priced";
    /** The protocol feature switch that must be on for a non-zero {@link CallOptions#asyncMaxFactor}. */
    public static final String ASYNC_ESCROW_FEATURE = "crossvm-async-escrow";
    /** How long a confirmed switch is trusted, in ms. */
    public static final long ASYNC_FEATURE_TTL_MS = 60_000L;

    /** Confirmed-on switches only, per {@code restUrl|feature}: expiry time in ms. */
    private static final Map<String, Long> ASYNC_FEATURE_CACHE = new ConcurrentHashMap<>();

    /** Forget the confirmed async switches (tests, network switches). */
    public static void clearAsyncFeatureCache() {
        ASYNC_FEATURE_CACHE.clear();
    }

    /**
     * Thrown before signing when a call sets {@link CallOptions#asyncGasLimit} or
     * {@link CallOptions#asyncMaxFactor} on a network that does not run chain v3.2.8.
     */
    public static final class AsyncFieldsNotSupportedException extends IllegalStateException {
        public AsyncFieldsNotSupportedException(String message) {
            super(message);
        }
    }

    /** Per-call cross-VM options. */
    public static final class CallOptions {
        /** Sender bech32 address (defaults to the signing context's sender). */
        public String sender;
        /**
         * Source VM. {@code null} (default) = {@link VMType#EVM}, or
         * {@link VMType#COSMWASM} when {@link #targetVm} is {@link VMType#EVM}
         * ({@link #defaultSourceVm}).
         *
         * <p>The chain does not use it for routing or charging: it derives the origin
         * lane from the execution context. It does validate it, though: a call whose
         * source equals its target is refused ("source and target VM must be
         * different"), so {@link CrossVMClient#buildCall} refuses that before signing.
         */
        public String sourceVm;
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
         * carries {@code executed == false}, no {@code data} and no {@code gasUsed} - only
         * the message id, which {@link #getMessage} can be polled with.
         */
        public boolean async = false;

        /**
         * For an {@link #async} call into CosmWasm only (chain v3.2.8): the contract
         * execution the queued call may use, in base gas units. {@code 0} = the chain
         * default (500,000); a set value is {@value #MIN_ASYNC_GAS_LIMIT} to
         * {@value #MAX_ASYNC_GAS_LIMIT}.
         *
         * <p>An async call holds an escrow of about {@code asyncGasLimit x factor x gas
         * price} (default about 0.2 QOR), refunded when it finishes, pays a queue-slot
         * fee, and a sender may have at most 100 pending calls.
         */
        public long asyncGasLimit = 0L;
        /**
         * For an {@link #async} call into CosmWasm only: the highest wasm congestion
         * factor the sender accepts, in millionths ({@code 1_000_000} = 1x). {@code 0} =
         * four times the factor at submission.
         */
        public long asyncMaxFactor = 0L;

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
        /**
         * The fee and gas limit. {@code null}: simulate against {@link #restUrl} and price
         * the result at {@link #gasPrice} (cross-VM gas varies: the first call of a
         * contract code in a block costs much more, so there is no fixed default). With
         * neither a fee nor a {@code restUrl} the call is refused.
         */
        public StdFee fee;
        /** The network's REST endpoint, for simulation when {@link #fee} is {@code null}. */
        public String restUrl;
        /** The gas price for a simulated fee (default {@link io.github.qorechain.tx.GasPrice#DEFAULT_GAS_PRICE}). */
        public String gasPrice;
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
        /**
         * Skip the chain v3.2.8 check of {@link CallOptions#asyncGasLimit} /
         * {@link CallOptions#asyncMaxFactor} (default {@code false}). Set it only when
         * you know the target network runs v3.2.8 or later and cannot give a
         * {@link #restUrl} (an offline build); an older node refuses the transaction.
         */
        public boolean skipAsyncFieldsCheck = false;
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

    /**
     * Build a single {@code MsgCrossVMCall} {@link TypedMessage} (no signing).
     *
     * <p>A non-zero {@link CallOptions#asyncGasLimit} / {@link CallOptions#asyncMaxFactor}
     * is checked against the network first ({@link #requireAsyncFieldsSupported} over
     * {@link Signer#restUrl}), unless {@link Signer#skipAsyncFieldsCheck} is set.
     *
     * @throws AsyncFieldsNotSupportedException when the network does not run v3.2.8, or
     *     there is no REST URL to ask.
     * @throws ProtocolFeatures.FeatureQueryException when the network could not be asked.
     */
    public TypedMessage buildCall(CallOptions opts) {
        validateAsyncOptions(opts);
        if (signer == null || !signer.skipAsyncFieldsCheck) {
            requireAsyncFieldsSupported(signer == null ? null : signer.restUrl, opts);
        }
        String sender = opts.sender != null ? opts.sender : (signer != null ? signer.sender : null);
        String sourceVm = resolveSourceVm(opts.sourceVm, opts.targetVm);

        qorechain.crossvm.v1.Tx.MsgCrossVMCall.Builder msg =
                qorechain.crossvm.v1.Tx.MsgCrossVMCall.newBuilder()
                        .setSender(sender == null ? "" : sender)
                        .setSourceVm(sourceVm)
                        .setTargetVm(opts.targetVm == null ? "" : opts.targetVm)
                        .setTargetContract(opts.targetContract == null ? "" : opts.targetContract)
                        .setPayload(ByteString.copyFrom(resolvePayload(opts)))
                        .setAsync(opts.async)
                        .setAsyncGasLimit(opts.asyncGasLimit)
                        .setAsyncMaxFactor(opts.asyncMaxFactor);

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
     * {@code MsgCrossVMCall} messages - all-or-nothing atomic execution.
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
        if (txOpts.fee == null) {
            if (signer.restUrl == null || signer.restUrl.isEmpty()) {
                throw new IllegalArgumentException(
                        "cross-VM calls need simulated gas or an explicit gas limit: set Signer.restUrl to"
                                + " simulate, or Signer.fee with a gas limit (there is no fixed default)");
            }
            txOpts.fee = new StdFee(List.of(), "0");
        }
        txOpts.memo = signer.memo;
        txOpts.chainId = signer.chainId;
        txOpts.accountNumber = signer.accountNumber;
        txOpts.sequence = signer.sequence;
        txOpts.timeoutHeight = signer.timeoutHeight;
        if (signer.fee == null) {
            NativeTx.Built sim = NativeTx.buildAndSign(txOpts);
            AutoGas.Estimate est = AutoGas.estimate(signer.restUrl, sim.txRawBytes, false, null, null, true);
            txOpts.fee = GasPrice.calculateFee(
                    est.gasWanted, signer.gasPrice == null ? GasPrice.DEFAULT_GAS_PRICE : signer.gasPrice);
        }

        NativeTx.Built built = NativeTx.buildAndSign(txOpts);
        Broadcaster.Mode mode =
                signer.broadcastMode == null ? Broadcaster.Mode.SYNC : signer.broadcastMode;
        return broadcaster.broadcast(built.txRawBytes, mode);
    }

    /**
     * Decode the {@code MsgCrossVMCallResponse} entries carried by a broadcast result.
     *
     * <p>Returns an empty list when the node returned no per-message responses - a
     * {@code sync}/{@code async} broadcast returns before the messages have run, so set
     * {@link Signer#broadcastMode} to {@link Broadcaster.Mode#COMMIT} to get them.
     * Responses of other types (a mixed transaction body) are skipped.
     */
    public static List<CallResponse> decodeCallResponses(Broadcaster.Result result) {
        return result == null ? List.of() : decodeCallResponses(result.data);
    }

    /**
     * Decode the {@code MsgCrossVMCallResponse} entries out of a tx result's {@code data} -
     * a protobuf {@code TxMsgData} whose field 2 holds the per-message response
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

    /**
     * The source VM used when {@link CallOptions#sourceVm} is unset: {@link VMType#EVM},
     * or {@link VMType#COSMWASM} when the target is {@link VMType#EVM} (the chain refuses
     * a call whose source equals its target).
     */
    public static String defaultSourceVm(String targetVm) {
        return VMType.EVM.equals(targetVm) ? VMType.COSMWASM : VMType.EVM;
    }

    /**
     * The source VM to send: {@code sourceVm} when set, else {@link #defaultSourceVm}.
     *
     * @throws IllegalArgumentException when a set {@code sourceVm} equals {@code targetVm}.
     */
    public static String resolveSourceVm(String sourceVm, String targetVm) {
        if (sourceVm == null || sourceVm.isEmpty()) {
            return defaultSourceVm(targetVm);
        }
        if (sourceVm.equals(targetVm)) {
            throw new IllegalArgumentException(
                    "crossvm: sourceVm and targetVm must be different (both are " + sourceVm
                            + "); the chain refuses such a call");
        }
        return sourceVm;
    }

    /**
     * Check {@link CallOptions#asyncGasLimit} / {@link CallOptions#asyncMaxFactor}: they
     * apply only to an async call into CosmWasm, and a set gas limit is in
     * {@value #MIN_ASYNC_GAS_LIMIT}..{@value #MAX_ASYNC_GAS_LIMIT}.
     *
     * @throws IllegalArgumentException naming the problem.
     */
    public static void validateAsyncOptions(CallOptions opts) {
        if (opts.asyncGasLimit < 0 || opts.asyncMaxFactor < 0) {
            throw new IllegalArgumentException("asyncGasLimit and asyncMaxFactor must be non-negative");
        }
        if (opts.asyncGasLimit == 0 && opts.asyncMaxFactor == 0) {
            return;
        }
        if (!opts.async) {
            throw new IllegalArgumentException(
                    "asyncGasLimit / asyncMaxFactor apply only to async calls (set async = true)");
        }
        if (!VMType.COSMWASM.equals(opts.targetVm)) {
            throw new IllegalArgumentException(
                    "asyncGasLimit / asyncMaxFactor apply only to async calls into CosmWasm, not \""
                            + opts.targetVm + "\"");
        }
        if (opts.asyncGasLimit != 0
                && (opts.asyncGasLimit < MIN_ASYNC_GAS_LIMIT || opts.asyncGasLimit > MAX_ASYNC_GAS_LIMIT)) {
            throw new IllegalArgumentException("asyncGasLimit must be 0 (default 500,000) or between "
                    + MIN_ASYNC_GAS_LIMIT + " and " + MAX_ASYNC_GAS_LIMIT + ", got " + opts.asyncGasLimit);
        }
    }

    /**
     * Refuse {@link CallOptions#asyncGasLimit} (field 8) / {@link CallOptions#asyncMaxFactor}
     * (field 9) on a network below chain v3.2.8, before anything is signed.
     *
     * <ul>
     *   <li>Both fields 0: nothing to check, no request.
     *   <li>Otherwise {@code GET {restUrl}/qorechain/pqc/v1/protocol_features} must list
     *       {@link #ASYNC_GAS_PRICED_FEATURE} (for a non-zero gas limit) and
     *       {@link #ASYNC_ESCROW_FEATURE} (for a non-zero max factor) as enabled.
     *   <li>Listed but disabled, absent, or not served at all (HTTP 404 or 501, an empty
     *       list, an empty body): {@link AsyncFieldsNotSupportedException}. There is no
     *       upgrade-plan fallback: a node without these switches is older than v3.2.8.
     *   <li>A transport failure or any other HTTP error:
     *       {@link ProtocolFeatures.FeatureQueryException}.
     *   <li>No {@code restUrl}: {@link AsyncFieldsNotSupportedException}; set
     *       {@link Signer#skipAsyncFieldsCheck} to build without asking.
     * </ul>
     *
     * <p>A switch confirmed on is trusted for {@link #ASYNC_FEATURE_TTL_MS} per REST URL;
     * refusals and failures are not cached.
     */
    public static void requireAsyncFieldsSupported(String restUrl, CallOptions opts) {
        List<String[]> needed = new ArrayList<>(2);
        if (opts.asyncGasLimit != 0) {
            needed.add(new String[] {"async_gas_limit (field 8)", ASYNC_GAS_PRICED_FEATURE});
        }
        if (opts.asyncMaxFactor != 0) {
            needed.add(new String[] {"async_max_factor (field 9)", ASYNC_ESCROW_FEATURE});
        }
        if (needed.isEmpty()) {
            return;
        }
        if (restUrl == null || restUrl.isBlank()) {
            throw new AsyncFieldsNotSupportedException(
                    "MsgCrossVMCall " + needed.get(0)[0] + " requires chain v3.2.8, and there is no REST URL"
                            + " to check that the network runs it: set Signer.restUrl, or"
                            + " Signer.skipAsyncFieldsCheck when you know it does; otherwise leave it 0");
        }
        String rest = restUrl.replaceAll("/+$", "");
        long now = System.currentTimeMillis();
        List<String[]> unconfirmed = new ArrayList<>(2);
        for (String[] n : needed) {
            Long until = ASYNC_FEATURE_CACHE.get(rest + "|" + n[1]);
            if (until == null || now >= until) {
                unconfirmed.add(n);
            }
        }
        if (unconfirmed.isEmpty()) {
            return;
        }
        JsonNode body = null;
        Exception failure = null;
        try {
            body = new RestClient(rest).get(ProtocolFeatures.PATH);
        } catch (Exception e) {
            failure = e;
        }
        for (String[] n : unconfirmed) {
            ProtocolFeatures.Lookup l = failure != null
                    ? ProtocolFeatures.classifyFailure(n[1], failure)
                    : ProtocolFeatures.classify(n[1], body);
            switch (l.state) {
                case ENABLED:
                    ASYNC_FEATURE_CACHE.put(rest + "|" + n[1], now + ASYNC_FEATURE_TTL_MS);
                    break;
                case DISABLED:
                case NOT_SERVED:
                    throw new AsyncFieldsNotSupportedException(
                            "MsgCrossVMCall " + n[0] + " requires chain v3.2.8 (switch " + n[1]
                                    + " is not on at " + rest + "); leave it 0 on this network");
                default:
                    throw new ProtocolFeatures.FeatureQueryException(
                            "cannot ask " + rest + " for its protocol feature \"" + n[1] + "\" ("
                                    + l.reason() + "), so MsgCrossVMCall " + n[0] + " cannot be checked"
                                    + " against chain v3.2.8: retry, or leave it 0",
                            l.error);
            }
        }
    }

    /** The REST route of the pending queue (paginated, at most 100 per page). */
    public static final String PENDING_PATH = "/qorechain/crossvm/v1/pending";

    /** The page cap of {@link #listPending(RestClient)}. */
    public static final int DEFAULT_MAX_PENDING_PAGES = 1000;

    /**
     * Every queued cross-VM message, following {@code pagination.next_key} until it is
     * empty (at most {@value #DEFAULT_MAX_PENDING_PAGES} pages). {@code payload_hex} in
     * the list is cut to its first 1,024 bytes: fetch one message with
     * {@link #getMessageRest} for the whole payload.
     */
    public static List<JsonNode> listPending(RestClient rest) {
        return listPending(rest, DEFAULT_MAX_PENDING_PAGES);
    }

    /**
     * As {@link #listPending(RestClient)} with an explicit page cap.
     *
     * @throws IllegalStateException when the queue has more than {@code maxPages} pages.
     */
    public static List<JsonNode> listPending(RestClient rest, int maxPages) {
        List<JsonNode> out = new ArrayList<>();
        String key = null;
        for (int page = 0; page < maxPages; page++) {
            java.util.Map<String, String> q = io.github.qorechain.query.Http.query();
            q.put("pagination.limit", "100");
            if (key != null) {
                q.put("pagination.key", key);
            }
            JsonNode body = rest.get(PENDING_PATH, q);
            JsonNode msgs = body == null ? null : body.get("messages");
            if (msgs != null && msgs.isArray()) {
                msgs.forEach(out::add);
            }
            JsonNode next = body == null ? null : body.path("pagination").get("next_key");
            if (next == null || next.isNull() || next.asText().isEmpty()) {
                return out;
            }
            key = next.asText();
        }
        throw new IllegalStateException("crossvm pending queue has more than " + maxPages + " pages");
    }

    /**
     * One cross-VM message with its full payload, over REST
     * ({@code /qorechain/crossvm/v1/message/{id}}): {@code {"message": ..., "found": bool}}.
     */
    public static JsonNode getMessageRest(RestClient rest, String id) {
        return rest.get("/qorechain/crossvm/v1/message/"
                + java.net.URLEncoder.encode(id, java.nio.charset.StandardCharsets.UTF_8));
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
