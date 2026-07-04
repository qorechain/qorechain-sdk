package io.github.qorechain.query;

import com.google.protobuf.ByteString;
import com.google.protobuf.InvalidProtocolBufferException;
import qorechain.license.v1.QueryOuterClass;

/**
 * Typed query client for the license module {@code Query} service, dispatched over
 * {@link AbciQueryClient}.
 */
public final class LicenseQueryClient {

    private static final String SERVICE = "qorechain.license.v1.Query";

    private final AbciQueryClient abci;

    public LicenseQueryClient(AbciQueryClient abci) {
        this.abci = abci;
    }

    public LicenseQueryClient(String url) {
        this(new AbciQueryClient(url));
    }

    /** {@code Check} — whether {@code grantee} holds an active license for {@code featureId}. */
    public QueryOuterClass.QueryCheckResponse check(String grantee, String featureId) {
        ByteString req =
                QueryOuterClass.QueryCheckRequest.newBuilder()
                        .setGrantee(grantee)
                        .setFeatureId(featureId)
                        .build()
                        .toByteString();
        return decode(
                abci.request(SERVICE, "Check", req), QueryOuterClass.QueryCheckResponse.parser());
    }

    /** {@code Holders} — all holders of a feature license. */
    public QueryOuterClass.QueryHoldersResponse holders(String featureId) {
        ByteString req =
                QueryOuterClass.QueryHoldersRequest.newBuilder()
                        .setFeatureId(featureId)
                        .build()
                        .toByteString();
        return decode(
                abci.request(SERVICE, "Holders", req),
                QueryOuterClass.QueryHoldersResponse.parser());
    }

    /** {@code List} — all licenses held by a grantee. */
    public QueryOuterClass.QueryListResponse list(String grantee) {
        ByteString req =
                QueryOuterClass.QueryListRequest.newBuilder()
                        .setGrantee(grantee)
                        .build()
                        .toByteString();
        return decode(
                abci.request(SERVICE, "List", req), QueryOuterClass.QueryListResponse.parser());
    }

    private static <T extends com.google.protobuf.Message> T decode(
            ByteString bytes, com.google.protobuf.Parser<T> parser) {
        try {
            return parser.parseFrom(bytes);
        } catch (InvalidProtocolBufferException e) {
            throw new IllegalStateException("failed to decode license query response", e);
        }
    }
}
