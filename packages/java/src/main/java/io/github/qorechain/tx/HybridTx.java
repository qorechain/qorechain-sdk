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
 * End-to-end hybrid (classical + post-quantum) transaction signing for QoreChain.
 *
 * <p>A hybrid transaction carries the usual classical secp256k1 signature in
 * {@code TxRaw.signatures} PLUS an ML-DSA-87 (Dilithium-5) signature attached to
 * the {@code TxBody} as a {@code PQCHybridSignature} extension. The chain's ante
 * handler verifies BOTH.
 *
 * <p><b>The wallet ↔ chain contract (enforced by the chain):</b> the ML-DSA-87
 * signature is computed over the tx body WITH the PQC extension REMOVED, framed
 * with the authInfo bytes in the form the TARGET network verifies (see
 * {@link SignBytes}):
 *
 * <pre>
 *   B0 = protobuf(TxBody without the PQC extension)
 *   A  = authInfoBytes (verbatim)
 *   v1 = BE32(len B0) || B0 || BE32(len A) || A
 *   v2 = "qorechain-pqc-hybrid-v2" || BE64(len chainId) || chainId || BE32(len B0) || B0
 *        || BE32(len A) || A
 * </pre>
 *
 * A network verifies exactly one form: v1 until it applies the v3.1.98 upgrade
 * (mainnet today), v2 after (testnet today) and on every network born on v3.1.98+.
 * {@link Options#signBytesVersion} selects it; when unset, a non-legacy chain uses
 * v2 and a legacy chain ({@code qorechain-vladi}/{@code qorechain-diana}) fails
 * loudly rather than guessing. Resolve it with {@link SignBytesResolver}.
 *
 * No hashing. The extension is then attached to
 * {@code TxBody.extension_options} (CRITICAL) as an {@code Any} with
 * {@code type_url = /qorechain.pqc.v1.PQCHybridSignature} and value = the
 * PROTOBUF encoding of the {@code PQCHybridSignature} message (leading byte
 * {@code 0x08}). The CLASSICAL signature is SIGN_MODE_DIRECT over the FINAL body
 * (the one WITH the extension) + authInfo + chainId + accountNumber, in
 * {@code TxRaw.signatures}.
 */
public final class HybridTx {

    private HybridTx() {}

    private static final String SECP256K1_PUBKEY_TYPE_URL = "/cosmos.crypto.secp256k1.PubKey";

    /** Options for {@link #buildHybridTx}. */
    public static final class Options {
        public List<TypedMessage> messages;
        public byte[] secp256k1PrivateKey;
        public byte[] secp256k1PublicKey; // 33-byte compressed
        public PqcKeypair pqcKeypair;
        public StdFee fee;
        public String memo = "";
        public String chainId;
        public long accountNumber;
        public long sequence;
        public long timeoutHeight = 0L;
        /** When true, embed the PQC public key for auto-registration on first use. */
        public boolean includePqcPublicKey = false;
        /**
         * The hybrid sign-bytes form the target network verifies. {@code null}: v2 for
         * a non-legacy chain id; for {@code qorechain-vladi}/{@code qorechain-diana}
         * the build throws (resolve it with {@link SignBytesResolver} or set it).
         */
        public SignBytes.Version signBytesVersion;
    }

    /** The fully assembled hybrid transaction and the intermediate artifacts. */
    public static final class Built {
        /** The assembled {@code TxRaw}. */
        public final cosmos.tx.v1beta1.TxOuterClass.TxRaw txRaw;
        /** Encoded {@code TxRaw} bytes, ready to broadcast. */
        public final byte[] txRawBytes;
        /** The {@code authInfoBytes} (A) — identical in the PQC framing and SignDoc. */
        public final byte[] authInfoBytes;
        /** B0: the body bytes WITHOUT the PQC extension. */
        public final byte[] b0Bytes;
        /** The exact bytes the ML-DSA-87 signature was computed over (the framing). */
        public final byte[] pqcSignedMessage;
        /** The raw ML-DSA-87 signature (Dilithium-5: 4627 bytes). */
        public final byte[] pqcSignature;
        /** The final body bytes (WITH the PQC extension). */
        public final byte[] finalBodyBytes;
        /** The sign-bytes form {@link #pqcSignedMessage} was built in. */
        public final SignBytes.Version signBytesVersion;

        Built(
                cosmos.tx.v1beta1.TxOuterClass.TxRaw txRaw,
                byte[] txRawBytes,
                byte[] authInfoBytes,
                byte[] b0Bytes,
                byte[] pqcSignedMessage,
                byte[] pqcSignature,
                byte[] finalBodyBytes,
                SignBytes.Version signBytesVersion) {
            this.txRaw = txRaw;
            this.txRawBytes = txRawBytes;
            this.authInfoBytes = authInfoBytes;
            this.b0Bytes = b0Bytes;
            this.pqcSignedMessage = pqcSignedMessage;
            this.pqcSignature = pqcSignature;
            this.finalBodyBytes = finalBodyBytes;
            this.signBytesVersion = signBytesVersion;
        }
    }

    /** A big-endian 4-byte length prefix, matching the chain contract framing. */
    public static byte[] be32(int n) {
        return new byte[] {
            (byte) ((n >>> 24) & 0xff),
            (byte) ((n >>> 16) & 0xff),
            (byte) ((n >>> 8) & 0xff),
            (byte) (n & 0xff)
        };
    }

    /**
     * The PQC signing frame in the given form (see {@link SignBytes#hybrid}). Shared
     * with the eth-native lane ({@link SignEth}).
     */
    public static byte[] frame(SignBytes.Version version, String chainId, byte[] b0, byte[] auth) {
        return SignBytes.hybrid(version, chainId, b0, auth);
    }

    /** Build a {@code TxBody} from messages/memo/timeout, optionally with the PQC extension. */
    private static cosmos.tx.v1beta1.TxOuterClass.TxBody buildBody(
            Options opts, Any pqcExtension) {
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

    /** Encode the single-signer SIGN_MODE_DIRECT AuthInfo (the bytes "A"). */
    private static byte[] buildAuthInfoBytes(Options opts) {
        Any pubkeyAny =
                Any.newBuilder()
                        .setTypeUrl(SECP256K1_PUBKEY_TYPE_URL)
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

    /**
     * Encode the {@code PQCHybridSignature} extension as a protobuf {@code Any}.
     *
     * <p>The {@code Any.value} is the PROTOBUF encoding of the generated
     * {@code qorechain.pqc.v1.Hybrid.PQCHybridSignature} message (fields
     * {@code algorithm_id} = 1, {@code pqc_signature} = 2, {@code pqc_public_key} = 3),
     * so the encoded value always begins with byte {@code 0x08} (the field-1 varint
     * tag), NEVER the JSON open-brace byte {@code 0x7b}. The chain's ante handler
     * protobuf-decodes this extension; a prior release JSON-encoded the value and the
     * tx decoder rejected every such tx at CheckTx (the leading {@code 0x7b} was
     * misread as field 15 {@code start_group}). Verified live on testnet 2026-07-05.
     */
    public static Any encodeHybridExtension(HybridSignatureExtension ext) {
        qorechain.pqc.v1.Hybrid.PQCHybridSignature.Builder msg =
                qorechain.pqc.v1.Hybrid.PQCHybridSignature.newBuilder()
                        .setAlgorithmId(ext.algorithmId)
                        .setPqcSignature(ByteString.copyFrom(ext.pqcSignature));
        if (ext.pqcPublicKey != null && ext.pqcPublicKey.length > 0) {
            msg.setPqcPublicKey(ByteString.copyFrom(ext.pqcPublicKey));
        }
        return Any.newBuilder()
                .setTypeUrl(Pqc.HYBRID_SIG_TYPE_URL)
                .setValue(msg.build().toByteString())
                .build();
    }

    /**
     * Build a fully signed hybrid transaction following the chain contract. See the
     * class header for the exact framing.
     *
     * @throws IllegalStateException when {@code opts.signBytesVersion} is unset and
     *     the chain id is a legacy network (the form cannot be known offline).
     */
    public static Built buildHybridTx(Options opts) {
        SignBytes.Version version = SignBytes.requireVersion(opts.chainId, opts.signBytesVersion);

        // 1. B0 — body WITHOUT the PQC extension.
        byte[] b0 = buildBody(opts, null).toByteArray();

        // 2. A — single-signer AuthInfo (SIGN_MODE_DIRECT).
        byte[] authInfoBytes = buildAuthInfoBytes(opts);

        // 3. PQC framing (per-network form) + ML-DSA-87 signature over B0 + A
        //    (NOT the final body).
        byte[] pqcSignedMessage = frame(version, opts.chainId, b0, authInfoBytes);
        byte[] pqcSignature = Pqc.pqcSign(opts.pqcKeypair.secretKey, pqcSignedMessage);

        // 4. Build the PQC extension Any and attach it to the FINAL body (CRITICAL slot).
        HybridSignatureExtension ext =
                Pqc.buildHybridSignatureExtension(
                        PqcAlgorithm.ALGORITHM_DILITHIUM5,
                        pqcSignature,
                        opts.includePqcPublicKey ? opts.pqcKeypair.publicKey : null);
        Any extAny = encodeHybridExtension(ext);
        byte[] finalBodyBytes = buildBody(opts, extAny).toByteArray();

        // 5. Classical SIGN_MODE_DIRECT signature over the FINAL body + A.
        cosmos.tx.v1beta1.TxOuterClass.SignDoc signDoc =
                cosmos.tx.v1beta1.TxOuterClass.SignDoc.newBuilder()
                        .setBodyBytes(ByteString.copyFrom(finalBodyBytes))
                        .setAuthInfoBytes(ByteString.copyFrom(authInfoBytes))
                        .setChainId(opts.chainId)
                        .setAccountNumber(opts.accountNumber)
                        .build();
        byte[] classicalSig =
                Secp256k1.signCosmos(opts.secp256k1PrivateKey, signDoc.toByteArray());

        // 6. Assemble TxRaw.
        cosmos.tx.v1beta1.TxOuterClass.TxRaw txRaw =
                cosmos.tx.v1beta1.TxOuterClass.TxRaw.newBuilder()
                        .setBodyBytes(ByteString.copyFrom(finalBodyBytes))
                        .setAuthInfoBytes(ByteString.copyFrom(authInfoBytes))
                        .addSignatures(ByteString.copyFrom(classicalSig))
                        .build();

        return new Built(
                txRaw,
                txRaw.toByteArray(),
                authInfoBytes,
                b0,
                pqcSignedMessage,
                pqcSignature,
                finalBodyBytes,
                version);
    }
}
