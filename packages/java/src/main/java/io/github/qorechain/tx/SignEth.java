package io.github.qorechain.tx;

import com.google.protobuf.Any;
import com.google.protobuf.ByteString;
import io.github.qorechain.accounts.Secp256k1;
import io.github.qorechain.messages.Messages;
import io.github.qorechain.messages.TypedMessage;
import io.github.qorechain.pqc.HybridSignatureExtension;
import io.github.qorechain.pqc.Pqc;
import io.github.qorechain.pqc.PqcAlgorithm;
import io.github.qorechain.pqc.PqcKeypair;
import java.util.List;

/**
 * Eth-native ({@code eth_secp256k1}) Native-lane signing for QoreChain.
 *
 * <p>A QoreChain account created eth-native (address = {@code keccak(pubkey)[12:]},
 * see {@link io.github.qorechain.accounts.UnifiedAccounts}) signs Native txs
 * with the {@code eth_secp256k1} scheme: the classical signature is secp256k1 over
 * the KECCAK-256 of the SignDoc (NOT sha256), and the account's pubkey {@code Any}
 * is {@link #ETHSECP256K1_PUBKEY_TYPE}. This is the same account that spends on the
 * EVM lane, so its {@code qor1}/{@code 0x}/svm forms are one identity.
 *
 * <p>Mainnet requires the ML-DSA-87 hybrid extension in the tx body;
 * {@link #signHybridEth} adds it. {@link #signClassicalEth} omits it (used for the
 * one-time PQC key registration, which is bootstrap-exempt from the hybrid
 * requirement).
 *
 * <p>The hybrid framing is identical to {@link HybridTx}: {@code B0} = body WITHOUT
 * the PQC extension, and the ML-DSA-87 signature is over
 * {@code BE32(len B0) ‖ B0 ‖ BE32(len A) ‖ A}. Only the classical hash (keccak vs
 * sha256) and the SignerInfo pubkey typeUrl change.
 */
public final class SignEth {

    private SignEth() {}

    /**
     * The {@code cosmos/evm} eth_secp256k1 pubkey type URL. Wire shape is identical
     * to the cosmos secp256k1 {@code PubKey} ({@code {1: bytes key}}); only the
     * typeUrl differs.
     */
    public static final String ETHSECP256K1_PUBKEY_TYPE =
            "/cosmos.evm.crypto.v1.ethsecp256k1.PubKey";

    /** The standard cosmos secp256k1 pubkey type URL (accepted alongside the eth type). */
    public static final String SECP256K1_PUBKEY_TYPE = "/cosmos.crypto.secp256k1.PubKey";

    /**
     * Decode the compressed secp256k1 public-key bytes from an on-chain pubkey
     * {@code Any}, accepting BOTH the standard {@link #SECP256K1_PUBKEY_TYPE} and
     * the eth-native {@link #ETHSECP256K1_PUBKEY_TYPE} (whose wire value is the same
     * secp256k1 {@code PubKey} proto). Use this when parsing an account's registered
     * pubkey off the chain.
     *
     * @throws IllegalArgumentException if the typeUrl is neither secp256k1 form.
     */
    public static byte[] pubkeyFromAny(Any pubkeyAny) {
        String typeUrl = pubkeyAny.getTypeUrl();
        if (!ETHSECP256K1_PUBKEY_TYPE.equals(typeUrl) && !SECP256K1_PUBKEY_TYPE.equals(typeUrl)) {
            throw new IllegalArgumentException("unsupported pubkey type: " + typeUrl);
        }
        try {
            return cosmos.crypto.secp256k1.Keys.PubKey.parseFrom(pubkeyAny.getValue())
                    .getKey()
                    .toByteArray();
        } catch (com.google.protobuf.InvalidProtocolBufferException e) {
            throw new IllegalArgumentException("invalid secp256k1 PubKey value", e);
        }
    }

    /** Options for {@link #signClassicalEth} / {@link #signHybridEth}. */
    public static final class Options {
        public List<TypedMessage> messages;
        /** 32-byte secp256k1 private key (the eth-native account key). */
        public byte[] secp256k1PrivateKey;
        /** 33-byte compressed secp256k1 public key. */
        public byte[] secp256k1PublicKey;
        /** ML-DSA-87 keypair — required only for {@link #signHybridEth}. */
        public PqcKeypair pqcKeypair;
        public StdFee fee;
        public String memo = "";
        public String chainId;
        public long accountNumber;
        public long sequence;
        public long timeoutHeight = 0L;
        /** When true, embed the PQC public key for auto-registration on first use. */
        public boolean includePqcPublicKey = false;
    }

    /** The assembled eth-native transaction and its intermediate artifacts. */
    public static final class Built {
        /** The assembled {@code TxRaw}. */
        public final cosmos.tx.v1beta1.TxOuterClass.TxRaw txRaw;
        /** Encoded {@code TxRaw} bytes, ready to broadcast. */
        public final byte[] txRawBytes;
        /** The {@code authInfoBytes} (A). */
        public final byte[] authInfoBytes;
        /** The final body bytes (WITH the PQC extension, for hybrid; == B0 for classical). */
        public final byte[] bodyBytes;
        /** B0: the body bytes WITHOUT the PQC extension (== {@code bodyBytes} for classical). */
        public final byte[] b0Bytes;
        /** The exact bytes the ML-DSA-87 signature was computed over; {@code null} for classical. */
        public final byte[] pqcSignedMessage;
        /** The raw ML-DSA-87 signature; {@code null} for classical. */
        public final byte[] pqcSignature;
        /** The 64-byte {@code r‖s} classical eth_secp256k1 signature over keccak256(SignDoc). */
        public final byte[] classicalSignature;

        Built(
                cosmos.tx.v1beta1.TxOuterClass.TxRaw txRaw,
                byte[] txRawBytes,
                byte[] authInfoBytes,
                byte[] bodyBytes,
                byte[] b0Bytes,
                byte[] pqcSignedMessage,
                byte[] pqcSignature,
                byte[] classicalSignature) {
            this.txRaw = txRaw;
            this.txRawBytes = txRawBytes;
            this.authInfoBytes = authInfoBytes;
            this.bodyBytes = bodyBytes;
            this.b0Bytes = b0Bytes;
            this.pqcSignedMessage = pqcSignedMessage;
            this.pqcSignature = pqcSignature;
            this.classicalSignature = classicalSignature;
        }
    }

    /** Build a {@code TxBody} from messages/memo/timeout, optionally with the PQC extension. */
    private static cosmos.tx.v1beta1.TxOuterClass.TxBody buildBody(Options opts, Any pqcExtension) {
        cosmos.tx.v1beta1.TxOuterClass.TxBody.Builder body =
                cosmos.tx.v1beta1.TxOuterClass.TxBody.newBuilder().setMemo(opts.memo);
        if (opts.timeoutHeight != 0L) {
            body.setTimeoutHeight(opts.timeoutHeight);
        }
        for (TypedMessage m : opts.messages) {
            body.addMessages(Messages.pack(m));
        }
        if (pqcExtension != null) {
            body.addExtensionOptions(pqcExtension);
        }
        return body.build();
    }

    /**
     * Encode the single-signer SIGN_MODE_DIRECT AuthInfo (the bytes "A"), with the
     * SignerInfo pubkey {@code Any} carrying the {@link #ETHSECP256K1_PUBKEY_TYPE}
     * typeUrl over the standard secp256k1 {@code PubKey} value.
     */
    private static byte[] buildAuthInfoBytes(Options opts) {
        Any pubkeyAny =
                Any.newBuilder()
                        .setTypeUrl(ETHSECP256K1_PUBKEY_TYPE)
                        .setValue(
                                cosmos.crypto.secp256k1.Keys.PubKey.newBuilder()
                                        .setKey(ByteString.copyFrom(opts.secp256k1PublicKey))
                                        .build()
                                        .toByteString())
                        .build();

        cosmos.tx.v1beta1.TxOuterClass.ModeInfo modeInfo =
                cosmos.tx.v1beta1.TxOuterClass.ModeInfo.newBuilder()
                        .setSingle(
                                cosmos.tx.v1beta1.TxOuterClass.ModeInfo.Single.newBuilder()
                                        .setMode(
                                                cosmos.tx.signing.v1beta1.Signing.SignMode
                                                        .SIGN_MODE_DIRECT))
                        .build();

        cosmos.tx.v1beta1.TxOuterClass.SignerInfo signerInfo =
                cosmos.tx.v1beta1.TxOuterClass.SignerInfo.newBuilder()
                        .setPublicKey(pubkeyAny)
                        .setModeInfo(modeInfo)
                        .setSequence(opts.sequence)
                        .build();

        cosmos.tx.v1beta1.TxOuterClass.Fee.Builder fee =
                cosmos.tx.v1beta1.TxOuterClass.Fee.newBuilder()
                        .setGasLimit(Long.parseLong(opts.fee.gas));
        for (StdFee.Coin c : opts.fee.amount) {
            fee.addAmount(
                    cosmos.base.v1beta1.CoinOuterClass.Coin.newBuilder()
                            .setDenom(c.denom)
                            .setAmount(c.amount)
                            .build());
        }
        if (opts.fee.payer != null && !opts.fee.payer.isEmpty()) {
            fee.setPayer(opts.fee.payer);
        }
        if (opts.fee.granter != null && !opts.fee.granter.isEmpty()) {
            fee.setGranter(opts.fee.granter);
        }

        return cosmos.tx.v1beta1.TxOuterClass.AuthInfo.newBuilder()
                .addSignerInfos(signerInfo)
                .setFee(fee)
                .build()
                .toByteArray();
    }

    private static byte[] signDocBytes(byte[] bodyBytes, byte[] authInfoBytes, Options opts) {
        return cosmos.tx.v1beta1.TxOuterClass.SignDoc.newBuilder()
                .setBodyBytes(ByteString.copyFrom(bodyBytes))
                .setAuthInfoBytes(ByteString.copyFrom(authInfoBytes))
                .setChainId(opts.chainId)
                .setAccountNumber(opts.accountNumber)
                .build()
                .toByteArray();
    }

    private static Built assemble(
            byte[] bodyBytes,
            byte[] authInfoBytes,
            byte[] b0Bytes,
            byte[] pqcSignedMessage,
            byte[] pqcSignature,
            Options opts) {
        // Classical eth_secp256k1 SIGN_MODE_DIRECT signature over keccak256(SignDoc).
        byte[] signBytes = signDocBytes(bodyBytes, authInfoBytes, opts);
        byte[] classicalSig = Secp256k1.signEth(opts.secp256k1PrivateKey, signBytes);

        cosmos.tx.v1beta1.TxOuterClass.TxRaw txRaw =
                cosmos.tx.v1beta1.TxOuterClass.TxRaw.newBuilder()
                        .setBodyBytes(ByteString.copyFrom(bodyBytes))
                        .setAuthInfoBytes(ByteString.copyFrom(authInfoBytes))
                        .addSignatures(ByteString.copyFrom(classicalSig))
                        .build();

        return new Built(
                txRaw,
                txRaw.toByteArray(),
                authInfoBytes,
                bodyBytes,
                b0Bytes,
                pqcSignedMessage,
                pqcSignature,
                classicalSig);
    }

    /**
     * Classical-only eth_secp256k1 Native tx (no PQC extension). Use for the
     * one-time {@code MsgRegisterPQCKeyV2} (bootstrap-exempt from the hybrid
     * requirement).
     */
    public static Built signClassicalEth(Options opts) {
        byte[] b0 = buildBody(opts, null).toByteArray();
        byte[] authInfoBytes = buildAuthInfoBytes(opts);
        return assemble(b0, authInfoBytes, b0, null, null, opts);
    }

    /**
     * Hybrid eth_secp256k1 + ML-DSA-87 Native tx. The ML-DSA-87 signature is over
     * {@code frame(B0, authInfo)} (B0 = body WITHOUT the extension); the hybrid
     * extension is then attached to the body, and the classical signature is over
     * the FINAL (with-extension) SignDoc.
     */
    public static Built signHybridEth(Options opts) {
        // 1. B0 — body WITHOUT the PQC extension.
        byte[] b0 = buildBody(opts, null).toByteArray();

        // 2. A — single-signer eth_secp256k1 AuthInfo (SIGN_MODE_DIRECT).
        byte[] authInfoBytes = buildAuthInfoBytes(opts);

        // 3. PQC framing + ML-DSA-87 signature over B0 + A (identical to HybridTx).
        byte[] pqcSignedMessage =
                HybridTx.frame(b0, authInfoBytes);
        byte[] pqcSignature = Pqc.pqcSign(opts.pqcKeypair.secretKey, pqcSignedMessage);

        // 4. Attach the PQC extension (Go-JSON) to the FINAL body.
        HybridSignatureExtension ext =
                Pqc.buildHybridSignatureExtension(
                        PqcAlgorithm.ALGORITHM_DILITHIUM5,
                        pqcSignature,
                        opts.includePqcPublicKey ? opts.pqcKeypair.publicKey : null);
        Any extAny = HybridTx.encodeHybridExtension(ext);
        byte[] finalBodyBytes = buildBody(opts, extAny).toByteArray();

        // 5. Classical eth_secp256k1 signature over the FINAL body + A.
        return assemble(finalBodyBytes, authInfoBytes, b0, pqcSignedMessage, pqcSignature, opts);
    }
}
