package io.github.qorechain.query;

import com.google.protobuf.ByteString;
import com.google.protobuf.InvalidProtocolBufferException;
import qorechain.multilayer.v1.QueryOuterClass;

/**
 * Typed query client for the multilayer module {@code Query} service, dispatched
 * over {@link AbciQueryClient}.
 *
 * <p>Each method encodes its {@code Query*Request}, calls the matching ABCI query
 * method, and decodes the response.
 */
public final class MultilayerQueryClient {

    private static final String SERVICE = "qorechain.multilayer.v1.Query";

    private final AbciQueryClient abci;

    public MultilayerQueryClient(AbciQueryClient abci) {
        this.abci = abci;
    }

    public MultilayerQueryClient(String url) {
        this(new AbciQueryClient(url));
    }

    /** {@code Params} — the module parameters. */
    public QueryOuterClass.QueryParamsResponse params() {
        ByteString req = QueryOuterClass.QueryParamsRequest.newBuilder().build().toByteString();
        return decode(abci.request(SERVICE, "Params", req), QueryOuterClass.QueryParamsResponse.parser());
    }

    /** {@code Layer} — a single layer config by id. */
    public QueryOuterClass.QueryLayerResponse layer(String layerId) {
        ByteString req =
                QueryOuterClass.QueryLayerRequest.newBuilder()
                        .setLayerId(layerId)
                        .build()
                        .toByteString();
        return decode(abci.request(SERVICE, "Layer", req), QueryOuterClass.QueryLayerResponse.parser());
    }

    /** {@code Layers} — all layers. */
    public QueryOuterClass.QueryLayersResponse layers() {
        ByteString req = QueryOuterClass.QueryLayersRequest.newBuilder().build().toByteString();
        return decode(abci.request(SERVICE, "Layers", req), QueryOuterClass.QueryLayersResponse.parser());
    }

    /** {@code RoutingStats} — the cross-layer routing statistics. */
    public QueryOuterClass.QueryRoutingStatsView routingStats() {
        ByteString req =
                QueryOuterClass.QueryRoutingStatsRequest.newBuilder().build().toByteString();
        return decode(
                abci.request(SERVICE, "RoutingStats", req),
                QueryOuterClass.QueryRoutingStatsView.parser());
    }

    private static <T extends com.google.protobuf.Message> T decode(
            ByteString bytes, com.google.protobuf.Parser<T> parser) {
        try {
            return parser.parseFrom(bytes);
        } catch (InvalidProtocolBufferException e) {
            throw new IllegalStateException("failed to decode multilayer query response", e);
        }
    }
}
