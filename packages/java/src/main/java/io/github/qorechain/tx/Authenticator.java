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
 * revocable terms - via a relayer, WITHOUT the external key ever producing an
 * ML-DSA co-signature:
 *
 * <ul>
 *   <li>EVM lane - {@code MsgExecuteEVM}: EVM call/transfer from the account's 0x addr.
 *   <li>Native lane - {@code MsgExecuteCosmos}: bank send from the account (Cosmos).
 * </ul>
 *
 * <p>The relayer submits + pays fees (its own hybrid-PQC signature satisfies the
 * ante on the envelope); the authenticator's signature over the domain-separated,
 * replay-bound sign-bytes IS the authorization. The digests are rebuilt
 * byte-for-byte from the chain ({@code x/abstractaccount/types/{evm,cosmos}_sign.go}) -
 * a mismatch is rejected on-chain (codespace {@code abstractaccount}, code 11 replay /
 * 10 permission / 5 spending-limit / 6 session-expired).
 *
 * <p><b>NONCE</b>: both lanes use the per-authenticator sequence for
 * {@code (account, pubkey)}: a counter the chain keeps for each linked key,
 * starting at 0 and incremented by each successful execution. For the EVM lane it
 * is NOT the account's EVM nonce (the chain checks this counter since v3.2.0).
 * Read it with {@link #fetchAuthNonce} (chain v3.2.4); a mismatch is refused with
 * abstractaccount code 11.
 */
public final class Authenticator {

    private Authenticator() {}

    private static final String EVM_DOMAIN = "qorechain-evm-auth-v1";
    private static final String EVM_DOMAIN_V2 = "qorechain-evm-auth-v2";
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
     * @param nonce the linked key's authenticator sequence (not the EVM nonce), from
     *     {@link #fetchAuthNonce}.
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
     * The v2 digest of a {@code MsgExecuteEVM} (chain v3.2.3,
     * {@code abstractaccount-hardening}): {@code sha256("qorechain-evm-auth-v2" ‖
     * LP(chainId) ‖ LP(account) ‖ LP(pubkey) ‖ LP(to) ‖ LP(value) ‖ LP(data) ‖
     * BE64(nonce) ‖ BE64(gasLimit))}. v1 left the gas limit to whoever relayed the
     * message. The chain verifies exactly one form per block: v1 below the v3.2.3
     * upgrade, v2 from it - pick with {@link #evmAuthDigestVersion}.
     *
     * @throws IllegalArgumentException if {@code gasLimit} is zero; the chain refuses it
     */
    public static byte[] evmAuthSignBytesV2(
            String chainId,
            String account,
            byte[] pubkey,
            String to,
            String value,
            byte[] data,
            long nonce,
            long gasLimit) {
        if (gasLimit == 0) {
            throw new IllegalArgumentException(
                    "gasLimit must be set (non-zero): the v2 digest binds it and the chain refuses 0");
        }
        GasLimits.checkEvmTxGas(gasLimit);
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        write(body, utf8(EVM_DOMAIN_V2));
        write(body, lp(utf8(chainId)));
        write(body, lp(utf8(account)));
        write(body, lp(nz(pubkey)));
        write(body, lp(utf8(to == null ? "" : to)));
        write(body, lp(utf8(value == null ? "0" : value)));
        write(body, lp(nz(data)));
        write(body, be64(nonce));
        write(body, be64(gasLimit));
        return Hashing.sha256(body.toByteArray());
    }

    /**
     * The {@code MsgExecuteEVM} digest the network verifies now: {@code "v2"} once
     * it has applied v3.2.3, {@code "v1"} before. A transport failure propagates -
     * never guess, the other form is refused.
     */
    public static String evmAuthDigestVersion(io.github.qorechain.query.RestClient rest, String cacheKey) {
        return io.github.qorechain.query.ChainUpgrades.isApplied(
                        rest, io.github.qorechain.query.ChainUpgrades.V3_2_3, cacheKey)
                ? "v2"
                : "v1";
    }

    /** A linked key's sequence, from {@link #fetchAuthNonce}. */
    public static final class AuthNonce {
        /** The nonce the next {@code MsgExecuteEVM} / {@code MsgExecuteCosmos} from this key must carry. */
        public final long nonce;
        /** Whether the key is currently linked (present and not revoked); the counter is kept either way. */
        public final boolean linked;

        public AuthNonce(long nonce, boolean linked) {
            this.nonce = nonce;
            this.linked = linked;
        }
    }

    /**
     * Read the sequence a linked authenticator key must sign next
     * ({@code /qorechain/abstractaccount/v1/auth_nonce/{address}/{pubkey_hex}}, chain
     * v3.2.4). This is the {@code nonce} of {@link #evmAuthSignBytes} /
     * {@link #evmAuthSignBytesV2} / {@link #cosmosAuthSignBytes}: the key's own
     * counter, not the account's EVM nonce. A key that never executed reads 0.
     *
     * @param address the {@code qor1…} account the key acts for.
     * @param pubkey the authenticator's raw public key.
     * @throws IllegalArgumentException when {@code pubkey} is empty.
     */
    public static AuthNonce fetchAuthNonce(io.github.qorechain.query.RestClient rest, String address, byte[] pubkey) {
        return fetchAuthNonce(rest, address, pubkey == null ? "" : Hex.encode(pubkey));
    }

    /**
     * {@link #fetchAuthNonce(io.github.qorechain.query.RestClient, String, byte[])}
     * with the key as hex ({@code 0x} optional).
     *
     * @throws IllegalArgumentException when {@code pubkeyHex} is empty, not hex, or of odd length.
     */
    public static AuthNonce fetchAuthNonce(io.github.qorechain.query.RestClient rest, String address, String pubkeyHex) {
        String hex = pubkeyHex == null ? "" : pubkeyHex.replaceFirst("^0[xX]", "");
        if (hex.isEmpty() || hex.length() % 2 != 0 || !hex.matches("^[0-9a-fA-F]*$")) {
            throw new IllegalArgumentException("fetchAuthNonce: pubkey must be bytes or a hex string");
        }
        String path =
                "/qorechain/abstractaccount/v1/auth_nonce/"
                        + java.net.URLEncoder.encode(address, StandardCharsets.UTF_8)
                        + "/"
                        + hex;
        com.fasterxml.jackson.databind.JsonNode b = rest.get(path);
        com.fasterxml.jackson.databind.JsonNode n = b == null ? null : b.get("nonce");
        if (n == null || !(n.isTextual() || n.isIntegralNumber())) {
            throw new IllegalStateException("auth_nonce query: no nonce in the answer for " + path);
        }
        long nonce;
        try {
            nonce = Long.parseUnsignedLong(n.asText().trim());
        } catch (NumberFormatException e) {
            throw new IllegalStateException("auth_nonce query: nonce is not an integer: \"" + n.asText() + "\"");
        }
        com.fasterxml.jackson.databind.JsonNode linked = b.get("linked");
        return new AuthNonce(nonce, linked != null && linked.isBoolean() && linked.asBoolean());
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
     *
     * <p>From chain v3.2.8 a failed execution still lands in a code-0 tx with
     * {@code success=false} and consumes the nonce: check the delivered result with
     * {@link #requireExecutionsSucceeded}.
     *
     * @throws IllegalArgumentException when {@code gasLimit} is above the chain's EVM
     *     gas cap ({@link GasLimits#DEFAULT_EVM_TX_MAX_GAS}).
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
        GasLimits.checkEvmTxGas(gasLimit);
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
     * single-coin string like {@code "100uqor"}. Check the delivered result with
     * {@link #requireExecutionsSucceeded} (a failed execution lands with code 0 from
     * chain v3.2.8).
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
     *
     * <p><b>Deprecated for new keys:</b> one mnemonic yields one key for every
     * account. Keep using it only to recover, or rotate away from, a key that was
     * registered this way ({@link #rotatePqcKeyMsgFromMnemonic}, which always
     * rotates to the address-bound derivation).
     */
    public static PqcKeypair derivePqcLegacy(String mnemonic) {
        return Pqc.generatePqcKeypair(Hashing.shake256(utf8(mnemonic), 32));
    }

    /**
     * Resolve {@code account} to the canonical form the address-bound PQC derivation
     * and the rotation message use: lower-case {@code qor1…} bech32.
     *
     * <p>Accepts a bech32 address in either case (all-lower or all-upper, as bech32
     * allows) or a {@code 0x}/{@code 0X} EVM address, which is re-encoded to its
     * bech32 form. Byte-identical to the Go SDK's resolution: the 20-byte payload is
     * re-encoded with the {@code qor} prefix.
     *
     * @throws IllegalArgumentException if {@code account} is not a valid 20-byte
     *     account address.
     */
    public static String canonicalAccount(String account) {
        if (account == null) {
            throw new IllegalArgumentException("account is required");
        }
        if (account.startsWith("0x") || account.startsWith("0X")) {
            return UnifiedAccounts.qoreAddresses(null, null, account.substring(2)).cosmos;
        }
        try {
            return UnifiedAccounts.qoreAddresses(account, null, null).cosmos;
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException(
                    "cannot resolve account \"" + account + "\" to a bech32 cosmos address: "
                            + e.getMessage(),
                    e);
        }
    }

    /**
     * The CANONICAL (SDK / wallet-adapter) address-bound PQC derivation for a
     * mnemonic: the same derivation {@link UnifiedAccounts#deriveUnifiedAccount}
     * uses - {@code ML-DSA-87 keygen(shake256("qorechain:pqc:v1|" + cosmos + "|" +
     * mnemonic, 32))}, where {@code cosmos} is {@code account} resolved by {@link
     * #canonicalAccount} - so an upper-case bech32 or a {@code 0x} form of the same
     * account yields the same key.
     *
     * @throws IllegalArgumentException if {@code account} is not a valid 20-byte
     *     account address.
     */
    public static PqcKeypair derivePqcCanonical(String account, String mnemonic) {
        String cosmos = canonicalAccount(account);
        byte[] seed = Hashing.shake256("qorechain:pqc:v1|" + cosmos + "|" + mnemonic, 32);
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
     * @param account the account: bech32 ({@code qor1…}, either case) or {@code 0x}. The
     *     message sender and the rotation sign-bytes always carry the canonical
     *     lower-case {@code qor1…} form (see {@link #canonicalAccount}).
     * @param mnemonic the BIP-39 mnemonic both derivations share.
     * @param chainId the chain id bound into the rotation bytes.
     * @param algorithmId the algorithm id bound into the rotation bytes (ML-DSA-87 = 1).
     * @throws IllegalArgumentException if both derivations produce the same key (no-op),
     *     or {@code account} is not a valid account address.
     */
    public static RotationResult rotatePqcKeyMsgFromMnemonic(
            String account, String mnemonic, String chainId, int algorithmId) {
        // The sender and the account in the rotation sign-bytes use the canonical
        // lower-case bech32 form, so an upper-case or 0x input builds the same
        // message the canonical input does (matching the Go SDK).
        account = canonicalAccount(account);
        PqcKeypair oldKp = derivePqcLegacy(mnemonic);
        PqcKeypair newKp = derivePqcCanonical(account, mnemonic);
        if (Hex.encode(oldKp.publicKey).equals(Hex.encode(newKp.publicKey))) {
            throw new IllegalArgumentException(
                    "old and new derivations produce the same key - rotation would be a no-op");
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

    // ---- linking a key: possession proof + spending rule (chain v3.2.8) ----

    /** The first line of the authenticator link message. */
    public static final String LINK_MESSAGE_HEADER = "QoreChain authenticator link v1";

    /**
     * The exact text the key being linked signs for {@code possession_proof} (chain
     * v3.2.8), lines joined with {@code "\n"} and no trailing newline:
     *
     * <pre>
     * QoreChain authenticator link v1
     * chain: &lt;chainId&gt;
     * account: &lt;accountAddress&gt;
     * scheme: &lt;scheme&gt;
     * key: &lt;lowercase hex of pubkey&gt;
     * </pre>
     *
     * {@code pubkey} is exactly the bytes put in {@code MsgRegisterAuthenticator.pubkey}:
     * a 32-byte ed25519 key, a 33-byte compressed secp256k1 key, or the 20-byte
     * Ethereum address for a MetaMask-style link. A browser wallet signs this text
     * itself (Phantom {@code signMessage}, MetaMask {@code personal_sign}).
     */
    public static String authenticatorLinkMessage(
            String chainId, String accountAddress, String scheme, byte[] pubkey) {
        return LINK_MESSAGE_HEADER
                + "\nchain: " + (chainId == null ? "" : chainId)
                + "\naccount: " + (accountAddress == null ? "" : accountAddress)
                + "\nscheme: " + (scheme == null ? "" : scheme)
                + "\nkey: " + Hex.encode(nz(pubkey)).toLowerCase(java.util.Locale.ROOT);
    }

    /** {@link #authenticatorLinkMessage} as UTF-8 bytes (what is signed). */
    public static byte[] authenticatorLinkMessageBytes(
            String chainId, String accountAddress, String scheme, byte[] pubkey) {
        return utf8(authenticatorLinkMessage(chainId, accountAddress, scheme, pubkey));
    }

    /** A linked key's public key bytes and the possession proof it made. */
    public static final class PossessionProof {
        /** The scheme, {@code "ed25519"} or {@code "secp256k1"}. */
        public final String scheme;
        /** The bytes to put in {@code pubkey} (32-byte ed25519, 33-byte secp256k1 or 20-byte address). */
        public final byte[] pubkey;
        /** The signature to put in {@code possession_proof}. */
        public final byte[] proof;

        public PossessionProof(String scheme, byte[] pubkey, byte[] proof) {
            this.scheme = scheme;
            this.pubkey = pubkey;
            this.proof = proof;
        }
    }

    /**
     * Possession proof by an ed25519 key: an ed25519 signature over the raw link
     * message bytes (what Phantom {@code signMessage(text)} makes).
     *
     * @param privateKey the 32-byte ed25519 seed (private key).
     */
    public static PossessionProof ed25519PossessionProof(byte[] privateKey, String chainId, String accountAddress) {
        if (privateKey == null || privateKey.length != 32) {
            throw new IllegalArgumentException("ed25519 possession proof: the private key must be a 32-byte seed");
        }
        byte[] pub = new byte[org.bouncycastle.math.ec.rfc8032.Ed25519.PUBLIC_KEY_SIZE];
        org.bouncycastle.math.ec.rfc8032.Ed25519.generatePublicKey(privateKey, 0, pub, 0);
        byte[] msg = authenticatorLinkMessageBytes(chainId, accountAddress, "ed25519", pub);
        byte[] sig = new byte[org.bouncycastle.math.ec.rfc8032.Ed25519.SIGNATURE_SIZE];
        org.bouncycastle.math.ec.rfc8032.Ed25519.sign(privateKey, 0, msg, 0, msg.length, sig, 0);
        return new PossessionProof("ed25519", pub, sig);
    }

    /**
     * Possession proof by a secp256k1 key linked by its 33-byte compressed public key:
     * a 64-byte low-S {@code r || s} ECDSA signature over {@code sha256(text)}.
     */
    public static PossessionProof secp256k1PossessionProof(byte[] privateKey, String chainId, String accountAddress) {
        byte[] pub = io.github.qorechain.accounts.Secp256k1.publicKey(privateKey, true);
        byte[] msg = authenticatorLinkMessageBytes(chainId, accountAddress, "secp256k1", pub);
        return new PossessionProof("secp256k1", pub, io.github.qorechain.accounts.Secp256k1.signCosmos(privateKey, msg));
    }

    /**
     * Possession proof by a secp256k1 key linked by its 20-byte Ethereum address
     * (MetaMask style): an EIP-191 {@code personal_sign} of the link text,
     * {@code keccak256("\x19Ethereum Signed Message:\n" + len(text) + text)}, as the
     * 65-byte {@code r || s || v} with {@code v} = 27 or 28.
     */
    public static PossessionProof eip191PossessionProof(byte[] privateKey, String chainId, String accountAddress) {
        byte[] addr = io.github.qorechain.accounts.Secp256k1.ethAddress(privateKey);
        byte[] msg = authenticatorLinkMessageBytes(chainId, accountAddress, "secp256k1", addr);
        byte[] sig = io.github.qorechain.accounts.Secp256k1.signHashRecoverable(privateKey, eip191Hash(msg));
        sig[64] = (byte) (sig[64] + 27);
        return new PossessionProof("secp256k1", addr, sig);
    }

    /** {@code keccak256("\x19Ethereum Signed Message:\n" + len(message) + message)}. */
    public static byte[] eip191Hash(byte[] message) {
        byte[] prefix = utf8("\u0019Ethereum Signed Message:\n" + message.length);
        byte[] all = new byte[prefix.length + message.length];
        System.arraycopy(prefix, 0, all, 0, prefix.length);
        System.arraycopy(message, 0, all, prefix.length, message.length);
        return Hashing.keccak256(all);
    }

    /** Options for {@link #linkAuthenticatorMsgs}. */
    public static final class LinkOptions {
        /** The account owner (root key) signing both messages. */
        public String owner;
        /** The account the key is linked to; defaults to {@link #owner}. */
        public String accountAddress;
        /** {@code "ed25519"} or {@code "secp256k1"}. */
        public String scheme;
        /** The linked key's bytes (see {@link #authenticatorLinkMessage}). */
        public byte[] pubkey;
        /** e.g. {@code "send"}, {@code "evm"}, {@code "svm"}. */
        public java.util.List<String> permissions = java.util.List.of();
        /** Unix seconds; within the chain's maximum session lifetime. */
        public long expiryUnix;
        public String label = "";
        /** The linked key's signature over {@link #authenticatorLinkMessage}; required. */
        public byte[] possessionProof;
        /**
         * The account's complete spending rules. {@code MsgUpdateSpendingRules}
         * REPLACES the account's rules wholesale, so pass every rule the account
         * should keep. Required (and its first enabled rule must bound every denom)
         * when {@link #permissions} holds a value permission; {@code null} sends no
         * rules update.
         */
        public java.util.List<qorechain.abstractaccount.v1.Tx.SpendingRule> spendingRules;
    }

    /**
     * The messages that link a key from chain v3.2.8, to send in ONE transaction signed
     * by the owner as top-level messages (not through authz):
     * {@code [MsgUpdateSpendingRules, MsgRegisterAuthenticator]}. The rules message
     * comes first; it may be sent for an account that does not exist yet when
     * {@code account_address == owner} (it creates the account).
     *
     * <p>A key with any of {@code send}, {@code evm}, {@code deploy}, {@code svm},
     * {@code all} needs an enabled rule on the account bounding every denom; this is
     * checked here ({@link io.github.qorechain.messages.SpendingRules#requireValueBound}).
     * Note that {@code MsgUpdateSpendingRules} replaces the account's rules wholesale.
     * Without a value permission and with {@code spendingRules == null}, only the
     * register message is returned.
     *
     * @throws IllegalArgumentException when the proof is empty or the rules do not bound value.
     */
    public static java.util.List<TypedMessage> linkAuthenticatorMsgs(LinkOptions o) {
        if (o == null || o.owner == null || o.owner.isEmpty()) {
            throw new IllegalArgumentException("linkAuthenticatorMsgs: owner is required");
        }
        String account = o.accountAddress == null || o.accountAddress.isEmpty() ? o.owner : o.accountAddress;
        java.util.List<String> perms = o.permissions == null ? java.util.List.of() : o.permissions;
        java.util.List<TypedMessage> out = new java.util.ArrayList<>();
        if (io.github.qorechain.messages.SpendingRules.hasValuePermission(perms) || o.spendingRules != null) {
            io.github.qorechain.messages.SpendingRules.requireValueBound(o.spendingRules, perms);
            out.add(QorechainMessages.abstractaccount.updateSpendingRules(
                    qorechain.abstractaccount.v1.Tx.MsgUpdateSpendingRules.newBuilder()
                            .setOwner(o.owner)
                            .setAccountAddress(account)
                            .addAllRules(o.spendingRules == null ? java.util.List.of() : o.spendingRules)
                            .build()));
        }
        out.add(QorechainMessages.abstractaccount.registerAuthenticator(
                qorechain.abstractaccount.v1.Tx.MsgRegisterAuthenticator.newBuilder()
                        .setOwner(o.owner)
                        .setAccountAddress(account)
                        .setScheme(o.scheme == null ? "" : o.scheme)
                        .setPubkey(ByteString.copyFrom(nz(o.pubkey)))
                        .addAllPermissions(perms)
                        .setExpiryUnix(o.expiryUnix)
                        .setLabel(o.label == null ? "" : o.label)
                        .setPossessionProof(ByteString.copyFrom(nz(o.possessionProof)))
                        .build()));
        return out;
    }

    // ---- execution results (chain v3.2.8) ----

    /** The event type the chain emits for an authorised execution that failed. */
    public static final String EXECUTION_FAILED_EVENT = "abstractaccount_execution_failed";

    private static final String EXECUTE_EVM_RESPONSE = "/qorechain.abstractaccount.v1.MsgExecuteEVMResponse";
    private static final String EXECUTE_COSMOS_RESPONSE = "/qorechain.abstractaccount.v1.MsgExecuteCosmosResponse";

    /** The outcome of one {@code MsgExecuteEVM} / {@code MsgExecuteCosmos} in a delivered tx. */
    public static final class ExecutionResult {
        /** {@code "evm"} or {@code "cosmos"}. */
        public final String lane;
        public final boolean success;
        /** The EVM return data (empty for the Cosmos lane). */
        public final byte[] ret;
        public final long gasUsed;
        /** The EVM error string, if any. */
        public final String vmError;
        /**
         * The {@code reason} of the matching {@value #EXECUTION_FAILED_EVENT} event for a
         * failed execution (the k-th failed execution takes the k-th such event), else
         * {@code ""}.
         */
        public final String reason;

        public ExecutionResult(String lane, boolean success, byte[] ret, long gasUsed, String vmError, String reason) {
            this.lane = lane;
            this.success = success;
            this.ret = ret;
            this.gasUsed = gasUsed;
            this.vmError = vmError;
            this.reason = reason;
        }
    }

    /** Thrown by {@link #requireExecutionsSucceeded} when an execution failed inside a code-0 tx. */
    public static final class ExecutionFailedException extends RuntimeException {
        public final java.util.List<ExecutionResult> results;

        public ExecutionFailedException(String message, java.util.List<ExecutionResult> results) {
            super(message);
            this.results = results;
        }
    }

    /**
     * The per-message outcome of every {@code MsgExecuteEVM} / {@code MsgExecuteCosmos}
     * in a delivered tx, in message order. From chain v3.2.8 an authorised execution
     * that fails returns {@code success=false} inside a tx with code 0 and emits a
     * {@value #EXECUTION_FAILED_EVENT} event; its nonce is consumed, so the same
     * signature cannot be relayed again. Needs a {@link Broadcaster.Mode#COMMIT} result
     * (the only mode that carries the responses).
     */
    public static java.util.List<ExecutionResult> executionResults(Broadcaster.Result result) {
        if (result == null) {
            return java.util.List.of();
        }
        return executionResults(result.data, result.events);
    }

    /** {@link #executionResults(Broadcaster.Result)} from a tx result's {@code data} (TxMsgData) and events. */
    public static java.util.List<ExecutionResult> executionResults(
            byte[] txResultData, java.util.List<Broadcaster.Event> events) {
        java.util.List<String> reasons = new java.util.ArrayList<>();
        if (events != null) {
            for (Broadcaster.Event e : events) {
                if (EXECUTION_FAILED_EVENT.equals(e.type)) {
                    String r = e.attribute("reason");
                    reasons.add(r == null ? "" : r);
                }
            }
        }
        java.util.List<ExecutionResult> out = new java.util.ArrayList<>();
        int failed = 0;
        for (com.google.protobuf.Any any : msgResponses(txResultData)) {
            try {
                if (EXECUTE_EVM_RESPONSE.equals(any.getTypeUrl())) {
                    var r = qorechain.abstractaccount.v1.Tx.MsgExecuteEVMResponse.parseFrom(any.getValue());
                    String reason = !r.getSuccess() && failed < reasons.size() ? reasons.get(failed) : "";
                    if (!r.getSuccess()) failed++;
                    out.add(new ExecutionResult("evm", r.getSuccess(), r.getRet().toByteArray(),
                            r.getGasUsed(), r.getVmError(), reason));
                } else if (EXECUTE_COSMOS_RESPONSE.equals(any.getTypeUrl())) {
                    var r = qorechain.abstractaccount.v1.Tx.MsgExecuteCosmosResponse.parseFrom(any.getValue());
                    String reason = !r.getSuccess() && failed < reasons.size() ? reasons.get(failed) : "";
                    if (!r.getSuccess()) failed++;
                    out.add(new ExecutionResult("cosmos", r.getSuccess(), new byte[0], 0L, "", reason));
                }
            } catch (com.google.protobuf.InvalidProtocolBufferException e) {
                throw new IllegalArgumentException("failed to decode " + any.getTypeUrl(), e);
            }
        }
        return out;
    }

    /**
     * {@link #executionResults(Broadcaster.Result)}, throwing when any execution failed
     * even though the tx code is 0.
     *
     * @throws ExecutionFailedException naming the failed executions and their reasons.
     */
    public static java.util.List<ExecutionResult> requireExecutionsSucceeded(Broadcaster.Result result) {
        java.util.List<ExecutionResult> rs = executionResults(result);
        StringBuilder msg = new StringBuilder();
        for (int i = 0; i < rs.size(); i++) {
            ExecutionResult r = rs.get(i);
            if (!r.success) {
                msg.append(msg.length() == 0 ? "" : "; ")
                        .append("execution ").append(i).append(" (").append(r.lane).append(") failed");
                String why = !r.reason.isEmpty() ? r.reason : r.vmError;
                if (!why.isEmpty()) msg.append(": ").append(why);
            }
        }
        if (msg.length() > 0) {
            throw new ExecutionFailedException(
                    msg + " (the tx itself succeeded and the nonce was consumed; sign a new execution"
                            + " with the next nonce to retry)", rs);
        }
        return rs;
    }

    /** The {@code msg_responses} (field 2) of a {@code TxMsgData}. */
    static java.util.List<com.google.protobuf.Any> msgResponses(byte[] txMsgData) {
        java.util.List<com.google.protobuf.Any> out = new java.util.ArrayList<>();
        if (txMsgData == null || txMsgData.length == 0) {
            return out;
        }
        try {
            com.google.protobuf.CodedInputStream in = com.google.protobuf.CodedInputStream.newInstance(txMsgData);
            while (true) {
                int tag = in.readTag();
                if (tag == 0) break;
                if (tag == ((2 << 3) | 2)) {
                    out.add(com.google.protobuf.Any.parseFrom(in.readBytes()));
                } else if (!in.skipField(tag)) {
                    break;
                }
            }
        } catch (java.io.IOException e) {
            throw new IllegalArgumentException("failed to decode tx result data (TxMsgData)", e);
        }
        return out;
    }

    private static void write(ByteArrayOutputStream out, byte[] b) {
        out.write(b, 0, b.length);
    }
}
