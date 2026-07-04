package io.github.qorechain.query;

import com.google.protobuf.ByteString;
import com.google.protobuf.InvalidProtocolBufferException;
import qorechain.amm.v1.QueryOuterClass;

/**
 * Typed query client for the AMM module {@code Query} service, dispatched over
 * {@link AbciQueryClient}.
 */
public final class AmmQueryClient {

    private static final String SERVICE = "qorechain.amm.v1.Query";

    private final AbciQueryClient abci;

    public AmmQueryClient(AbciQueryClient abci) {
        this.abci = abci;
    }

    public AmmQueryClient(String url) {
        this(new AbciQueryClient(url));
    }

    /** {@code Params} — the module parameters. */
    public QueryOuterClass.QueryParamsResponse params() {
        ByteString req = QueryOuterClass.QueryParamsRequest.newBuilder().build().toByteString();
        return decode(
                abci.request(SERVICE, "Params", req), QueryOuterClass.QueryParamsResponse.parser());
    }

    /** {@code Pool} — a single pool by id. */
    public QueryOuterClass.QueryPoolResponse pool(long poolId) {
        ByteString req =
                QueryOuterClass.QueryPoolRequest.newBuilder().setPoolId(poolId).build().toByteString();
        return decode(
                abci.request(SERVICE, "Pool", req), QueryOuterClass.QueryPoolResponse.parser());
    }

    /** {@code Pools} — all pools. */
    public QueryOuterClass.QueryPoolsResponse pools() {
        ByteString req = QueryOuterClass.QueryPoolsRequest.newBuilder().build().toByteString();
        return decode(
                abci.request(SERVICE, "Pools", req), QueryOuterClass.QueryPoolsResponse.parser());
    }

    /** {@code PoolByDenoms} — the pool for a token pair. */
    public QueryOuterClass.QueryPoolByDenomsResponse poolByDenoms(String denomA, String denomB) {
        ByteString req =
                QueryOuterClass.QueryPoolByDenomsRequest.newBuilder()
                        .setDenomA(denomA)
                        .setDenomB(denomB)
                        .build()
                        .toByteString();
        return decode(
                abci.request(SERVICE, "PoolByDenoms", req),
                QueryOuterClass.QueryPoolByDenomsResponse.parser());
    }

    /** {@code LPBalance} — an address's LP-share balance in a pool. */
    public QueryOuterClass.QueryLPBalanceResponse lpBalance(long poolId, String address) {
        ByteString req =
                QueryOuterClass.QueryLPBalanceRequest.newBuilder()
                        .setPoolId(poolId)
                        .setAddress(address)
                        .build()
                        .toByteString();
        return decode(
                abci.request(SERVICE, "LPBalance", req),
                QueryOuterClass.QueryLPBalanceResponse.parser());
    }

    /** {@code QuoteExactIn} — quote the output for an exact input amount. */
    public QueryOuterClass.QueryQuoteExactInResponse quoteExactIn(
            long poolId, String denomIn, String amountIn) {
        ByteString req =
                QueryOuterClass.QueryQuoteExactInRequest.newBuilder()
                        .setPoolId(poolId)
                        .setDenomIn(denomIn)
                        .setAmountIn(amountIn)
                        .build()
                        .toByteString();
        return decode(
                abci.request(SERVICE, "QuoteExactIn", req),
                QueryOuterClass.QueryQuoteExactInResponse.parser());
    }

    /** {@code QuoteExactOut} — quote the input required for an exact output amount. */
    public QueryOuterClass.QueryQuoteExactOutResponse quoteExactOut(
            long poolId, String denomOut, String amountOut) {
        ByteString req =
                QueryOuterClass.QueryQuoteExactOutRequest.newBuilder()
                        .setPoolId(poolId)
                        .setDenomOut(denomOut)
                        .setAmountOut(amountOut)
                        .build()
                        .toByteString();
        return decode(
                abci.request(SERVICE, "QuoteExactOut", req),
                QueryOuterClass.QueryQuoteExactOutResponse.parser());
    }

    private static <T extends com.google.protobuf.Message> T decode(
            ByteString bytes, com.google.protobuf.Parser<T> parser) {
        try {
            return parser.parseFrom(bytes);
        } catch (InvalidProtocolBufferException e) {
            throw new IllegalStateException("failed to decode amm query response", e);
        }
    }
}
