"""Tests for typed message composers, the registry, and generic tx building.

The network is mocked: broadcasting is out of scope, so a custom-message tx is
asserted purely on its local encoding and on the byte-for-byte hybrid contract.
"""

from __future__ import annotations

import pytest
from cosmpy.protos.cosmos.base.v1beta1.coin_pb2 import Coin
from cosmpy.protos.cosmos.tx.v1beta1.tx_pb2 import TxBody, TxRaw

from qorsdk import (
    HYBRID_SIG_TYPE_URL,
    build_hybrid_tx,
    decode_any,
    derive_native_account,
    generate_pqc_keypair,
    msg,
    pqc_verify,
    qorechain_registry,
    resolve_message_type,
    send_messages,
)
from qorsdk.messages import Msg
from qorsdk.messages.qorechain import (
    abstractaccount,
    amm,
    bridge,
    crossvm,
    license,
    lightnode,
    multilayer,
    pqc,
    rdk,
    rlconsensus,
    svm,
)

TEST_MNEMONIC = (
    "abandon abandon abandon abandon abandon abandon abandon abandon "
    "abandon abandon abandon about"
)
CHAIN_ID = "qorechain-diana"
FEE = {"amount": [{"denom": "uqor", "amount": "5000"}], "gas": "200000"}

# Every QoreChain composer call -> the exact typeUrl it must emit. Covers all 49.
QORECHAIN_COMPOSER_CASES = [
    # amm (7)
    (amm.create_pool(creator="qor1"), "/qorechain.amm.v1.MsgCreatePool"),
    (amm.add_liquidity(sender="qor1"), "/qorechain.amm.v1.MsgAddLiquidity"),
    (amm.remove_liquidity(sender="qor1"), "/qorechain.amm.v1.MsgRemoveLiquidity"),
    (amm.swap_exact_in(sender="qor1"), "/qorechain.amm.v1.MsgSwapExactIn"),
    (amm.swap_exact_out(sender="qor1"), "/qorechain.amm.v1.MsgSwapExactOut"),
    (amm.pause_pool(authority="qor1"), "/qorechain.amm.v1.MsgPausePool"),
    (amm.resume_pool(authority="qor1"), "/qorechain.amm.v1.MsgResumePool"),
    # bridge (4)
    (bridge.bridge_deposit(sender="qor1"), "/qorechain.bridge.v1.MsgBridgeDeposit"),
    (bridge.bridge_withdraw(sender="qor1"), "/qorechain.bridge.v1.MsgBridgeWithdraw"),
    (
        bridge.register_bridge_validator(validator_address="qor1"),
        "/qorechain.bridge.v1.MsgRegisterBridgeValidator",
    ),
    (
        bridge.bridge_attestation(validator="qor1", amount="1"),
        "/qorechain.bridge.v1.MsgBridgeAttestation",
    ),
    # rdk (7)
    (rdk.create_rollup(creator="qor1"), "/qorechain.rdk.v1.MsgCreateRollup"),
    (rdk.submit_batch(sequencer="qor1"), "/qorechain.rdk.v1.MsgSubmitBatch"),
    (rdk.challenge_batch(challenger="qor1"), "/qorechain.rdk.v1.MsgChallengeBatch"),
    (rdk.resolve_challenge(resolver="qor1"), "/qorechain.rdk.v1.MsgResolveChallenge"),
    (rdk.pause_rollup(creator="qor1"), "/qorechain.rdk.v1.MsgPauseRollup"),
    (rdk.resume_rollup(creator="qor1"), "/qorechain.rdk.v1.MsgResumeRollup"),
    (rdk.stop_rollup(creator="qor1"), "/qorechain.rdk.v1.MsgStopRollup"),
    # multilayer (6)
    (
        multilayer.register_sidechain(creator="qor1"),
        "/qorechain.multilayer.v1.MsgRegisterSidechain",
    ),
    (
        multilayer.register_paychain(creator="qor1"),
        "/qorechain.multilayer.v1.MsgRegisterPaychain",
    ),
    (multilayer.anchor_state(relayer="qor1"), "/qorechain.multilayer.v1.MsgAnchorState"),
    (
        multilayer.route_transaction(sender="qor1"),
        "/qorechain.multilayer.v1.MsgRouteTransaction",
    ),
    (
        multilayer.update_layer_status(authority="qor1"),
        "/qorechain.multilayer.v1.MsgUpdateLayerStatus",
    ),
    (
        multilayer.challenge_anchor(challenger="qor1"),
        "/qorechain.multilayer.v1.MsgChallengeAnchor",
    ),
    # pqc (5)
    (pqc.register_pqc_key(sender="qor1"), "/qorechain.pqc.v1.MsgRegisterPQCKey"),
    (pqc.register_pqc_key_v2(sender="qor1"), "/qorechain.pqc.v1.MsgRegisterPQCKeyV2"),
    (pqc.migrate_pqc_key(sender="qor1"), "/qorechain.pqc.v1.MsgMigratePQCKey"),
    (
        pqc.deprecate_algorithm(authority="qor1"),
        "/qorechain.pqc.v1.MsgDeprecateAlgorithm",
    ),
    (pqc.disable_algorithm(authority="qor1"), "/qorechain.pqc.v1.MsgDisableAlgorithm"),
    # svm (4)
    (svm.deploy_program(sender="qor1"), "/qorechain.svm.v1.MsgDeployProgram"),
    (svm.create_account(sender="qor1"), "/qorechain.svm.v1.MsgCreateAccount"),
    (svm.execute_program(sender="qor1"), "/qorechain.svm.v1.MsgExecuteProgram"),
    (svm.register_svm_pqc_key(sender="qor1"), "/qorechain.svm.v1.MsgRegisterSVMPQCKey"),
    # lightnode (4)
    (
        lightnode.register_light_node(operator="qor1"),
        "/qorechain.lightnode.v1.MsgRegisterLightNode",
    ),
    (lightnode.heartbeat(operator="qor1"), "/qorechain.lightnode.v1.MsgHeartbeat"),
    (
        lightnode.deregister_light_node(operator="qor1"),
        "/qorechain.lightnode.v1.MsgDeregisterLightNode",
    ),
    (
        lightnode.claim_light_node_rewards(operator="qor1"),
        "/qorechain.lightnode.v1.MsgClaimLightNodeRewards",
    ),
    # license (4)
    (license.grant_license(authority="qor1"), "/qorechain.license.v1.MsgGrantLicense"),
    (license.revoke_license(authority="qor1"), "/qorechain.license.v1.MsgRevokeLicense"),
    (
        license.suspend_license(authority="qor1"),
        "/qorechain.license.v1.MsgSuspendLicense",
    ),
    (license.resume_license(authority="qor1"), "/qorechain.license.v1.MsgResumeLicense"),
    # abstractaccount (2)
    (
        abstractaccount.create_abstract_account(owner="qor1"),
        "/qorechain.abstractaccount.v1.MsgCreateAbstractAccount",
    ),
    (
        abstractaccount.update_spending_rules(owner="qor1"),
        "/qorechain.abstractaccount.v1.MsgUpdateSpendingRules",
    ),
    # crossvm (2)
    (crossvm.cross_vm_call(sender="qor1"), "/qorechain.crossvm.v1.MsgCrossVMCall"),
    (crossvm.process_queue(authority="qor1"), "/qorechain.crossvm.v1.MsgProcessQueue"),
    # rlconsensus (4)
    (
        rlconsensus.set_agent_mode(authority="qor1"),
        "/qorechain.rlconsensus.v1.MsgSetAgentMode",
    ),
    (
        rlconsensus.resume_agent(authority="qor1"),
        "/qorechain.rlconsensus.v1.MsgResumeAgent",
    ),
    (
        rlconsensus.update_policy(authority="qor1"),
        "/qorechain.rlconsensus.v1.MsgUpdatePolicy",
    ),
    (
        rlconsensus.update_reward_weights(authority="qor1"),
        "/qorechain.rlconsensus.v1.MsgUpdateRewardWeights",
    ),
]


def test_all_49_qorechain_composers_covered():
    assert len(QORECHAIN_COMPOSER_CASES) == 49
    type_urls = {tu for _m, tu in QORECHAIN_COMPOSER_CASES}
    assert len(type_urls) == 49


@pytest.mark.parametrize("built_msg,type_url", QORECHAIN_COMPOSER_CASES)
def test_qorechain_composer_returns_exact_type_url(built_msg, type_url):
    assert isinstance(built_msg, Msg)
    assert built_msg.type_url == type_url


# Standard Cosmos builders -> exact typeUrls.
COSMOS_COMPOSER_CASES = [
    (msg.bank.send(from_address="qor1"), "/cosmos.bank.v1beta1.MsgSend"),
    (msg.bank.multi_send(), "/cosmos.bank.v1beta1.MsgMultiSend"),
    (msg.staking.delegate(delegator_address="qor1"), "/cosmos.staking.v1beta1.MsgDelegate"),
    (
        msg.staking.undelegate(delegator_address="qor1"),
        "/cosmos.staking.v1beta1.MsgUndelegate",
    ),
    (
        msg.staking.redelegate(delegator_address="qor1"),
        "/cosmos.staking.v1beta1.MsgBeginRedelegate",
    ),
    (
        msg.distribution.withdraw_delegator_reward(delegator_address="qor1"),
        "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward",
    ),
    (msg.gov.vote(voter="qor1", proposal_id=1), "/cosmos.gov.v1.MsgVote"),
    (msg.gov.deposit(depositor="qor1", proposal_id=1), "/cosmos.gov.v1.MsgDeposit"),
    (msg.authz.exec(grantee="qor1"), "/cosmos.authz.v1beta1.MsgExec"),
    (msg.feegrant.revoke(), "/cosmos.feegrant.v1beta1.MsgRevokeAllowance"),
    (msg.ibc.transfer(sender="qor1"), "/ibc.applications.transfer.v1.MsgTransfer"),
]


@pytest.mark.parametrize("built_msg,type_url", COSMOS_COMPOSER_CASES)
def test_cosmos_composer_returns_exact_type_url(built_msg, type_url):
    assert isinstance(built_msg, Msg)
    assert built_msg.type_url == type_url


def test_registry_covers_all_49_qorechain_and_18_cosmos():
    reg = qorechain_registry()
    qc = [k for k in reg if k.startswith("/qorechain.")]
    assert len(qc) == 49
    assert len(reg) == 49 + 18


def test_registry_extra_types_override():
    sentinel = object()
    reg = qorechain_registry({"/qorechain.amm.v1.MsgSwapExactIn": sentinel})  # type: ignore[dict-item]
    assert reg["/qorechain.amm.v1.MsgSwapExactIn"] is sentinel


def test_encode_decode_round_trip():
    m = amm.swap_exact_in(
        sender="qor1abc",
        pool_id=7,
        token_in=Coin(denom="uqor", amount="100"),
        denom_out="uother",
        min_out="90",
    )
    raw = m.value.SerializeToString()
    decoded = decode_any(m.type_url, raw)
    assert decoded.sender == "qor1abc"
    assert decoded.pool_id == 7
    assert decoded.denom_out == "uother"
    assert decoded.min_out == "90"


def test_resolve_message_type_unknown_raises():
    with pytest.raises(KeyError):
        resolve_message_type("/qorechain.nope.v1.MsgNope")


def test_send_messages_carries_custom_amm_message():
    account = derive_native_account(TEST_MNEMONIC)
    m = amm.swap_exact_in(
        sender=account.address,
        pool_id=1,
        token_in=Coin(denom="uqor", amount="100"),
        denom_out="uother",
        min_out="90",
    )
    built = send_messages(
        account=account,
        messages=[m],
        chain_id=CHAIN_ID,
        account_number=4,
        sequence=2,
        fee=FEE,
    )
    tx = TxRaw()
    tx.ParseFromString(built.tx_raw_bytes)
    body = TxBody()
    body.ParseFromString(tx.body_bytes)
    assert len(body.messages) == 1
    assert body.messages[0].type_url == "/qorechain.amm.v1.MsgSwapExactIn"
    assert len(tx.signatures) == 1 and len(tx.signatures[0]) == 64


def test_send_messages_rejects_empty():
    account = derive_native_account(TEST_MNEMONIC)
    with pytest.raises(ValueError):
        send_messages(
            account=account,
            messages=[],
            chain_id=CHAIN_ID,
            account_number=0,
            sequence=0,
            fee=FEE,
        )


def test_hybrid_tx_with_custom_message_preserves_b0_exclude_extension():
    """The ML-DSA-87 signature must cover B0 (body WITHOUT the PQC extension)."""
    account = derive_native_account(TEST_MNEMONIC)
    keypair = generate_pqc_keypair()
    m = amm.swap_exact_in(
        sender=account.address,
        pool_id=3,
        token_in=Coin(denom="uqor", amount="500"),
        denom_out="uother",
        min_out="450",
    )
    built = build_hybrid_tx(
        account=account,
        pqc_keypair=keypair,
        messages=[m],
        fee=FEE,
        chain_id=CHAIN_ID,
        account_number=8,
        sequence=1,
    )

    # The final broadcast body DOES carry the PQC extension...
    tx = TxRaw()
    tx.ParseFromString(built.tx_raw_bytes)
    final_body = TxBody()
    final_body.ParseFromString(tx.body_bytes)
    assert len(final_body.extension_options) == 1
    assert final_body.extension_options[0].type_url == HYBRID_SIG_TYPE_URL

    # ...but the PQC-signed framing reconstructs B0 (body WITHOUT the extension),
    # and the PQC signature verifies against exactly that framing.
    b0_body = TxBody(
        messages=list(final_body.messages),
        memo=final_body.memo,
        timeout_height=final_body.timeout_height,
    )
    b0 = b0_body.SerializeToString()
    a = built.auth_info_bytes
    expected = (
        len(b0).to_bytes(4, "big") + b0 + len(a).to_bytes(4, "big") + a
    )
    assert built.pqc_signed_message == expected
    assert pqc_verify(keypair.public_key, built.pqc_signed_message, built.pqc_signature)
