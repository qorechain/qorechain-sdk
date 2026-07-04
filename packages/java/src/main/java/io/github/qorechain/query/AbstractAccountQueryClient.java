package io.github.qorechain.query;

import com.google.protobuf.ByteString;
import com.google.protobuf.InvalidProtocolBufferException;
import qorechain.abstractaccount.v1.QueryOuterClass;

/**
 * Typed query client for the abstract-account module {@code Query} service,
 * dispatched over {@link AbciQueryClient}.
 */
public final class AbstractAccountQueryClient {

    private static final String SERVICE = "qorechain.abstractaccount.v1.Query";

    private final AbciQueryClient abci;

    public AbstractAccountQueryClient(AbciQueryClient abci) {
        this.abci = abci;
    }

    public AbstractAccountQueryClient(String url) {
        this(new AbciQueryClient(url));
    }

    /** {@code Config} — the module configuration. */
    public QueryOuterClass.QueryConfigResponse config() {
        ByteString req = QueryOuterClass.QueryConfigRequest.newBuilder().build().toByteString();
        return decode(
                abci.request(SERVICE, "Config", req), QueryOuterClass.QueryConfigResponse.parser());
    }

    /** {@code Account} — a single abstract account by address. */
    public QueryOuterClass.QueryAccountResponse account(String address) {
        ByteString req =
                QueryOuterClass.QueryAccountRequest.newBuilder()
                        .setAddress(address)
                        .build()
                        .toByteString();
        return decode(
                abci.request(SERVICE, "Account", req),
                QueryOuterClass.QueryAccountResponse.parser());
    }

    /** {@code Accounts} — all abstract accounts. */
    public QueryOuterClass.QueryAccountsResponse accounts() {
        ByteString req = QueryOuterClass.QueryAccountsRequest.newBuilder().build().toByteString();
        return decode(
                abci.request(SERVICE, "Accounts", req),
                QueryOuterClass.QueryAccountsResponse.parser());
    }

    private static <T extends com.google.protobuf.Message> T decode(
            ByteString bytes, com.google.protobuf.Parser<T> parser) {
        try {
            return parser.parseFrom(bytes);
        } catch (InvalidProtocolBufferException e) {
            throw new IllegalStateException("failed to decode abstractaccount query response", e);
        }
    }
}
