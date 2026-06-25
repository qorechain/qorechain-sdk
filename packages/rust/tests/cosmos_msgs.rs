//! Standard Cosmos message-composer tests: exact type URLs + field round-trip.

use cosmrs::proto::cosmos::base::v1beta1::Coin as ProtoCoin;
use qorechain::msg;

fn coin(amount: &str) -> ProtoCoin {
    ProtoCoin {
        denom: "uqor".into(),
        amount: amount.into(),
    }
}

#[test]
fn standard_cosmos_type_urls() {
    let a = "qor1aaa";
    let v = "qorvaloper1bbb";
    let cases: Vec<(&str, cosmrs::Any)> = vec![
        (
            "/cosmos.bank.v1beta1.MsgSend",
            msg::cosmos::bank_send_any(a, a, vec![coin("1")]),
        ),
        (
            "/cosmos.staking.v1beta1.MsgDelegate",
            msg::cosmos::delegate_any(a, v, coin("1")),
        ),
        (
            "/cosmos.staking.v1beta1.MsgUndelegate",
            msg::cosmos::undelegate_any(a, v, coin("1")),
        ),
        (
            "/cosmos.staking.v1beta1.MsgBeginRedelegate",
            msg::cosmos::begin_redelegate_any(a, v, v, coin("1")),
        ),
        (
            "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward",
            msg::cosmos::withdraw_delegator_reward_any(a, v),
        ),
        (
            "/cosmos.distribution.v1beta1.MsgWithdrawValidatorCommission",
            msg::cosmos::withdraw_validator_commission_any(v),
        ),
        ("/cosmos.gov.v1.MsgVote", msg::cosmos::vote_any(1, a, 1, "")),
        (
            "/cosmos.authz.v1beta1.MsgExec",
            msg::cosmos::authz_exec_any(a, vec![]),
        ),
        (
            "/cosmos.authz.v1beta1.MsgRevoke",
            msg::cosmos::authz_revoke_any(a, a, "/cosmos.bank.v1beta1.MsgSend"),
        ),
        (
            "/cosmos.feegrant.v1beta1.MsgRevokeAllowance",
            msg::cosmos::revoke_allowance_any(a, a),
        ),
    ];
    for (want, any) in &cases {
        assert_eq!(&any.type_url, want);
    }
    assert_eq!(
        msg::cosmos::MSG_TRANSFER,
        "/ibc.applications.transfer.v1.MsgTransfer"
    );
}

#[test]
fn bank_send_msg_fields_round_trip() {
    let any = msg::cosmos::bank_send_any("qor1from", "qor1to", vec![coin("1234")]);
    let decoded: cosmrs::proto::cosmos::bank::v1beta1::MsgSend =
        prost::Message::decode(any.value.as_slice()).unwrap();
    assert_eq!(decoded.from_address, "qor1from");
    assert_eq!(decoded.to_address, "qor1to");
    assert_eq!(decoded.amount[0].amount, "1234");
}
