package io.github.qorechain.tx;

import java.util.ArrayList;
import java.util.List;

/** A transaction fee: a list of coin amounts, a gas limit, and optional payer/granter. */
public final class StdFee {

    /** A {@code (denom, amount)} fee coin. */
    public static final class Coin {
        public final String denom;
        public final String amount;

        public Coin(String denom, String amount) {
            this.denom = denom;
            this.amount = amount;
        }
    }

    public final List<Coin> amount;
    public final String gas;
    public final String payer;
    public final String granter;

    public StdFee(List<Coin> amount, String gas, String payer, String granter) {
        this.amount = amount;
        this.gas = gas;
        this.payer = payer;
        this.granter = granter;
    }

    public StdFee(List<Coin> amount, String gas) {
        this(amount, gas, "", "");
    }

    /** Convenience: a single-coin fee with no payer/granter. */
    public static StdFee of(String denom, String amount, String gas) {
        List<Coin> coins = new ArrayList<>();
        coins.add(new Coin(denom, amount));
        return new StdFee(coins, gas);
    }
}
