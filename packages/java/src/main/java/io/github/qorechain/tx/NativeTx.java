package io.github.qorechain.tx;

import com.google.protobuf.ByteString;
import io.github.qorechain.accounts.Secp256k1;
import io.github.qorechain.messages.CosmosMessages;
import io.github.qorechain.messages.Messages;
import io.github.qorechain.messages.TypedMessage;
import java.util.List;

/**
 * Native (classical secp256k1, SIGN_MODE_DIRECT) transaction building, including
 * the convenience {@code bankSend} composer.
 *
 * <p>This is the non-PQC sibling of {@link HybridTx}: it builds a {@code TxBody}
 * (no PQC extension), a single-signer SIGN_MODE_DIRECT {@code AuthInfo}, signs
 * the {@code SignDoc} with secp256k1, and assembles a {@code TxRaw}.
 */
public final class NativeTx {

    private NativeTx() {}

    /** The canonical bank-send type URL. */
    public static final String MSG_SEND_TYPE_URL = "/cosmos.bank.v1beta1.MsgSend";

    /** Options for {@link #buildAndSign}. */
    public static final class Options {
        public List<TypedMessage> messages;
        public byte[] secp256k1PrivateKey;
        public byte[] secp256k1PublicKey;
        public StdFee fee;
        public String memo = "";
        public String chainId;
        public long accountNumber;
        public long sequence;
        public long timeoutHeight = 0L;
    }

    /** A signed native transaction. */
    public static final class Built {
        public final cosmos.tx.v1beta1.TxOuterClass.TxRaw txRaw;
        public final byte[] txRawBytes;

        Built(cosmos.tx.v1beta1.TxOuterClass.TxRaw txRaw, byte[] txRawBytes) {
            this.txRaw = txRaw;
            this.txRawBytes = txRawBytes;
        }
    }

    /**
     * Compose a bank {@code MsgSend} TypedMessage.
     *
     * @param fromAddress sender bech32 address.
     * @param toAddress recipient bech32 address.
     * @param amount the coins to send.
     */
    public static TypedMessage bankSend(
            String fromAddress, String toAddress, List<StdFee.Coin> amount) {
        cosmos.bank.v1beta1.Tx.MsgSend.Builder msg =
                cosmos.bank.v1beta1.Tx.MsgSend.newBuilder()
                        .setFromAddress(fromAddress)
                        .setToAddress(toAddress);
        for (StdFee.Coin c : amount) {
            msg.addAmount(
                    cosmos.base.v1beta1.CoinOuterClass.Coin.newBuilder()
                            .setDenom(c.denom)
                            .setAmount(c.amount)
                            .build());
        }
        return CosmosMessages.bank.send(msg.build());
    }

    /** Build and sign a native transaction (SIGN_MODE_DIRECT, secp256k1). */
    public static Built buildAndSign(Options opts) {
        cosmos.tx.v1beta1.TxOuterClass.TxBody.Builder body =
                cosmos.tx.v1beta1.TxOuterClass.TxBody.newBuilder().setMemo(opts.memo);
        if (opts.timeoutHeight != 0L) {
            body.setTimeoutHeight(opts.timeoutHeight);
        }
        for (TypedMessage m : opts.messages) {
            body.addMessages(Messages.pack(m));
        }
        byte[] bodyBytes = body.build().toByteArray();
        byte[] authInfoBytes = buildAuthInfoBytes(opts);

        cosmos.tx.v1beta1.TxOuterClass.SignDoc signDoc =
                cosmos.tx.v1beta1.TxOuterClass.SignDoc.newBuilder()
                        .setBodyBytes(ByteString.copyFrom(bodyBytes))
                        .setAuthInfoBytes(ByteString.copyFrom(authInfoBytes))
                        .setChainId(opts.chainId)
                        .setAccountNumber(opts.accountNumber)
                        .build();
        byte[] sig = Secp256k1.signCosmos(opts.secp256k1PrivateKey, signDoc.toByteArray());

        cosmos.tx.v1beta1.TxOuterClass.TxRaw txRaw =
                cosmos.tx.v1beta1.TxOuterClass.TxRaw.newBuilder()
                        .setBodyBytes(ByteString.copyFrom(bodyBytes))
                        .setAuthInfoBytes(ByteString.copyFrom(authInfoBytes))
                        .addSignatures(ByteString.copyFrom(sig))
                        .build();
        return new Built(txRaw, txRaw.toByteArray());
    }

    private static byte[] buildAuthInfoBytes(Options opts) {
        com.google.protobuf.Any pubkeyAny =
                com.google.protobuf.Any.newBuilder()
                        .setTypeUrl("/cosmos.crypto.secp256k1.PubKey")
                        .setValue(
                                cosmos.crypto.secp256k1.Keys.PubKey.newBuilder()
                                        .setKey(ByteString.copyFrom(opts.secp256k1PublicKey))
                                        .build()
                                        .toByteString())
                        .build();

        cosmos.tx.v1beta1.TxOuterClass.SignerInfo signerInfo =
                cosmos.tx.v1beta1.TxOuterClass.SignerInfo.newBuilder()
                        .setPublicKey(pubkeyAny)
                        .setModeInfo(
                                cosmos.tx.v1beta1.TxOuterClass.ModeInfo.newBuilder()
                                        .setSingle(
                                                cosmos.tx.v1beta1.TxOuterClass.ModeInfo.Single
                                                        .newBuilder()
                                                        .setMode(
                                                                cosmos.tx.signing.v1beta1.Signing
                                                                        .SignMode.SIGN_MODE_DIRECT)))
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
}
