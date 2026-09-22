package io.github.qorechain.evm;

import io.github.qorechain.address.Address;
import io.github.qorechain.messages.QorechainMessages;
import io.github.qorechain.messages.TypedMessage;
import java.math.BigInteger;
import qorechain.pqc.v1.Tx;

/**
 * The EVM authorisation window (chain v3.2.0): message composers with the
 * chain's {@code ValidateBasic} bounds checked locally.
 *
 * <p>From chain v3.2.0 an EVM transaction is admitted only from an account that
 * has <strong>both</strong> a registered post-quantum key <strong>and</strong> an
 * open, unexhausted window. Opening one is an ordinary Cosmos-lane protobuf
 * message that travels the normal hybrid signing path — the classical key alone
 * can never open a window — so an EVM wallet keeps working unmodified
 * <em>inside</em> a window.
 *
 * <p>Three traps, all of which a wallet gets wrong by default:
 *
 * <ol>
 *   <li><strong>Ordering.</strong> QoreChain unifies the identity, so the Cosmos
 *       sequence <em>is</em> the EVM nonce, and opening a window advances it
 *       (measured: nonce 2 before, 3 after). Open the window, THEN read the
 *       nonce, THEN sign the EVM transaction; the other order gives "nonce too
 *       low".
 *   <li><strong>{@code maxValue} bounds value plus fees.</strong> It counts the
 *       transferred value AND the maximum fee each admitted transaction could
 *       pay (gas limit × gas fee cap), because the holder of the classical key
 *       sets the gas price. Measured on the testnet: a 1,000 uqor transfer with
 *       a 21,000 gas limit at 112.5 gwei consumed 3,363 uqor of the window.
 *       wei→uqor rounds UP.
 *   <li><strong>Never print "about 24 hours" for 17280 blocks.</strong> The chain
 *       constant says so at 5s blocks, but no QoreChain network runs at 5s: the
 *       testnet is at ~1.03 s (≈ 5 hours), mainnet at ~3.1 s (≈ 15 hours). Say
 *       "up to 17280 blocks", or compute from the chain's recent block time.
 * </ol>
 *
 * <p>There is deliberately <strong>no automatic opening</strong> here: a window
 * is an explicit authorisation the user makes.
 */
public final class EvmWindow {

    private EvmWindow() {}

    /**
     * The largest lifetime a window may be opened for ({@code MaxEVMWindowBlocks}).
     * See trap 3: do not present it to a user as "24 hours".
     */
    public static final long MAX_BLOCKS = 17280L;

    /**
     * The largest number of EVM transactions a window may admit
     * ({@code MaxEVMWindowTxs}). Zero is refused: a window that admits nothing is
     * a mistake, not a policy.
     */
    public static final long MAX_TXS = 1000L;

    /** The REST route for one account's window. */
    public static String restPath(String address) {
        return "/qorechain/pqc/v1/evm_window/" + address;
    }

    /**
     * Build a validated {@code MsgOpenEVMWindow}. {@code maxValueUqor} is an
     * integer amount of uqor as a decimal string (a {@code cosmos.Int} on the
     * wire, so it never passes through a float).
     *
     * <p>Every field is required: the chain refuses a missing one rather than
     * defaulting it. Opening replaces any existing window.
     *
     * @throws IllegalArgumentException if any bound is broken; the message names
     *     the bound.
     */
    public static TypedMessage open(String sender, long blocks, long maxTxs, String maxValueUqor) {
        return QorechainMessages.pqc.openEvmWindow(openMessage(sender, blocks, maxTxs, maxValueUqor));
    }

    /** The same as {@link #open} , returning the bare protobuf message. */
    public static Tx.MsgOpenEVMWindow openMessage(
            String sender, long blocks, long maxTxs, String maxValueUqor) {
        Tx.MsgOpenEVMWindow msg =
                Tx.MsgOpenEVMWindow.newBuilder()
                        .setSender(sender == null ? "" : sender)
                        .setBlocks(blocks)
                        .setMaxTxs(maxTxs)
                        .setMaxValue(maxValueUqor == null ? "" : maxValueUqor.trim())
                        .build();
        validateOpen(msg);
        return msg;
    }

    /**
     * Build a validated {@code MsgCloseEVMWindow}. Closing takes effect in the
     * same block.
     *
     * @throws IllegalArgumentException if the sender is not a {@code qor} address.
     */
    public static TypedMessage close(String sender) {
        return QorechainMessages.pqc.closeEvmWindow(closeMessage(sender));
    }

    /** The same as {@link #close} , returning the bare protobuf message. */
    public static Tx.MsgCloseEVMWindow closeMessage(String sender) {
        Tx.MsgCloseEVMWindow msg =
                Tx.MsgCloseEVMWindow.newBuilder().setSender(sender == null ? "" : sender).build();
        validateClose(msg);
        return msg;
    }

    /**
     * Mirror the chain's {@code ValidateBasic} for {@code MsgOpenEVMWindow} so a
     * caller fails fast, locally, instead of paying for a refused transaction:
     * sender is a valid {@code qor} bech32 address, {@code blocks} is in
     * 1..{@value #MAX_BLOCKS}, {@code max_txs} is in 1..{@value #MAX_TXS}, and
     * {@code max_value} is a positive integer amount of uqor.
     */
    public static void validateOpen(Tx.MsgOpenEVMWindow msg) {
        if (msg == null) {
            throw new IllegalArgumentException("open evm window: message is null");
        }
        validateSender(msg.getSender());
        long blocks = msg.getBlocks();
        if (blocks < 1 || blocks > MAX_BLOCKS) {
            throw new IllegalArgumentException(
                    "open evm window: blocks must be between 1 and "
                            + MAX_BLOCKS
                            + " (MaxEVMWindowBlocks), got "
                            + blocks);
        }
        long maxTxs = msg.getMaxTxs();
        if (maxTxs < 1 || maxTxs > MAX_TXS) {
            throw new IllegalArgumentException(
                    "open evm window: max_txs must be between 1 and "
                            + MAX_TXS
                            + " (MaxEVMWindowTxs), got "
                            + maxTxs);
        }
        String raw = msg.getMaxValue();
        if (raw == null || raw.isEmpty()) {
            throw new IllegalArgumentException(
                    "open evm window: max_value is required (an integer amount of uqor greater than 0)");
        }
        BigInteger value;
        try {
            value = new BigInteger(raw);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(
                    "open evm window: max_value \"" + raw + "\" is not an integer amount of uqor");
        }
        if (value.signum() <= 0) {
            throw new IllegalArgumentException(
                    "open evm window: max_value must be greater than 0 uqor, got " + value);
        }
    }

    /** Mirror the chain's {@code ValidateBasic} for {@code MsgCloseEVMWindow}. */
    public static void validateClose(Tx.MsgCloseEVMWindow msg) {
        if (msg == null) {
            throw new IllegalArgumentException("close evm window: message is null");
        }
        validateSender(msg.getSender());
    }

    private static void validateSender(String sender) {
        if (sender == null || sender.isEmpty()) {
            throw new IllegalArgumentException("evm window: sender is required");
        }
        if (!Address.isValidBech32(sender, "qor")) {
            throw new IllegalArgumentException(
                    "evm window: sender \"" + sender + "\" is not a valid qor bech32 address");
        }
    }
}
