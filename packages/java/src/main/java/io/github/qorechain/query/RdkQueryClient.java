package io.github.qorechain.query;

import com.google.protobuf.ByteString;
import com.google.protobuf.InvalidProtocolBufferException;
import qorechain.rdk.v1.QueryOuterClass;

/**
 * Typed query client for the rdk (rollup development kit) module {@code Query}
 * service, dispatched over {@link AbciQueryClient}.
 *
 * <p>Each method encodes its {@code Query*Request}, calls the matching ABCI query
 * method, and decodes the {@code Query*Response}.
 */
public final class RdkQueryClient {

    private static final String SERVICE = "qorechain.rdk.v1.Query";

    private final AbciQueryClient abci;

    public RdkQueryClient(AbciQueryClient abci) {
        this.abci = abci;
    }

    public RdkQueryClient(String url) {
        this(new AbciQueryClient(url));
    }

    /** {@code Params} — the module parameters. */
    public QueryOuterClass.QueryParamsResponse params() {
        ByteString req = QueryOuterClass.QueryParamsRequest.newBuilder().build().toByteString();
        return decode(abci.request(SERVICE, "Params", req), QueryOuterClass.QueryParamsResponse.parser());
    }

    /** {@code Rollup} — a single rollup config by id. */
    public QueryOuterClass.QueryRollupResponse rollup(String rollupId) {
        ByteString req =
                QueryOuterClass.QueryRollupRequest.newBuilder()
                        .setRollupId(rollupId)
                        .build()
                        .toByteString();
        return decode(abci.request(SERVICE, "Rollup", req), QueryOuterClass.QueryRollupResponse.parser());
    }

    /** {@code Rollups} — all rollups. */
    public QueryOuterClass.QueryRollupsResponse rollups() {
        ByteString req = QueryOuterClass.QueryRollupsRequest.newBuilder().build().toByteString();
        return decode(abci.request(SERVICE, "Rollups", req), QueryOuterClass.QueryRollupsResponse.parser());
    }

    /** {@code Batch} — a settlement batch by {@code (rollupId, batchIndex)}. */
    public QueryOuterClass.QueryBatchResponse batch(String rollupId, long batchIndex) {
        ByteString req =
                QueryOuterClass.QueryBatchRequest.newBuilder()
                        .setRollupId(rollupId)
                        .setBatchIndex(batchIndex)
                        .build()
                        .toByteString();
        return decode(abci.request(SERVICE, "Batch", req), QueryOuterClass.QueryBatchResponse.parser());
    }

    /** {@code LatestBatch} — the latest settlement batch for a rollup. */
    public QueryOuterClass.QueryLatestBatchResponse latestBatch(String rollupId) {
        ByteString req =
                QueryOuterClass.QueryLatestBatchRequest.newBuilder()
                        .setRollupId(rollupId)
                        .build()
                        .toByteString();
        return decode(
                abci.request(SERVICE, "LatestBatch", req),
                QueryOuterClass.QueryLatestBatchResponse.parser());
    }

    private static <T extends com.google.protobuf.Message> T decode(
            ByteString bytes, com.google.protobuf.Parser<T> parser) {
        try {
            return parser.parseFrom(bytes);
        } catch (InvalidProtocolBufferException e) {
            throw new IllegalStateException("failed to decode rdk query response", e);
        }
    }
}
