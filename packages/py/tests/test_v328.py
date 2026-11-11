"""Chain v3.2.8 client changes: authenticator link proofs and spending rules,
execution results, full governance params, cross-VM async fields and pending
pagination, EVM window scope fields, gas caps and the minimum gas price."""

from __future__ import annotations

import base64
import hashlib
from decimal import Decimal
from typing import Any

import httpx
import pytest
import respx
from cosmpy.protos.cosmos.base.abci.v1beta1.abci_pb2 import TxMsgData
from cosmpy.protos.cosmos.tx.v1beta1.tx_pb2 import TxBody, TxRaw
from google.protobuf.any_pb2 import Any as ProtoAny

from qorsdk import (
    AUTHENTICATOR_LINK_DOMAIN,
    COSMOS_TX_MAX_GAS,
    EVM_TX_MAX_GAS,
    ExecutionFailedError,
    authenticator_link_message,
    authenticator_link_text,
    build_cross_vm_call,
    check_evm_gas_limit,
    create_cross_vm_client,
    crossvm_update_params_from_current,
    decode_execution_results,
    derive_native_account,
    eip191_hash,
    estimate_fee,
    estimate_gas,
    execute_evm_msg,
    fetch_evm_limits,
    fetch_min_gas_price_uqor,
    link_authenticator_msgs,
    link_proof_ed25519,
    link_proof_eth,
    link_proof_secp256k1,
    msg,
    needs_simulated_gas,
    parse_evm_window,
    rdk_update_params_from_current,
    recommended_gas_price_uqor,
    require_executions_succeeded,
    rules_cover_value_permissions,
    send_messages,
    svm_update_params_from_current,
    verify_link_proof,
)
from qorsdk.address import bytes_to_bech32
from qorsdk.proto.qorechain.abstractaccount.v1 import tx_pb2 as aa_tx
from qorsdk.proto.qorechain.crossvm.v1 import query_pb2 as crossvm_q
from qorsdk.query.grpc import CrossVmQueryClient
from qorsdk.tx import BuiltTx

CHAIN = "qorechain-diana"
ACCOUNT = "qor1rfjz7r3u8t65teavh5utquj3kwvsj983hh5zaj"
GOV = "qor10d07y265gmmuvt4z0w9aw880jnsr700jfw6aq9"
CONTRACT = "qor1qqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8qarc0skm0f0x"
SECP_PRIV = bytes(range(1, 33))
ED_SEED = bytes([9]) * 32
REST = "https://rest.example.test"
TEST_MNEMONIC = (
    "abandon abandon abandon abandon abandon abandon abandon abandon "
    "abandon abandon abandon about"
)


class FakeRest:
    def __init__(self, answers: dict[str, Any]) -> None:
        self.answers = answers
        self.paths: list[str] = []

    def get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        self.paths.append(path)
        answer = self.answers[path]
        if isinstance(answer, Exception):
            raise answer
        return answer


BOUNDED_RULE = {"id": "r1", "enabled": True, "per_tx_limit": 1_000_000}


# --------------------------------------------------------------------------- #
# 1. link message and proofs
# --------------------------------------------------------------------------- #


def test_link_message_known_answer() -> None:
    expected = (
        "QoreChain authenticator link v1\nchain: qorechain-diana\n"
        "account: qor1rfjz7r3u8t65teavh5utquj3kwvsj983hh5zaj\nscheme: ed25519\n"
        "key: 0707070707070707070707070707070707070707070707070707070707070707"
    )
    assert authenticator_link_text(CHAIN, ACCOUNT, "ed25519", bytes([7]) * 32) == expected
    assert authenticator_link_message(CHAIN, ACCOUNT, "ed25519", bytes([7]) * 32) == (
        expected.encode()
    )
    assert expected.startswith(AUTHENTICATOR_LINK_DOMAIN)


def test_link_message_refuses_bad_keys() -> None:
    with pytest.raises(ValueError, match="uncompressed"):
        authenticator_link_message(CHAIN, ACCOUNT, "secp256k1", b"\x04" * 65)
    with pytest.raises(ValueError, match="32 bytes"):
        authenticator_link_message(CHAIN, ACCOUNT, "ed25519", b"\x01" * 33)
    with pytest.raises(ValueError, match="unknown authenticator scheme"):
        authenticator_link_message(CHAIN, ACCOUNT, "sr25519", b"\x01" * 32)


def test_ed25519_proof_verifies_with_standard_verify() -> None:
    from nacl.signing import SigningKey, VerifyKey

    proof = link_proof_ed25519(ED_SEED, chain_id=CHAIN, account_address=ACCOUNT)
    assert proof.scheme == "ed25519"
    assert proof.pubkey == bytes(SigningKey(ED_SEED).verify_key)
    message = authenticator_link_message(CHAIN, ACCOUNT, "ed25519", proof.pubkey)
    VerifyKey(proof.pubkey).verify(message, proof.possession_proof)
    # The 64-byte Solana-style secret key gives the same proof.
    again = link_proof_ed25519(ED_SEED + proof.pubkey, chain_id=CHAIN, account_address=ACCOUNT)
    assert again == proof
    assert verify_link_proof(chain_id=CHAIN, account_address=ACCOUNT, **_fields(proof))
    assert not verify_link_proof(chain_id="other", account_address=ACCOUNT, **_fields(proof))


def _fields(proof: Any) -> dict[str, Any]:
    return {
        "scheme": proof.scheme,
        "pubkey": proof.pubkey,
        "possession_proof": proof.possession_proof,
    }


def test_secp256k1_proof_verifies_with_standard_verify() -> None:
    from ecdsa import SECP256k1, VerifyingKey
    from ecdsa.util import sigdecode_string

    proof = link_proof_secp256k1(SECP_PRIV, chain_id=CHAIN, account_address=ACCOUNT)
    assert len(proof.pubkey) == 33 and len(proof.possession_proof) == 64
    message = authenticator_link_message(CHAIN, ACCOUNT, "secp256k1", proof.pubkey)
    vk = VerifyingKey.from_string(proof.pubkey, curve=SECP256k1)
    assert vk.verify_digest(
        proof.possession_proof, hashlib.sha256(message).digest(), sigdecode=sigdecode_string
    )
    assert int.from_bytes(proof.possession_proof[32:], "big") <= SECP256k1.order // 2
    assert verify_link_proof(chain_id=CHAIN, account_address=ACCOUNT, **_fields(proof))
    assert not verify_link_proof(chain_id=CHAIN, account_address=GOV, **_fields(proof))


def test_eth_proof_recovers_the_linked_address() -> None:
    from coincurve import PublicKey

    from qorsdk.utils.hash import keccak256

    proof = link_proof_eth(SECP_PRIV, chain_id=CHAIN, account_address=ACCOUNT)
    assert len(proof.pubkey) == 20 and len(proof.possession_proof) == 65
    assert proof.possession_proof[64] in (27, 28)
    message = authenticator_link_message(CHAIN, ACCOUNT, "secp256k1", proof.pubkey)
    prefix = f"\x19Ethereum Signed Message:\n{len(message)}".encode()
    digest = keccak256(prefix + message)
    assert eip191_hash(message) == digest
    sig = proof.possession_proof[:64] + bytes([proof.possession_proof[64] - 27])
    pub = PublicKey.from_signature_and_message(sig, digest, hasher=None)
    assert keccak256(pub.format(compressed=False)[1:])[12:] == proof.pubkey
    assert verify_link_proof(chain_id=CHAIN, account_address=ACCOUNT, **_fields(proof))
    # v = 0/1 is accepted as well.
    alt = proof.possession_proof[:64] + bytes([proof.possession_proof[64] - 27])
    assert verify_link_proof(
        chain_id=CHAIN, account_address=ACCOUNT, scheme="secp256k1", pubkey=proof.pubkey,
        possession_proof=alt,
    )


# --------------------------------------------------------------------------- #
# 1. composer + link helper + spending rule
# --------------------------------------------------------------------------- #


def test_register_authenticator_refuses_an_empty_proof() -> None:
    with pytest.raises(ValueError, match="authenticator_link_message"):
        msg.abstractaccount.register_authenticator(
            owner=ACCOUNT, account_address=ACCOUNT, scheme="ed25519", pubkey=b"\x01" * 32
        )
    m = msg.abstractaccount.register_authenticator(owner=ACCOUNT, possession_proof=b"\x05")
    assert m.value.possession_proof == b"\x05"


def test_link_authenticator_msgs_builds_rule_then_registration() -> None:
    proof = link_proof_ed25519(ED_SEED, chain_id=CHAIN, account_address=ACCOUNT)
    msgs = link_authenticator_msgs(
        owner=ACCOUNT,
        chain_id=CHAIN,
        scheme="ed25519",
        pubkey=proof.pubkey,
        permissions=["send"],
        expiry_unix=1_900_000_000,
        label="phantom",
        possession_proof=proof.possession_proof,
        spending_rule=BOUNDED_RULE,
    )
    assert [m.type_url for m in msgs] == [
        "/qorechain.abstractaccount.v1.MsgUpdateSpendingRules",
        "/qorechain.abstractaccount.v1.MsgRegisterAuthenticator",
    ]
    assert msgs[0].value.account_address == ACCOUNT
    reg = msgs[1].value
    assert reg.possession_proof == proof.possession_proof
    assert list(reg.permissions) == ["send"] and reg.label == "phantom"


def test_link_authenticator_msgs_refuses_value_keys_without_a_bounding_rule() -> None:
    proof = link_proof_ed25519(ED_SEED, chain_id=CHAIN, account_address=ACCOUNT)
    base: dict[str, Any] = dict(
        owner=ACCOUNT, chain_id=CHAIN, scheme="ed25519", pubkey=proof.pubkey,
        expiry_unix=1, possession_proof=proof.possession_proof,
    )
    with pytest.raises(ValueError, match="bounds every denom"):
        link_authenticator_msgs(**base, permissions=["evm"])
    # A non-value permission needs no rule: registration only.
    only = link_authenticator_msgs(**base, permissions=["read"])
    assert len(only) == 1
    # A proof for another chain is refused before anything is built.
    with pytest.raises(ValueError, match="does not verify"):
        link_authenticator_msgs(**{**base, "chain_id": "qorechain-vladi"}, permissions=["read"])


def test_rule_cover_uses_the_first_enabled_rule_and_denom_limits() -> None:
    unbounded = {"id": "a", "enabled": True, "allowed_denoms": ["uqor"]}
    assert not rules_cover_value_permissions([unbounded, BOUNDED_RULE])
    assert rules_cover_value_permissions([{"id": "x", "enabled": False}, BOUNDED_RULE])
    listed = {
        "id": "b",
        "enabled": True,
        "allowed_denoms": ["erc20/0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD", "uqor"],
        "denom_limits": [
            {"denom": "ERC20/0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", "daily_limit": "5"},
            {"denom": "uqor", "per_tx_limit": "10"},
        ],
    }
    assert rules_cover_value_permissions([listed])
    missing = {**listed, "denom_limits": listed["denom_limits"][:1]}
    assert not rules_cover_value_permissions([missing])
    assert not rules_cover_value_permissions([])


# --------------------------------------------------------------------------- #
# 2. execution results
# --------------------------------------------------------------------------- #


def _tx_with_results() -> dict[str, Any]:
    evm = aa_tx.MsgExecuteEVMResponse(success=False, ret=b"\x01", gas_used=21000, vm_error="revert")
    cos = aa_tx.MsgExecuteCosmosResponse(success=True)
    data = TxMsgData(
        msg_responses=[
            ProtoAny(
                type_url="/qorechain.abstractaccount.v1.MsgExecuteEVMResponse",
                value=evm.SerializeToString(),
            ),
            ProtoAny(
                type_url="/qorechain.abstractaccount.v1.MsgExecuteCosmosResponse",
                value=cos.SerializeToString(),
            ),
        ]
    )
    return {
        "tx_response": {
            "code": 0,
            "data": data.SerializeToString().hex(),
            "events": [
                {
                    "type": "abstractaccount_execution_failed",
                    "attributes": [
                        {"key": "account", "value": ACCOUNT},
                        {"key": "lane", "value": "evm"},
                        {"key": "nonce", "value": "4"},
                        {"key": "reason", "value": "execution reverted"},
                    ],
                }
            ],
        }
    }


def test_decode_execution_results_reads_responses_and_events() -> None:
    results = decode_execution_results(_tx_with_results())
    assert [r.lane for r in results] == ["evm", "cosmos"]
    evm, cos = results
    assert not evm.success and evm.ret == b"\x01" and evm.gas_used == 21000
    assert evm.vm_error == "revert" and evm.reason == "execution reverted"
    assert evm.nonce == 4 and evm.account == ACCOUNT
    assert cos.success
    with pytest.raises(ExecutionFailedError, match="execution reverted") as err:
        require_executions_succeeded(_tx_with_results())
    assert len(err.value.failures) == 1


def test_decode_execution_results_json_and_empty() -> None:
    tx = {
        "msg_responses": [
            {
                "@type": "/qorechain.abstractaccount.v1.MsgExecuteEVMResponse",
                "success": True,
                "ret": base64.b64encode(b"\x02").decode(),
                "gas_used": "10",
            }
        ]
    }
    [r] = require_executions_succeeded(tx)
    assert r.ret == b"\x02" and r.gas_used == 10
    assert decode_execution_results({"tx_response": {"code": 0}}) == []


# --------------------------------------------------------------------------- #
# 3. governance params
# --------------------------------------------------------------------------- #

CROSSVM_ANSWER = {
    "max_message_size": "65536",
    "max_queue_size": 1000,
    "queue_timeout_blocks": "100",
    "enabled": True,
    "bridge_allowed_targets": [f"cosmwasm:{CONTRACT}"],
    "bridge_target_pins": [
        {"target": f"cosmwasm:{CONTRACT}", "code_id": "7", "history_len": "2"}
    ],
    "max_pending_per_sender": 100,
    "max_cosmos_tx_gas": "5000000",
    "record_retention_blocks": "1000",
    "max_block_wasm_gas": "60000000",
    "max_tx_wasm_share_bps": 5000,
    "max_block_level_wasm_gas": "1",
    "queue_wasm_reserve_bps": 1000,
    "wasm_congestion_max_factor": 20,
    "wasm_congestion_target_bps": 5000,
    "wasm_congestion_factor_micro": "1000000",
    "max_block_upload_bps": 100,
    "max_queue_timeouts_per_block": 50,
}


def test_crossvm_update_params_requires_every_field() -> None:
    with pytest.raises(ValueError, match="missing: bridge_allowed_targets, bridge_target_pins"):
        msg.crossvm.update_params(
            authority=GOV, max_message_size=1, max_queue_size=1,
            queue_timeout_blocks=1, enabled=False,
        )


def test_crossvm_update_params_from_current_copies_pins() -> None:
    rest = FakeRest({"/qorechain/crossvm/v1/params": CROSSVM_ANSWER})
    m = crossvm_update_params_from_current(
        rest, authority=GOV, changes={"max_pending_per_sender": 50}
    )
    v = m.value
    assert [(p.target, p.code_id, p.history_len) for p in v.bridge_target_pins] == [
        (f"cosmwasm:{CONTRACT}", 7, 2)
    ]
    assert v.max_pending_per_sender == 50
    assert v.max_cosmos_tx_gas == 5_000_000 and v.max_queue_timeouts_per_block == 50
    assert v.enabled is True
    with pytest.raises(ValueError, match="unknown parameter"):
        crossvm_update_params_from_current(rest, authority=GOV, changes={"nope": 1})
    with pytest.raises(ValueError, match="names no allowlist entry"):
        crossvm_update_params_from_current(
            rest, authority=GOV, changes={"bridge_allowed_targets": []}
        )


SVM_ALL = {
    "max_program_size": 1024,
    "max_account_data_size": 2048,
    "compute_budget_max": 1_400_000,
    "lamports_per_byte": 7,
    "rent_exemption_multi": "2.000000000000000000",
    "enabled": False,
    "svm_slot_offset": 0,
    "default_sig_scheme": 1,
    "max_cpi": 4,
    "max_custody_uqor": 1_000_000,
    "max_custody_hard_uqor": 0,
    "max_account_excess_uqor": 5,
}


def test_svm_update_params_requires_every_field_and_a_hard_ceiling() -> None:
    partial = {k: v for k, v in SVM_ALL.items() if not k.startswith("max_custody")}
    with pytest.raises(ValueError, match="missing: max_custody_uqor, max_custody_hard_uqor"):
        msg.svm.update_params(authority=GOV, params=partial)
    with pytest.raises(ValueError, match="hard custody ceiling"):
        msg.svm.update_params(authority=GOV, params={**SVM_ALL, "enabled": True})
    m = msg.svm.update_params(
        authority=GOV, params={**SVM_ALL, "enabled": True, "max_custody_hard_uqor": 9}
    )
    assert m.value.params.max_custody_hard_uqor == 9
    assert m.value.params.max_account_excess_uqor == 5


def test_svm_update_params_from_current() -> None:
    rest = FakeRest({"/qorechain/svm/v1/params": {"params": {**SVM_ALL, "max_cpi": "4"}}})
    m = svm_update_params_from_current(
        rest, authority=GOV, changes={"max_custody_hard_uqor": 10, "enabled": True}
    )
    assert m.value.params.enabled is True and m.value.params.max_custody_uqor == 1_000_000
    # A node without the route: pass the current values.
    offline = svm_update_params_from_current(None, authority=GOV, current=SVM_ALL)
    assert offline.value.params.lamports_per_byte == 7


def test_rdk_update_params_requires_new_fields_and_copies_from_query() -> None:
    view = {
        "max_rollups": 100,
        "min_stake_for_rollup": "10000000",
        "rollup_creation_burn_rate": "0.010000000000000000",
        "default_challenge_window": "604800",
        "max_da_blob_size": "1048576",
        "blob_retention_blocks": "1000",
        "max_batches_per_block": 10,
        "finalized_batch_retention_blocks": "5000",
        "max_posted_data_bytes": "65536",
        "max_posted_data_bytes_per_block": "1048576",
        "posted_data_fee_per_byte": "10",
        "posted_data_retention_blocks": "100000",
        "min_submitter_bond": "1000000",
    }
    old = {k: v for k, v in view.items() if k in (
        "max_rollups", "rollup_creation_burn_rate", "max_batches_per_block",
    )}
    with pytest.raises(ValueError, match="missing: min_stake_for_rollup"):
        msg.rdk.update_params(authority=GOV, **old)
    m = rdk_update_params_from_current(
        FakeRest({"/qorechain/rdk/v1/params": {"params": view}}),
        authority=GOV,
        changes={"posted_data_fee_per_byte": 12},
    )
    assert m.value.min_submitter_bond == 1_000_000
    assert m.value.posted_data_fee_per_byte == 12
    assert m.value.finalized_batch_retention_blocks == 5000


# --------------------------------------------------------------------------- #
# 4. cross-VM
# --------------------------------------------------------------------------- #


def test_async_fields_are_encoded_and_checked() -> None:
    m = build_cross_vm_call(
        sender=ACCOUNT, target_vm="cosmwasm", target_contract=CONTRACT, cosmwasm={"a": 1},
        async_=True, async_gas_limit=1_000_000, async_max_factor=2_000_000,
    )
    assert m.value.async_gas_limit == 1_000_000 and m.value.async_max_factor == 2_000_000
    with pytest.raises(ValueError, match="only to async calls"):
        build_cross_vm_call(
            sender=ACCOUNT, target_vm="cosmwasm", target_contract=CONTRACT,
            async_gas_limit=300_000,
        )
    with pytest.raises(ValueError, match="into cosmwasm"):
        build_cross_vm_call(
            sender=ACCOUNT, target_vm="evm", target_contract="0x" + "11" * 20,
            async_=True, async_max_factor=1_000_000,
        )
    with pytest.raises(ValueError, match="250,000"):
        build_cross_vm_call(
            sender=ACCOUNT, target_vm="cosmwasm", target_contract=CONTRACT,
            async_=True, async_gas_limit=100,
        )


class _PagingChannel:
    def __init__(self) -> None:
        self.keys: list[bytes] = []

    def unary_unary(self, method: str, request_serializer: Any, response_deserializer: Any) -> Any:
        def call(request: Any) -> Any:
            if not method.endswith("PendingMessages"):
                return None
            key = bytes(request.pagination.key)
            self.keys.append(key)
            page = crossvm_q.QueryPendingMessagesResponse()
            if key == b"":
                page.messages.add(id="m1")
                page.pagination.next_key = b"k2"
            else:
                page.messages.add(id="m2")
            return response_deserializer(page.SerializeToString())

        return call


def test_all_pending_messages_follows_next_key() -> None:
    channel = _PagingChannel()
    client = CrossVmQueryClient(channel)  # type: ignore[arg-type]
    assert [m.id for m in client.all_pending_messages()] == ["m1", "m2"]
    assert channel.keys == [b"", b"k2"]
    with pytest.raises(RuntimeError, match="max_pages"):
        client.all_pending_messages(max_pages=1)


# --------------------------------------------------------------------------- #
# 5. EVM window fields
# --------------------------------------------------------------------------- #

VALOPER = bytes_to_bech32(b"\x01" * 20, "qorvaloper")


def test_open_evm_window_scope_fields() -> None:
    m = msg.pqc.open_evm_window(
        sender=ACCOUNT, blocks=10, max_txs=1, max_value="100",
        validators=["0x" + "ab" * 20],
        staking_validators=[VALOPER],
        ibc_receivers=["channel-0/cosmos1receiver"],
    )
    assert list(m.value.validators) == ["0x" + "ab" * 20]
    assert list(m.value.staking_validators) == [VALOPER]
    assert list(m.value.ibc_receivers) == ["channel-0/cosmos1receiver"]
    base: dict[str, Any] = dict(sender=ACCOUNT, blocks=10, max_txs=1, max_value="100")
    for field, value, match in [
        ("validators", ["0x12"], "20-byte"),
        ("staking_validators", [ACCOUNT], "qorvaloper"),
        ("staking_validators", [VALOPER, VALOPER], "more than once"),
        ("ibc_receivers", ["channel-0"], "<source channel>/<receiver>"),
        ("ibc_receivers", ["channel-0/a b"], "whitespace"),
        ("ibc_receivers", [f"channel-{i}/r" for i in range(17)], "maximum is 16"),
    ]:
        with pytest.raises(ValueError, match=match):
            msg.pqc.open_evm_window(**base, **{field: value})


def test_parse_evm_window_reads_scope_fields() -> None:
    status = parse_evm_window(
        {"found": True, "live": True, "staking_validators": [VALOPER],
         "ibc_receivers": ["channel-0/x"], "validators": ["0x" + "cd" * 20]}
    )
    assert status.staking_validators == (VALOPER,)
    assert status.ibc_receivers == ("channel-0/x",)
    assert status.validators == ("0x" + "cd" * 20,)


# --------------------------------------------------------------------------- #
# 6. gas
# --------------------------------------------------------------------------- #


def test_evm_limits_query_and_cap() -> None:
    path = "/qorechain/pqc/v1/evm_limits"
    top = fetch_evm_limits(FakeRest({path: {"limits": {}, "tx_max_gas": "25000000",
                                            "precompile_input_max_bytes": "4096"}}))
    assert top.tx_max_gas == 25_000_000 and top.precompile_input_max_bytes == 4096
    fallback = fetch_evm_limits(FakeRest({path: {"limits": {"tx_max_gas": "20000000"}}}))
    assert fallback.tx_max_gas == 20_000_000
    assert fetch_evm_limits(FakeRest({path: {}})).tx_max_gas == EVM_TX_MAX_GAS == 30_000_000
    assert check_evm_gas_limit(30_000_000) == 30_000_000
    with pytest.raises(ValueError, match="EVM transaction gas cap"):
        check_evm_gas_limit(30_000_001)
    with pytest.raises(ValueError, match="cap of 20,000,000"):
        check_evm_gas_limit(25_000_000, cap=20_000_000)
    with pytest.raises(ValueError, match="EVM transaction gas cap"):
        execute_evm_msg(
            relayer=ACCOUNT, account=ACCOUNT, scheme="ed25519", pubkey=b"\x01" * 32,
            signature=b"", gas_limit=31_000_000,
        )


def test_cosmos_gas_cap_is_refused_before_signing() -> None:
    account = derive_native_account(TEST_MNEMONIC)
    fee = {"amount": [{"denom": "uqor", "amount": "1"}], "gas": str(COSMOS_TX_MAX_GAS + 1)}
    with pytest.raises(ValueError, match="50,000,000"):
        send_messages(
            account=account,
            messages=[msg.crossvm.process_queue(authority=ACCOUNT)],
            chain_id=CHAIN, account_number=1, sequence=0, fee=fee,
        )


WASM_EXEC = "/cosmwasm.wasm.v1.MsgExecuteContract"


def test_fixed_fallback_is_refused_for_wasm_and_cross_vm() -> None:
    rest = FakeRest({})

    class NoOracle:
        def get_fee_estimate(self, urgency: str) -> Any:
            raise RuntimeError("down")

    assert needs_simulated_gas([{"type_url": WASM_EXEC}])
    assert needs_simulated_gas([build_cross_vm_call(
        sender=ACCOUNT, target_vm="cosmwasm", target_contract=CONTRACT)])
    assert not needs_simulated_gas(["/cosmos.bank.v1beta1.MsgSend"])
    with pytest.raises(ValueError, match="simulation"):
        estimate_fee(NoOracle(), messages=[{"type_url": WASM_EXEC}])  # type: ignore[arg-type]
    explicit = estimate_fee(
        NoOracle(), messages=[{"type_url": WASM_EXEC}], gas=600_000  # type: ignore[arg-type]
    )
    assert explicit["gas"] == "600000"
    assert estimate_fee(NoOracle())["gas"] == "200000"  # type: ignore[arg-type]
    assert rest.paths == []


def _built_with(type_url: str) -> BuiltTx:
    body = TxBody(messages=[ProtoAny(type_url=type_url, value=b"")]).SerializeToString()
    tx = TxRaw(body_bytes=body, auth_info_bytes=b"\x02", signatures=[b"\x03"])
    return BuiltTx(tx_raw=tx, tx_raw_bytes=tx.SerializeToString(), auth_info_bytes=b"\x02")


@respx.mock
def test_simulated_wasm_tx_gets_at_least_1_3x() -> None:
    respx.post(f"{REST}/cosmos/tx/v1beta1/simulate").mock(
        return_value=httpx.Response(200, json={"gas_info": {"gas_used": "100000"}})
    )
    assert estimate_gas(REST, _built_with(WASM_EXEC), gas_multiplier=1.1) == 130_000
    # Other transactions keep the caller's multiplier.
    assert estimate_gas(
        REST, _built_with("/cosmos.bank.v1beta1.MsgSend"), gas_multiplier=1.2
    ) == 120_000


@respx.mock
def test_cross_vm_client_auto_fee_simulates() -> None:
    respx.post(f"{REST}/cosmos/tx/v1beta1/simulate").mock(
        return_value=httpx.Response(200, json={"gas_info": {"gas_used": "100000"}})
    )
    route = respx.post(f"{REST}/cosmos/tx/v1beta1/txs").mock(
        return_value=httpx.Response(200, json={"tx_response": {"code": 0, "txhash": "AB"}})
    )
    client = create_cross_vm_client(
        account=derive_native_account(TEST_MNEMONIC), chain_id=CHAIN, account_number=1,
        rest_url=REST, fee="auto",
    )
    client.call(target_vm="cosmwasm", target_contract=CONTRACT, cosmwasm={"x": 1})
    import json

    from cosmpy.protos.cosmos.tx.v1beta1.tx_pb2 import AuthInfo

    sent = json.loads(route.calls.last.request.content)
    raw = TxRaw.FromString(base64.b64decode(sent["tx_bytes"]))
    auth = AuthInfo.FromString(raw.auth_info_bytes)
    assert auth.fee.gas_limit == 140_000  # classical rule 1.4x, above the 1.3x floor
    assert auth.fee.amount[0].amount == "21000"


# --------------------------------------------------------------------------- #
# 8. minimum gas price (opt-in)
# --------------------------------------------------------------------------- #

FEEMARKET = "/cosmos/evm/feemarket/v1/params"


def test_min_gas_price_reads_the_feemarket_exactly() -> None:
    def rest(value: str) -> FakeRest:
        return FakeRest({FEEMARKET: {"params": {"min_gas_price": value}}})

    assert fetch_min_gas_price_uqor(rest("100000000000.000000000000000000")) == Decimal("0.1")
    assert fetch_min_gas_price_uqor(rest("250000000000.000000000000000001")) == Decimal(
        "0.250000000000000000000000000001"
    )
    assert fetch_min_gas_price_uqor(rest("0")) == Decimal("0.1")
    assert recommended_gas_price_uqor(rest("0")) == Decimal("0.15")
    assert recommended_gas_price_uqor(rest("1000000000000")) == Decimal("1.5")
    assert recommended_gas_price_uqor(rest("1000000000000"), margin="2") == Decimal("2")
    with pytest.raises(ValueError, match="decimal"):
        fetch_min_gas_price_uqor(rest("abc"))
