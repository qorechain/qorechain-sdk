package io.github.qorechain.tx;

import java.math.BigInteger;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * A gas price ({@code <amount><denom>}, e.g. {@code "0.025uqor"}) and exact,
 * integer-only fee calculation.
 *
 * <p>{@link #calculateFee} computes {@code ceil(gasLimit * price)} with
 * {@link BigInteger} math — no floating point — matching the Cosmos
 * {@code GasPrice}/{@code calculateFee} semantics.
 */
public final class GasPrice {

    private static final Pattern PATTERN =
            Pattern.compile("^([0-9]+(?:\\.[0-9]+)?)\\s*([a-zA-Z][a-zA-Z0-9/:._-]*)$");

    /**
     * The default gas price for QoreChain. The chain enforces a genesis
     * min-gas-price (BaseFee) of {@code 0.1uqor}/gas on both networks; the
     * default sits above the floor for headroom.
     */
    public static final String DEFAULT_GAS_PRICE = "0.15uqor";
    /** The default gas multiplier applied to a simulated gas estimate. */
    public static final double DEFAULT_GAS_MULTIPLIER = 1.4;

    private final BigInteger numerator;
    private final int scale;
    public final String denom;

    private GasPrice(BigInteger numerator, int scale, String denom) {
        this.numerator = numerator;
        this.scale = scale;
        this.denom = denom;
    }

    /** Parse a gas price string such as {@code "0.025uqor"}. */
    public static GasPrice fromString(String s) {
        Matcher m = PATTERN.matcher(s.trim());
        if (!m.matches()) {
            throw new IllegalArgumentException("invalid gas price: " + s);
        }
        String num = m.group(1);
        String denom = m.group(2);
        int dot = num.indexOf('.');
        int scale = dot < 0 ? 0 : num.length() - dot - 1;
        BigInteger numerator = new BigInteger(num.replace(".", ""));
        return new GasPrice(numerator, scale, denom);
    }

    /** Compute the fee for a gas limit: {@code ceil(gasLimit * numerator / 10^scale)}. */
    public StdFee calculateFee(long gasLimit) {
        BigInteger denomDiv = BigInteger.TEN.pow(scale);
        BigInteger product = BigInteger.valueOf(gasLimit).multiply(numerator);
        // Ceiling division.
        BigInteger amount = product.add(denomDiv).subtract(BigInteger.ONE).divide(denomDiv);
        List<StdFee.Coin> coins = new ArrayList<>();
        coins.add(new StdFee.Coin(this.denom, amount.toString()));
        return new StdFee(coins, Long.toString(gasLimit));
    }

    /** Convenience: {@code GasPrice.fromString(price).calculateFee(gas)}. */
    public static StdFee calculateFee(long gasLimit, String gasPrice) {
        return fromString(gasPrice).calculateFee(gasLimit);
    }

    /** Apply the gas multiplier to a simulated gas estimate (ceil). */
    public static long applyMultiplier(long simulatedGas, double multiplier) {
        return (long) Math.ceil(simulatedGas * multiplier);
    }
}
