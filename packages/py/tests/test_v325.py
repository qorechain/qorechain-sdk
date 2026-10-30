"""Client support for chain v3.2.5: exact simulation gas for hybrid
transactions, the KEM key registry, spending-rule bounds at save time,
``MsgUpdateConfig``, crossvm / rdk ``MsgUpdateParams`` and the new
abstract-account reads."""

from __future__ import annotations

import asyncio
import base64
from typing import Any

import httpx
import pytest
import respx
from cosmpy.protos.cosmos.tx.v1beta1.tx_pb2 import TxRaw

from qorsdk import (
    CHAIN_UPGRADE_V3_2_5,
    EXACT_GAS_HEADROOM,
    KEM_ALGORITHM_ML_KEM_1024,
    ML_KEM_1024_PUBLIC_KEY_SIZE,
    auto_fee,
    clear_upgrade_cache,
    decode_tx_error,
    estimate_gas,
    exact_hybrid_gas,
    fetch_authenticators,
    fetch_kem_key,
    fetch_spending_rules,
    msg,
    validate_evm_denom,
    validate_kem_public_key,
    validate_spending_rules,
)
from qorsdk.errors import error_from_text
from qorsdk.kem import fetch_kem_key_async
from qorsdk.messages.registry import QORECHAIN_REGISTRY_TYPES
from qorsdk.proto.qorechain.pqc.v1 import tx_pb2 as pqc_tx
from qorsdk.tx import BuiltTx

REST = "https://rest.example.test"
ADDR = "qor1hkkxx5jmmw02wcz26c74lsp74qysj6h495vv0k"
PLAN_URL = f"{REST}/cosmos/upgrade/v1beta1/applied_plan/{CHAIN_UPGRADE_V3_2_5}"
SIM_URL = f"{REST}/cosmos/tx/v1beta1/simulate"

# Every 12-bit coefficient is 1 (< 3329), then a 32-byte rho.
GOOD_KEM_KEY = bytes([0x01, 0x10, 0x00]) * 512 + bytes(range(32))


@pytest.fixture(autouse=True)
def _fresh_upgrade_cache() -> Any:
    clear_upgrade_cache()
    yield
    clear_upgrade_cache()


def _built(*, hybrid: bool) -> BuiltTx:
    tx = TxRaw(body_bytes=b"\x01", auth_info_bytes=b"\x02", signatures=[b"\x03"])
    return BuiltTx(
        tx_raw=tx,
        tx_raw_bytes=tx.SerializeToString(),
        auth_info_bytes=b"\x02",
        pqc_signature=b"\x09" * 4627 if hybrid else b"",
    )


class FakeRest:
    def __init__(self, answer: Any) -> None:
        self.answer = answer
        self.paths: list[str] = []

    def get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        self.paths.append(path)
        return self.answer


# --------------------------------------------------------------------------- #
# exact gas
# --------------------------------------------------------------------------- #


def test_exact_hybrid_gas_is_ceil_1_02_plus_2000() -> None:
    assert exact_hybrid_gas(100_000) == 102_000 + EXACT_GAS_HEADROOM
    # 166_300 * 1.02 = 169_626 exactly; no float rounding up.
    assert exact_hybrid_gas(166_300) == 169_626 + 2000
    # 166_301 * 1.02 = 169_627.02 -> 169_628.
    assert exact_hybrid_gas(166_301) == 169_628 + 2000
    assert exact_hybrid_gas(0) == 2000
    with pytest.raises(ValueError):
        exact_hybrid_gas(-1)


@respx.mock
def test_hybrid_on_v325_uses_the_exact_rule_and_caches_the_plan() -> None:
    plan = respx.get(PLAN_URL).mock(return_value=httpx.Response(200, json={"height": "3906833"}))
    respx.post(SIM_URL).mock(
        return_value=httpx.Response(200, json={"gas_info": {"gas_used": "166300"}})
    )
    assert estimate_gas(REST, _built(hybrid=True)) == 171_626
    # The second call does not ask for the plan again: an applied plan stays applied.
    assert estimate_gas(REST, _built(hybrid=True)) == 171_626
    assert plan.call_count == 1


@respx.mock
def test_hybrid_below_v325_keeps_the_1_4_multiplier() -> None:
    respx.get(PLAN_URL).mock(return_value=httpx.Response(200, json={"height": "0"}))
    respx.post(SIM_URL).mock(
        return_value=httpx.Response(200, json={"gas_info": {"gas_used": "100000"}})
    )
    assert estimate_gas(REST, _built(hybrid=True)) == 140_000


@respx.mock
def test_hybrid_when_the_plan_cannot_be_read_keeps_the_old_path() -> None:
    respx.get(PLAN_URL).mock(return_value=httpx.Response(500, text="boom"))
    respx.post(SIM_URL).mock(
        return_value=httpx.Response(200, json={"gas_info": {"gas_used": "100000"}})
    )
    assert estimate_gas(REST, _built(hybrid=True)) == 140_000


@respx.mock
def test_classical_tx_never_asks_for_the_plan() -> None:
    plan = respx.get(PLAN_URL).mock(return_value=httpx.Response(200, json={"height": "1"}))
    respx.post(SIM_URL).mock(
        return_value=httpx.Response(200, json={"gas_info": {"gas_used": "100000"}})
    )
    assert estimate_gas(REST, _built(hybrid=False)) == 140_000
    assert plan.call_count == 0


@respx.mock
def test_explicit_multiplier_wins_on_v325() -> None:
    plan = respx.get(PLAN_URL).mock(return_value=httpx.Response(200, json={"height": "1"}))
    respx.post(SIM_URL).mock(
        return_value=httpx.Response(200, json={"gas_info": {"gas_used": "100000"}})
    )
    assert estimate_gas(REST, _built(hybrid=True), gas_multiplier=1.5) == 150_000
    assert plan.call_count == 0


@respx.mock
def test_auto_fee_prices_the_exact_limit() -> None:
    respx.get(PLAN_URL).mock(return_value=httpx.Response(200, json={"height": "8890800"}))
    respx.post(SIM_URL).mock(
        return_value=httpx.Response(200, json={"gas_info": {"gas_used": "100000"}})
    )
    fee = auto_fee(REST, _built(hybrid=True), gas_price="0.1uqor")
    assert fee == {"amount": [{"denom": "uqor", "amount": "10400"}], "gas": "104000"}


# --------------------------------------------------------------------------- #
# KEM registry
# --------------------------------------------------------------------------- #


def test_register_kem_key_encodes_and_round_trips() -> None:
    m = msg.pqc.register_kem_key(sender=ADDR, public_key=GOOD_KEM_KEY)
    assert m.type_url == "/qorechain.pqc.v1.MsgRegisterKEMKey"
    decoded = QORECHAIN_REGISTRY_TYPES[m.type_url].FromString(m.value.SerializeToString())  # type: ignore[attr-defined]
    assert isinstance(decoded, pqc_tx.MsgRegisterKEMKey)
    assert decoded.sender == ADDR
    assert decoded.algorithm_id == KEM_ALGORITHM_ML_KEM_1024 == 2
    assert decoded.public_key == GOOD_KEM_KEY
    assert len(decoded.public_key) == ML_KEM_1024_PUBLIC_KEY_SIZE == 1568


def test_remove_kem_key_encodes() -> None:
    m = msg.pqc.remove_kem_key(sender=ADDR)
    assert m.type_url == "/qorechain.pqc.v1.MsgRemoveKEMKey"
    assert (
        QORECHAIN_REGISTRY_TYPES[m.type_url].FromString(m.value.SerializeToString()).sender == ADDR
    )  # type: ignore[attr-defined]
    with pytest.raises(ValueError, match="sender"):
        msg.pqc.remove_kem_key(sender="")


def test_kem_key_wrong_size_is_refused() -> None:
    with pytest.raises(ValueError, match="1568 bytes, got 1567"):
        msg.pqc.register_kem_key(sender=ADDR, public_key=GOOD_KEM_KEY[:-1])
    with pytest.raises(ValueError, match="public_key is required"):
        validate_kem_public_key(b"")


def test_kem_key_failing_the_modulus_check_is_refused() -> None:
    bad = bytearray(GOOD_KEM_KEY)
    # Coefficient c0 at byte 300 = 0xFFF = 4095 >= 3329.
    bad[300] = 0xFF
    bad[301] = (bad[301] & 0xF0) | 0x0F
    with pytest.raises(ValueError, match="byte 300 is not reduced modulo 3329"):
        validate_kem_public_key(bytes(bad))
    # c1 = 3329 exactly is out of range too: c1 = b1>>4 | b2<<4 = 0x1 | 0xD0<<4.
    edge = bytearray(GOOD_KEM_KEY)
    edge[1] = 0x10
    edge[2] = 0xD0
    assert (edge[1] >> 4 | edge[2] << 4) == 3329
    with pytest.raises(ValueError, match="byte 0 is not reduced"):
        validate_kem_public_key(bytes(edge))
    # 3328 is the largest accepted coefficient.
    ok = bytearray(GOOD_KEM_KEY)
    ok[2] = 0xD0
    ok[1] = 0x00
    assert (ok[1] >> 4 | ok[2] << 4) == 3328
    validate_kem_public_key(bytes(ok))


def test_kem_key_with_an_all_zero_t_hat_is_refused() -> None:
    zero = bytes(1536) + bytes(range(32))
    with pytest.raises(ValueError, match="all zero"):
        msg.pqc.register_kem_key(sender=ADDR, public_key=zero)


def test_other_kem_algorithms_pass_through() -> None:
    m = msg.pqc.register_kem_key(sender=ADDR, public_key=b"\x00" * 10, algorithm_id=7)
    assert m.value.algorithm_id == 7  # type: ignore[attr-defined]
    with pytest.raises(ValueError, match="algorithm_id"):
        validate_kem_public_key(GOOD_KEM_KEY, 0)


def test_fetch_kem_key_parses_found_and_missing() -> None:
    rest = FakeRest(
        {
            "found": True,
            "key": {
                "address": ADDR,
                "algorithm_id": 2,
                "algorithm_name": "mlkem1024",
                "public_key": base64.b64encode(GOOD_KEM_KEY).decode(),
                "registered_height": "8979497",
            },
        }
    )
    got = fetch_kem_key(rest, "0xAbC")
    assert rest.paths == ["/qorechain/pqc/v1/kem/0xAbC"]
    assert got.found is True and got.key is not None
    assert got.key.public_key == GOOD_KEM_KEY
    assert got.key.registered_height == 8979497
    assert got.key.algorithm_name == "mlkem1024"
    none = fetch_kem_key(FakeRest({"found": False, "key": None}), ADDR)
    assert none.found is False and none.key is None


def test_fetch_kem_key_async() -> None:
    class AsyncRest:
        async def get(self, path: str, params: Any = None) -> Any:
            return {"found": False, "key": None}

    assert asyncio.run(fetch_kem_key_async(AsyncRest(), ADDR)).found is False


@pytest.mark.parametrize(
    "code,kind",
    [
        (250, "kem_registry_not_enabled"),
        (251, "kem_key_invalid"),
        (252, "kem_key_not_found"),
        (253, "kem_key_unchanged"),
        (254, "kem_needs_signature_key"),
    ],
)
def test_kem_error_codes_are_named(code: int, kind: str) -> None:
    assert decode_tx_error(code, "pqc", "x").kind == kind


def test_kem_refusals_named_from_text() -> None:
    assert error_from_text(
        "failed to execute message; message index: 0: no KEM key published for this account"
    ) == ("pqc", 252)
    assert error_from_text(
        "publishing a KEM key needs a registered post-quantum signature key: sender has none"
    ) == ("pqc", 254)


def test_kem_messages_are_not_classical_exempt() -> None:
    from qorsdk import pqc_dx

    src = open(pqc_dx.__file__, encoding="utf-8").read()
    assert "KEMKey" not in src


# --------------------------------------------------------------------------- #
# spending rules: EVM denoms
# --------------------------------------------------------------------------- #

ERC20 = "erc20/0x" + "ab" * 20


@pytest.mark.parametrize(
    "denom",
    [
        "uqor",
        ERC20,
        "ERC20/0X" + "AB" * 20,
        "erc721/0x" + "12" * 20 + "/7",
        "erc1155/0x" + "12" * 20 + "/42",
        "erc721/0x" + "12" * 20,
    ],
)
def test_valid_evm_denoms_pass(denom: str) -> None:
    validate_evm_denom(denom)


@pytest.mark.parametrize(
    "denom,match",
    [
        ("erc20/" + "ab" * 20, "0x-prefixed 20-byte"),
        ("erc20/0x" + "ab" * 19, "0x-prefixed 20-byte"),
        ("erc721/0xzz" + "ab" * 19, "0x-prefixed 20-byte"),
        ("erc1155/", "0x-prefixed 20-byte"),
        (ERC20 + "/1", "contract address alone"),
    ],
)
def test_invalid_evm_denoms_are_refused(denom: str, match: str) -> None:
    with pytest.raises(ValueError, match=match):
        validate_evm_denom(denom)


def test_spending_rules_check_evm_denoms_in_limits_and_allowed_denoms() -> None:
    with pytest.raises(ValueError, match="spending rule 0: denom"):
        validate_spending_rules(
            [{"enabled": True, "denom_limits": [{"denom": "erc20/0x12", "per_tx_limit": "5"}]}]
        )
    with pytest.raises(ValueError, match="spending rule 1: denom"):
        validate_spending_rules(
            [
                {"enabled": True, "daily_limit": 1},
                {"enabled": True, "allowed_denoms": ["uqor", ERC20 + "/9"]},
            ]
        )
    validate_spending_rules(
        [
            {
                "enabled": True,
                "allowed_denoms": [ERC20],
                "denom_limits": [{"denom": ERC20, "daily_limit": "9"}],
            }
        ]
    )
    with pytest.raises(ValueError, match="denom"):
        msg.abstractaccount.update_spending_rules(
            owner=ADDR, rules=[{"enabled": True, "allowed_denoms": ["erc20/nope"]}]
        )


def test_invalid_spending_rule_code_8_is_named() -> None:
    assert decode_tx_error(8, "abstractaccount", "x").kind == "invalid_spending_rule"
    assert error_from_text("rule 0: denom limit without a denom: invalid spending rule") == (
        "abstractaccount",
        8,
    )
    assert decode_tx_error(9, "abstractaccount", "x").kind == "abstractaccount_disabled"


# --------------------------------------------------------------------------- #
# governance messages
# --------------------------------------------------------------------------- #

GOV = "qor1qurswpc8qurswpc8qurswpc8qurswpc88cse4r"
CONTRACT = "qor1qqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8qarc0skm0f0x"


def test_update_config_encodes_and_checks() -> None:
    m = msg.abstractaccount.update_config(
        authority=GOV,
        enabled=True,
        max_session_keys=10,
        max_spending_rules=5,
        default_session_ttl=86400,
    )
    decoded = QORECHAIN_REGISTRY_TYPES[m.type_url].FromString(m.value.SerializeToString())  # type: ignore[attr-defined]
    assert (decoded.authority, decoded.enabled, decoded.max_session_keys) == (GOV, True, 10)
    assert decoded.default_session_ttl == 86400
    with pytest.raises(ValueError, match="max_spending_rules must be a positive"):
        msg.abstractaccount.update_config(
            authority=GOV,
            enabled=True,
            max_session_keys=10,
            max_spending_rules=0,
            default_session_ttl=1,
        )
    with pytest.raises(ValueError, match="authority"):
        msg.abstractaccount.update_config(
            authority="",
            enabled=False,
            max_session_keys=1,
            max_spending_rules=1,
            default_session_ttl=1,
        )


def test_crossvm_update_params_encodes_and_checks() -> None:
    m = msg.crossvm.update_params(
        authority=GOV,
        max_message_size=65536,
        max_queue_size=1000,
        queue_timeout_blocks=100,
        enabled=True,
        bridge_allowed_targets=[f"cosmwasm:{CONTRACT}"],
    )
    assert m.type_url == "/qorechain.crossvm.v1.MsgUpdateParams"
    decoded = QORECHAIN_REGISTRY_TYPES[m.type_url].FromString(m.value.SerializeToString())  # type: ignore[attr-defined]
    assert list(decoded.bridge_allowed_targets) == [f"cosmwasm:{CONTRACT}"]
    base = dict(
        authority=GOV,
        max_message_size=65536,
        max_queue_size=1000,
        queue_timeout_blocks=100,
        enabled=True,
    )
    for targets, match in [
        (["cosmwasm"], "<vm>:<contract>"),
        ([f"evm:{CONTRACT}"], "only calls cosmwasm"),
        (["cosmwasm:qor1bad"], "invalid contract address"),
        ([f"cosmwasm:{CONTRACT}"] * 2, "listed twice"),
    ]:
        with pytest.raises(ValueError, match=match):
            msg.crossvm.update_params(**base, bridge_allowed_targets=targets)
    with pytest.raises(ValueError, match="exceeds"):
        msg.crossvm.update_params(**{**base, "max_queue_size": 10_001})
    with pytest.raises(ValueError, match="positive"):
        msg.crossvm.update_params(**{**base, "queue_timeout_blocks": 0})


def test_rdk_update_params_encodes_and_checks() -> None:
    base: dict[str, Any] = dict(
        authority=GOV,
        max_rollups=100,
        min_stake_for_rollup=10_000_000,
        rollup_creation_burn_rate="0.01",
        default_challenge_window=604800,
        max_da_blob_size=1 << 20,
        blob_retention_blocks=1000,
        max_batches_per_block=10,
    )
    m = msg.rdk.update_params(**base)
    assert m.type_url == "/qorechain.rdk.v1.MsgUpdateParams"
    decoded = QORECHAIN_REGISTRY_TYPES[m.type_url].FromString(m.value.SerializeToString())  # type: ignore[attr-defined]
    assert decoded.rollup_creation_burn_rate == "0.01"
    assert decoded.default_challenge_window == 604800
    for field, value, match in [
        ("rollup_creation_burn_rate", "1", r"\[0, 1\)"),
        ("rollup_creation_burn_rate", "-0.1", r"\[0, 1\)"),
        ("rollup_creation_burn_rate", "abc", r"\[0, 1\)"),
        ("default_challenge_window", 59, "60..2592000"),
        ("max_da_blob_size", (8 << 20) + 1, "exceeds"),
        ("max_rollups", 0, "positive"),
    ]:
        with pytest.raises(ValueError, match=match):
            msg.rdk.update_params(**{**base, field: value})
    msg.rdk.update_params(**{**base, "rollup_creation_burn_rate": "0"})


# --------------------------------------------------------------------------- #
# abstract-account reads
# --------------------------------------------------------------------------- #


def test_fetch_spending_rules() -> None:
    rest = FakeRest(
        {
            "rules": [{"daily_limit": "5", "enabled": True, "denom_limits": []}],
            "authenticator_rules": [
                {
                    "scheme": "eip191",
                    "pubkey_hex": "02ab",
                    "rule": {"per_tx_limit": "1", "enabled": True},
                }
            ],
        }
    )
    got = fetch_spending_rules(rest, ADDR)
    assert rest.paths == [f"/qorechain/abstractaccount/v1/accounts/{ADDR}/spending_rules"]
    assert got.rules[0]["daily_limit"] == "5"
    assert got.authenticator_rules[0].scheme == "eip191"
    assert got.authenticator_rules[0].rule["per_tx_limit"] == "1"


def test_fetch_authenticators() -> None:
    rest = FakeRest(
        {
            "authenticators": [
                {
                    "scheme": "eip191",
                    "pubkey_hex": "02ab",
                    "permissions": ["evm_execute"],
                    "expiry_unix": "1800000000",
                    "label": "metamask",
                    "created_at_unix": "1700000000",
                    "revoked": False,
                    "has_spend_rule": True,
                }
            ]
        }
    )
    (a,) = fetch_authenticators(rest, ADDR)
    assert rest.paths == [f"/qorechain/abstractaccount/v1/accounts/{ADDR}/authenticators"]
    assert a.permissions == ("evm_execute",)
    assert a.expiry_unix == 1800000000
    assert a.has_spend_rule is True and a.revoked is False
