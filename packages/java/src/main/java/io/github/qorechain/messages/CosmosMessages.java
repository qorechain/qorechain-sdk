package io.github.qorechain.messages;

import com.google.protobuf.Message;

/**
 * Composers for standard Cosmos SDK messages.
 *
 * <p>The bank messages ship as typed composers backed by generated protobuf
 * classes (the workhorses used by the tx builder's {@code bankSend}). The other
 * standard modules (staking, distribution, gov, authz, feegrant, IBC transfer)
 * expose their canonical type-URL constants plus a generic {@link #custom}
 * composer, so any message built from its own protobuf class can be wrapped with
 * the right type URL without this module re-vendoring every Cosmos proto.
 */
public final class CosmosMessages {

    private CosmosMessages() {}

    // ---- bank (typed) ----

    /** Bank module composers. */
    public static final class bank {
        private bank() {}

        public static TypedMessage send(cosmos.bank.v1beta1.Tx.MsgSend m) {
            return new TypedMessage("/cosmos.bank.v1beta1.MsgSend", m);
        }

        public static TypedMessage multiSend(cosmos.bank.v1beta1.Tx.MsgMultiSend m) {
            return new TypedMessage("/cosmos.bank.v1beta1.MsgMultiSend", m);
        }
    }

    // ---- canonical type-URL constants for the other standard modules ----

    public static final String MSG_DELEGATE = "/cosmos.staking.v1beta1.MsgDelegate";
    public static final String MSG_UNDELEGATE = "/cosmos.staking.v1beta1.MsgUndelegate";
    public static final String MSG_BEGIN_REDELEGATE = "/cosmos.staking.v1beta1.MsgBeginRedelegate";

    public static final String MSG_WITHDRAW_DELEGATOR_REWARD =
            "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward";
    public static final String MSG_SET_WITHDRAW_ADDRESS =
            "/cosmos.distribution.v1beta1.MsgSetWithdrawAddress";
    public static final String MSG_FUND_COMMUNITY_POOL =
            "/cosmos.distribution.v1beta1.MsgFundCommunityPool";

    public static final String MSG_VOTE = "/cosmos.gov.v1.MsgVote";
    public static final String MSG_VOTE_WEIGHTED = "/cosmos.gov.v1.MsgVoteWeighted";
    public static final String MSG_DEPOSIT = "/cosmos.gov.v1.MsgDeposit";
    public static final String MSG_SUBMIT_PROPOSAL = "/cosmos.gov.v1.MsgSubmitProposal";

    public static final String MSG_GRANT = "/cosmos.authz.v1beta1.MsgGrant";
    public static final String MSG_REVOKE = "/cosmos.authz.v1beta1.MsgRevoke";
    public static final String MSG_EXEC = "/cosmos.authz.v1beta1.MsgExec";

    public static final String MSG_GRANT_ALLOWANCE = "/cosmos.feegrant.v1beta1.MsgGrantAllowance";
    public static final String MSG_REVOKE_ALLOWANCE = "/cosmos.feegrant.v1beta1.MsgRevokeAllowance";

    public static final String MSG_IBC_TRANSFER = "/ibc.applications.transfer.v1.MsgTransfer";

    /**
     * Wrap any protobuf message with an explicit type URL. Use this for standard
     * Cosmos messages whose protobuf class you build yourself (staking,
     * distribution, gov, authz, feegrant, IBC), e.g.
     * {@code CosmosMessages.custom(CosmosMessages.MSG_DELEGATE, msgDelegate)}.
     */
    public static TypedMessage custom(String typeUrl, Message message) {
        return new TypedMessage(typeUrl, message);
    }
}
