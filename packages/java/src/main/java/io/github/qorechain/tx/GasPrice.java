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
 * {@link BigInteger} math - no floating point - matching the QoreChain Native
 * {@code GasPrice}/{@code calculateFee} semantics.
 */
public final class GasPrice {

    private static final Pattern PATTERN =
            Pattern.compile("^([0-9]+(?:\\.[0-9]+)?)\\s*([a-zA-Z][a-zA-Z0-9/:._-]*)$");

    /**
     * The default gas price for QoreChain. The chain enforces a genesis
     * min-gas-price (BaseFee) of {@code 0.1uqor}/gas on both networks; the
     * default sits above the floor for headroom.
     *
     * <p>The chain may later move its minimum inside a governance band. To follow it,
     * opt in to {@link #fetchMinGasPriceUqor} / {@link #recommendedGasPriceUqor} (one
     * REST query); nothing in the SDK makes that call by default.
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

    /** The REST route of the fee-market parameters ({@code params.min_gas_price}). */
    public static final String FEEMARKET_PARAMS_PATH = "/cosmos/evm/feemarket/v1/params";

    /** The genesis floor, in uqor per gas, below which the fetched minimum is never reported. */
    public static final java.math.BigDecimal MIN_GAS_PRICE_FLOOR_UQOR = new java.math.BigDecimal("0.1");

    /** The smallest recommended price, in uqor per gas (the default gas price). */
    public static final java.math.BigDecimal RECOMMENDED_GAS_PRICE_FLOOR_UQOR = new java.math.BigDecimal("0.15");

    /** The default margin of {@link #recommendedGasPriceUqor(io.github.qorechain.query.RestClient)}. */
    public static final java.math.BigDecimal DEFAULT_GAS_PRICE_MARGIN = new java.math.BigDecimal("1.5");

    private static final java.math.BigDecimal EVM_TO_UQOR = new java.math.BigDecimal("1000000000000");

    /**
     * The minimum gas price the chain enforces, in uqor per gas, from a fee-market
     * params body: {@code params.min_gas_price} (a decimal in the 18-decimal EVM unit)
     * divided by 10^12, parsed exactly, and never below {@link #MIN_GAS_PRICE_FLOOR_UQOR}.
     */
    public static java.math.BigDecimal minGasPriceUqorOf(com.fasterxml.jackson.databind.JsonNode body) {
        com.fasterxml.jackson.databind.JsonNode v =
                body == null ? null : body.path("params").get("min_gas_price");
        if (v == null || v.isNull()) {
            throw new IllegalArgumentException("feemarket params: no params.min_gas_price in the answer");
        }
        java.math.BigDecimal evm;
        try {
            evm = new java.math.BigDecimal(v.asText().trim());
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(
                    "feemarket params: min_gas_price \"" + v.asText() + "\" is not a decimal");
        }
        java.math.BigDecimal uqor = evm.divide(EVM_TO_UQOR).stripTrailingZeros();
        return uqor.max(MIN_GAS_PRICE_FLOOR_UQOR);
    }

    /**
     * Opt-in: query {@value #FEEMARKET_PARAMS_PATH} and return the enforced minimum gas
     * price in uqor per gas ({@link #minGasPriceUqorOf}). Use
     * {@code minGasPrice.toPlainString() + "uqor"} as a gas price string.
     */
    public static java.math.BigDecimal fetchMinGasPriceUqor(io.github.qorechain.query.RestClient rest) {
        return minGasPriceUqorOf(rest.get(FEEMARKET_PARAMS_PATH));
    }

    /**
     * Opt-in: {@code max(0.15, fetchMinGasPriceUqor(rest) * margin)} in uqor per gas.
     *
     * @throws IllegalArgumentException when {@code margin} is below 1.
     */
    public static java.math.BigDecimal recommendedGasPriceUqor(
            io.github.qorechain.query.RestClient rest, java.math.BigDecimal margin) {
        return recommendedGasPriceUqor(fetchMinGasPriceUqor(rest), margin);
    }

    /** {@link #recommendedGasPriceUqor(io.github.qorechain.query.RestClient, java.math.BigDecimal)} with margin 1.5. */
    public static java.math.BigDecimal recommendedGasPriceUqor(io.github.qorechain.query.RestClient rest) {
        return recommendedGasPriceUqor(rest, DEFAULT_GAS_PRICE_MARGIN);
    }

    /** {@code max(0.15, minGasPriceUqor * margin)}, without a network call. */
    public static java.math.BigDecimal recommendedGasPriceUqor(
            java.math.BigDecimal minGasPriceUqor, java.math.BigDecimal margin) {
        java.math.BigDecimal m = margin == null ? DEFAULT_GAS_PRICE_MARGIN : margin;
        if (m.compareTo(java.math.BigDecimal.ONE) < 0) {
            throw new IllegalArgumentException("gas price margin must be at least 1, got " + m);
        }
        return minGasPriceUqor.multiply(m).stripTrailingZeros().max(RECOMMENDED_GAS_PRICE_FLOOR_UQOR);
    }

    /** Apply the gas multiplier to a simulated gas estimate (ceil). */
    public static long applyMultiplier(long simulatedGas, double multiplier) {
        return (long) Math.ceil(simulatedGas * multiplier);
    }
}
