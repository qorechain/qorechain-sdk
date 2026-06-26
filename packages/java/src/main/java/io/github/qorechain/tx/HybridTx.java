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
import java.nio.charset.StandardCharsets;
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
 * with the authInfo bytes:
 *
 * <pre>
 *   B0 = protobuf(TxBody without the PQC extension)
 *   A  = authInfoBytes (verbatim)
 *   PQC signed message = BE32(len B0) || B0 || BE32(len A) || A
 * </pre>
 *
 * No hashing, no domain prefix. The extension is then attached to
 * {@code TxBody.extension_options} (CRITICAL) as an {@code Any} with
 * {@code type_url = /qorechain.pqc.v1.PQCHybridSignature} and value = UTF-8
 * Go-JSON. The CLASSICAL signature is SIGN_MODE_DIRECT over the FINAL body (the
 * one WITH the extension) + authInfo + chainId + accountNumber, in
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

        Built(
                cosmos.tx.v1beta1.TxOuterClass.TxRaw txRaw,
                byte[] txRawBytes,
                byte[] authInfoBytes,
                byte[] b0Bytes,
                byte[] pqcSignedMessage,
                byte[] pqcSignature,
                byte[] finalBodyBytes) {
            this.txRaw = txRaw;
            this.txRawBytes = txRawBytes;
            this.authInfoBytes = authInfoBytes;
            this.b0Bytes = b0Bytes;
            this.pqcSignedMessage = pqcSignedMessage;
            this.pqcSignature = pqcSignature;
            this.finalBodyBytes = finalBodyBytes;
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

    private static byte[] concat(byte[]... parts) {
        int total = 0;
        for (byte[] p : parts) {
            total += p.length;
        }
        byte[] out = new byte[total];
        int off = 0;
        for (byte[] p : parts) {
            System.arraycopy(p, 0, out, off, p.length);
            off += p.length;
        }
        return out;
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

    /** Encode the {@code PQCHybridSignature} extension as a Cosmos {@code Any} (Go-JSON value). */
    public static Any encodeHybridExtension(HybridSignatureExtension ext) {
        return Any.newBuilder()
                .setTypeUrl(Pqc.HYBRID_SIG_TYPE_URL)
                .setValue(ByteString.copyFrom(ext.toJson().getBytes(StandardCharsets.UTF_8)))
                .build();
    }

    /**
     * Build a fully signed hybrid transaction following the chain contract. See the
     * class header for the exact framing.
     */
    public static Built buildHybridTx(Options opts) {
        // 1. B0 — body WITHOUT the PQC extension.
        byte[] b0 = buildBody(opts, null).toByteArray();

        // 2. A — single-signer AuthInfo (SIGN_MODE_DIRECT).
        byte[] authInfoBytes = buildAuthInfoBytes(opts);

        // 3. PQC framing + ML-DSA-87 signature over B0 + A (NOT the final body).
        byte[] pqcSignedMessage =
                concat(be32(b0.length), b0, be32(authInfoBytes.length), authInfoBytes);
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
                finalBodyBytes);
    }
}
