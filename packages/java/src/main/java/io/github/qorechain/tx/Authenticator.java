package io.github.qorechain.tx;

import com.google.protobuf.ByteString;
import io.github.qorechain.accounts.UnifiedAccounts;
import io.github.qorechain.messages.QorechainMessages;
import io.github.qorechain.messages.TypedMessage;
import io.github.qorechain.pqc.Pqc;
import io.github.qorechain.pqc.PqcKeypair;
import io.github.qorechain.utils.Hashing;
import io.github.qorechain.utils.Hex;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

/**
 * v3.1.85 authenticator-lane sign-bytes, mirroring the canonical wallet-adapter
 * {@code authenticator.js} BYTE-FOR-BYTE.
 *
 * <p>v3.1.84 introduced the SVM authenticator lane; v3.1.85 adds two more lanes so
 * a linked external key (a Phantom ed25519 key / a secp256k1 key) can spend from
 * the ONE unified PQC-required account under least-privilege, spend-limited,
 * revocable terms — via a relayer, WITHOUT the external key ever producing an
 * ML-DSA co-signature:
 *
 * <ul>
 *   <li>EVM lane — {@code MsgExecuteEVM}: EVM call/transfer from the account's 0x addr.
 *   <li>Native lane — {@code MsgExecuteCosmos}: bank send from the account (Cosmos).
 * </ul>
 *
 * <p>The relayer submits + pays fees (its own hybrid-PQC signature satisfies the
 * ante on the envelope); the authenticator's signature over the domain-separated,
 * replay-bound sign-bytes IS the authorization. The digests are rebuilt
 * byte-for-byte from the chain ({@code x/abstractaccount/types/{evm,cosmos}_sign.go}) —
 * a mismatch is rejected on-chain (codespace {@code abstractaccount}, code 11 replay /
 * 10 permission / 5 spending-limit / 6 session-expired).
 *
 * <p><b>NONCE</b>: for the EVM lane the nonce is the account's CURRENT EVM nonce
 * ({@code eth_getTransactionCount}); because in production the relayer is a
 * DIFFERENT account than the owner, the relayer envelope does not bump the account
 * nonce, so it is used as-is (no {@code +1}). For the Native lane the nonce is the
 * per-authenticator sequence for {@code (account, pubkey)} — a store counter
 * distinct from the account's own sequence, incremented on each successful spend.
 */
public final class Authenticator {

    private Authenticator() {}

    private static final String EVM_DOMAIN = "qorechain-evm-auth-v1";
    private static final String COSMOS_DOMAIN = "qorechain-cosmos-auth-v1";
    private static final String ROTATE_DOMAIN = "qorechain-pqc-rotate-v1";

    /**
     * The canonical Native-lane amount for the sign-bytes: matches the reference
     * adapter's KAT and default ({@code "100uqor"}).
     */
    public static final String DEFAULT_COSMOS_AMOUNT = "100uqor";

    // ---- byte helpers (match the chain's binary.BigEndian + length-prefix framing) ----

    /** BE64(n): the 8-byte big-endian encoding of {@code n}. */
    static byte[] be64(long n) {
        byte[] b = new byte[8];
        for (int i = 7; i >= 0; i--) {
            b[i] = (byte) (n & 0xffL);
            n >>>= 8;
        }
        return b;
    }

    /** LP(b): the length-prefixed field {@code BE64(len) ‖ b}. */
    static byte[] lp(byte[] b) {
        byte[] out = new byte[8 + b.length];
        System.arraycopy(be64(b.length), 0, out, 0, 8);
        System.arraycopy(b, 0, out, 8, b.length);
        return out;
    }

    private static byte[] utf8(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }

    private static byte[] nz(byte[] b) {
        return b == null ? new byte[0] : b;
    }

    // ---- sign-bytes (the digest an authenticator signs) ----

    /**
     * The 32-byte digest the chain re-derives for a {@code MsgExecuteEVM}:
     * {@code sha256("qorechain-evm-auth-v1" ‖ LP(chainId) ‖ LP(account) ‖ LP(pubkey)
     * ‖ LP(to) ‖ LP(value) ‖ LP(data) ‖ BE64(nonce))}.
     *
     * @param chainId the chain id (e.g. {@code qorechain-diana}).
     * @param account the bech32 canonical account (the authenticator's owner).
     * @param pubkey the authenticator's raw public key.
     * @param to the {@code 0x}-hex recipient/contract string ({@code ""} = create).
     * @param value the native QOR amount in wei (aqor) as a decimal string.
     * @param data the raw EVM calldata.
     * @param nonce the account's CURRENT EVM nonce.
     */
    public static byte[] evmAuthSignBytes(
            String chainId,
            String account,
            byte[] pubkey,
            String to,
            String value,
            byte[] data,
            long nonce) {
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        write(body, utf8(EVM_DOMAIN));
        write(body, lp(utf8(chainId)));
        write(body, lp(utf8(account)));
        write(body, lp(nz(pubkey)));
        write(body, lp(utf8(to == null ? "" : to)));
        write(body, lp(utf8(value == null ? "0" : value)));
        write(body, lp(nz(data)));
        write(body, be64(nonce));
        return Hashing.sha256(body.toByteArray());
    }

    /**
     * The 32-byte digest the chain re-derives for a {@code MsgExecuteCosmos}:
     * {@code sha256("qorechain-cosmos-auth-v1" ‖ LP(chainId) ‖ LP(account) ‖ LP(pubkey)
     * ‖ LP(to) ‖ LP(amount) ‖ BE64(nonce))}.
     *
     * @param chainId the chain id.
     * @param account the bech32 canonical account.
     * @param pubkey the authenticator's raw public key.
     * @param to the bech32 recipient.
     * @param amount the canonical single-coin string (e.g. {@code "100uqor"}).
     * @param nonce the per-authenticator sequence for {@code (account, pubkey)}.
     */
    public static byte[] cosmosAuthSignBytes(
            String chainId,
            String account,
            byte[] pubkey,
            String to,
            String amount,
            long nonce) {
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        write(body, utf8(COSMOS_DOMAIN));
        write(body, lp(utf8(chainId)));
        write(body, lp(utf8(account)));
        write(body, lp(nz(pubkey)));
        write(body, lp(utf8(to == null ? "" : to)));
        write(body, lp(utf8(amount == null ? "" : amount)));
        write(body, be64(nonce));
        return Hashing.sha256(body.toByteArray());
    }

    /**
     * The domain-separated STRING both the old and the new key sign for a
     * {@code MsgRotatePQCKey}:
     * {@code "qorechain-pqc-rotate-v1|<chainId>|<algorithmId>|<account>|<oldHex>|<newHex>"}.
     * {@code oldHex}/{@code newHex} are lowercase hex of the public keys. The signer
     * signs {@code utf8(this string)}.
     */
    public static String rotationSignBytes(
            String chainId, int algorithmId, String account, byte[] oldPub, byte[] newPub) {
        return ROTATE_DOMAIN
                + "|"
                + chainId
                + "|"
                + algorithmId
                + "|"
                + account
                + "|"
                + Hex.encode(nz(oldPub))
                + "|"
                + Hex.encode(nz(newPub));
    }

    // ---- message composers for the two execute lanes ----

    /**
     * Build a {@code MsgExecuteEVM} the relayer broadcasts. The {@code relayer} is
     * the message signer/fee payer (a DIFFERENT account than {@code account}); the
     * authenticator {@code (scheme, pubkey, signature)} carries the authorization.
     */
    public static TypedMessage executeEvmMsg(
            String relayer,
            String account,
            String scheme,
            byte[] pubkey,
            byte[] signature,
            String to,
            String value,
            byte[] data,
            long gasLimit,
            long nonce) {
        qorechain.abstractaccount.v1.Tx.MsgExecuteEVM msg =
                qorechain.abstractaccount.v1.Tx.MsgExecuteEVM.newBuilder()
                        .setRelayer(relayer == null ? "" : relayer)
                        .setAccount(account == null ? "" : account)
                        .setScheme(scheme == null ? "" : scheme)
                        .setPubkey(ByteString.copyFrom(nz(pubkey)))
                        .setSignature(ByteString.copyFrom(nz(signature)))
                        .setTo(to == null ? "" : to)
                        .setValue(value == null ? "0" : value)
                        .setData(ByteString.copyFrom(nz(data)))
                        .setGasLimit(gasLimit)
                        .setNonce(nonce)
                        .build();
        return QorechainMessages.abstractaccount.executeEvm(msg);
    }

    /**
     * Build a {@code MsgExecuteCosmos} the relayer broadcasts. {@code amount} is a
     * single-coin string like {@code "100uqor"}.
     */
    public static TypedMessage executeCosmosMsg(
            String relayer,
            String account,
            String scheme,
            byte[] pubkey,
            byte[] signature,
            String to,
            String amount,
            long nonce) {
        cosmos.base.v1beta1.CoinOuterClass.Coin coin = parseCoin(amount);
        qorechain.abstractaccount.v1.Tx.MsgExecuteCosmos msg =
                qorechain.abstractaccount.v1.Tx.MsgExecuteCosmos.newBuilder()
                        .setRelayer(relayer == null ? "" : relayer)
                        .setAccount(account == null ? "" : account)
                        .setScheme(scheme == null ? "" : scheme)
                        .setPubkey(ByteString.copyFrom(nz(pubkey)))
                        .setSignature(ByteString.copyFrom(nz(signature)))
                        .setTo(to == null ? "" : to)
                        .addAmount(coin)
                        .setNonce(nonce)
                        .build();
        return QorechainMessages.abstractaccount.executeCosmos(msg);
    }

    /** Parse a single-coin amount string like {@code "100uqor"} into a {@link cosmos.base.v1beta1.CoinOuterClass.Coin}. */
    static cosmos.base.v1beta1.CoinOuterClass.Coin parseCoin(String amount) {
        String s = amount == null ? "" : amount.trim();
        int i = 0;
        while (i < s.length() && Character.isDigit(s.charAt(i))) {
            i++;
        }
        String num = s.substring(0, i);
        String denom = s.substring(i);
        if (num.isEmpty() || denom.isEmpty()) {
            throw new IllegalArgumentException(
                    "invalid amount \"" + amount + "\" (expected e.g. \"100uqor\")");
        }
        return cosmos.base.v1beta1.CoinOuterClass.Coin.newBuilder()
                .setDenom(denom)
                .setAmount(num)
                .build();
    }

    // ---- key rotation (legacy → canonical migration) ----

    /**
     * The dual-signed {@code MsgRotatePQCKey} plus both derived keypairs, returned
     * by {@link #rotatePqcKeyMsgFromMnemonic}.
     */
    public static final class RotationResult {
        /** The dual-signed rotation message, ready to broadcast (envelope signed by the OLD key). */
        public final TypedMessage msg;
        /** The LEGACY (chain-bridge) keypair rotated out. */
        public final PqcKeypair oldKeypair;
        /** The CANONICAL (SDK address-bound) keypair rotated in. */
        public final PqcKeypair newKeypair;

        RotationResult(TypedMessage msg, PqcKeypair oldKeypair, PqcKeypair newKeypair) {
            this.msg = msg;
            this.oldKeypair = oldKeypair;
            this.newKeypair = newKeypair;
        }
    }

    /**
     * The LEGACY (chain-bridge) PQC derivation for a mnemonic:
     * {@code ML-DSA-87 keygen(shake256(utf8(mnemonic), 32))}. This is how a backend
     * (chain-bridge / faucet-api) registered a key from a bare mnemonic, WITHOUT the
     * SDK's address binding.
     */
    public static PqcKeypair derivePqcLegacy(String mnemonic) {
        return Pqc.generatePqcKeypair(Hashing.shake256(utf8(mnemonic), 32));
    }

    /**
     * The CANONICAL (SDK / wallet-adapter) address-bound PQC derivation for a
     * mnemonic: the same derivation {@link UnifiedAccounts#deriveUnifiedAccount}
     * uses — {@code ML-DSA-87 keygen(shake256("qorechain:pqc:v1|" + account + "|" +
     * mnemonic, 32))}, where {@code account} is the bech32 ({@code qor1…}) address.
     */
    static PqcKeypair derivePqcCanonical(String account, String mnemonic) {
        byte[] seed = Hashing.shake256("qorechain:pqc:v1|" + account + "|" + mnemonic, 32);
        return Pqc.generatePqcKeypair(seed);
    }

    /**
     * Build a {@code MsgRotatePQCKey} that rotates an account's ML-DSA-87 key (SAME
     * algorithm) from the LEGACY chain-bridge derivation ({@code shake256(mnemonic)})
     * to the CANONICAL address-bound derivation
     * ({@code shake256("qorechain:pqc:v1|addr|mnemonic")}), so a wallet whose key was
     * registered by a backend can move to the standard derivation. Both keys
     * dual-sign the domain-separated rotation bytes.
     *
     * <p>The returned message must be broadcast BY the account, cosigned (hybrid)
     * with the OLD key (it is still the registered key until the rotation lands).
     *
     * @param account the bech32 ({@code qor1…}) canonical account.
     * @param mnemonic the BIP-39 mnemonic both derivations share.
     * @param chainId the chain id bound into the rotation bytes.
     * @param algorithmId the algorithm id bound into the rotation bytes (ML-DSA-87 = 1).
     * @throws IllegalArgumentException if both derivations produce the same key (no-op).
     */
    public static RotationResult rotatePqcKeyMsgFromMnemonic(
            String account, String mnemonic, String chainId, int algorithmId) {
        PqcKeypair oldKp = derivePqcLegacy(mnemonic);
        PqcKeypair newKp = derivePqcCanonical(account, mnemonic);
        if (Hex.encode(oldKp.publicKey).equals(Hex.encode(newKp.publicKey))) {
            throw new IllegalArgumentException(
                    "old and new derivations produce the same key — rotation would be a no-op");
        }
        byte[] sb =
                utf8(rotationSignBytes(chainId, algorithmId, account, oldKp.publicKey, newKp.publicKey));
        qorechain.pqc.v1.Tx.MsgRotatePQCKey msg =
                qorechain.pqc.v1.Tx.MsgRotatePQCKey.newBuilder()
                        .setSender(account)
                        .setOldPublicKey(ByteString.copyFrom(oldKp.publicKey))
                        .setNewPublicKey(ByteString.copyFrom(newKp.publicKey))
                        .setOldSignature(ByteString.copyFrom(Pqc.pqcSign(oldKp.secretKey, sb)))
                        .setNewSignature(ByteString.copyFrom(Pqc.pqcSign(newKp.secretKey, sb)))
                        .build();
        return new RotationResult(QorechainMessages.pqc.rotatePqcKey(msg), oldKp, newKp);
    }

    /** Convenience overload with the default ML-DSA-87 algorithm id ({@code 1}). */
    public static RotationResult rotatePqcKeyMsgFromMnemonic(
            String account, String mnemonic, String chainId) {
        return rotatePqcKeyMsgFromMnemonic(account, mnemonic, chainId, 1);
    }

    private static void write(ByteArrayOutputStream out, byte[] b) {
        out.write(b, 0, b.length);
    }
}
