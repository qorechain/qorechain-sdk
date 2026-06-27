package io.github.qorechain.query;

import com.google.protobuf.ByteString;
import com.google.protobuf.InvalidProtocolBufferException;
import qorechain.bridge.v1.QueryOuterClass;

/**
 * Typed query client for the bridge module {@code Query} service, dispatched over
 * {@link AbciQueryClient}.
 *
 * <p>Each method encodes its {@code Query*Request}, calls the matching ABCI query
 * method, and decodes the response.
 */
public final class BridgeQueryClient {

    private static final String SERVICE = "qorechain.bridge.v1.Query";

    private final AbciQueryClient abci;

    public BridgeQueryClient(AbciQueryClient abci) {
        this.abci = abci;
    }

    public BridgeQueryClient(String url) {
        this(new AbciQueryClient(url));
    }

    /** {@code Config} — the global bridge config. */
    public QueryOuterClass.QueryConfigResponse config() {
        ByteString req = QueryOuterClass.QueryConfigRequest.newBuilder().build().toByteString();
        return decode(abci.request(SERVICE, "Config", req), QueryOuterClass.QueryConfigResponse.parser());
    }

    /** {@code ChainConfig} — a single chain config by id. */
    public QueryOuterClass.QueryChainConfigResponse chainConfig(String chainId) {
        ByteString req =
                QueryOuterClass.QueryChainConfigRequest.newBuilder()
                        .setChainId(chainId)
                        .build()
                        .toByteString();
        return decode(
                abci.request(SERVICE, "ChainConfig", req),
                QueryOuterClass.QueryChainConfigResponse.parser());
    }

    /** {@code ChainConfigs} — all configured chains. */
    public QueryOuterClass.QueryChainConfigsResponse chainConfigs() {
        ByteString req =
                QueryOuterClass.QueryChainConfigsRequest.newBuilder().build().toByteString();
        return decode(
                abci.request(SERVICE, "ChainConfigs", req),
                QueryOuterClass.QueryChainConfigsResponse.parser());
    }

    /** {@code Validator} — a single bridge validator by address. */
    public QueryOuterClass.QueryValidatorResponse validator(String address) {
        ByteString req =
                QueryOuterClass.QueryValidatorRequest.newBuilder()
                        .setAddress(address)
                        .build()
                        .toByteString();
        return decode(
                abci.request(SERVICE, "Validator", req),
                QueryOuterClass.QueryValidatorResponse.parser());
    }

    /** {@code Validators} — all bridge validators. */
    public QueryOuterClass.QueryValidatorsResponse validators() {
        ByteString req =
                QueryOuterClass.QueryValidatorsRequest.newBuilder().build().toByteString();
        return decode(
                abci.request(SERVICE, "Validators", req),
                QueryOuterClass.QueryValidatorsResponse.parser());
    }

    /** {@code Operation} — a single bridge operation by id. */
    public QueryOuterClass.QueryOperationResponse operation(String id) {
        ByteString req =
                QueryOuterClass.QueryOperationRequest.newBuilder()
                        .setId(id)
                        .build()
                        .toByteString();
        return decode(
                abci.request(SERVICE, "Operation", req),
                QueryOuterClass.QueryOperationResponse.parser());
    }

    /** {@code Operations} — all bridge operations. */
    public QueryOuterClass.QueryOperationsResponse operations() {
        ByteString req =
                QueryOuterClass.QueryOperationsRequest.newBuilder().build().toByteString();
        return decode(
                abci.request(SERVICE, "Operations", req),
                QueryOuterClass.QueryOperationsResponse.parser());
    }

    private static <T extends com.google.protobuf.Message> T decode(
            ByteString bytes, com.google.protobuf.Parser<T> parser) {
        try {
            return parser.parseFrom(bytes);
        } catch (InvalidProtocolBufferException e) {
            throw new IllegalStateException("failed to decode bridge query response", e);
        }
    }
}
