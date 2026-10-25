"""Client support for chain v3.2.4: staking tiers, the authenticator nonce,
protocol features, ``possession_proven`` and the IBC timeout helper."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

import httpx
import pytest
import respx

from qorsdk import (
    CHAIN_UPGRADE_V3_2_4,
    STAKING_LOCK_MONTHS,
    RestClient,
    clear_pqc_status_cache,
    decode_tx_error,
    fetch_auth_nonce,
    fetch_pqc_status,
    fetch_protocol_features,
    fetch_staking_locks,
    fetch_staking_tier_params,
    fetch_staking_tier_pool,
    ibc_timeout_timestamp,
    is_protocol_feature_enabled,
    msg,
)
from qorsdk.messages.registry import QORECHAIN_REGISTRY_TYPES
from qorsdk.proto.qorechain.stakingtier.v1 import tx_pb2 as stakingtier_tx
from qorsdk.stakingtier import fetch_staking_tier_params_async

ADDR = "qor1hkkxx5jmmw02wcz26c74lsp74qysj6h495vv0k"
VAL = "qorvaloper1hkkxx5jmmw02wcz26c74lsp74qysj6h4ewkcwk"


class FakeRest:
    """Answers every read with ``answer`` and records the paths asked."""

    def __init__(self, answer: Any) -> None:
        self.answer = answer
        self.paths: list[str] = []

    def get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        self.paths.append(path)
        return self.answer


class FakeAsyncRest(FakeRest):
    async def get(self, path: str, params: dict[str, Any] | None = None) -> Any:  # type: ignore[override]
        self.paths.append(path)
        return self.answer


# --------------------------------------------------------------------------- #
# staking tiers
# --------------------------------------------------------------------------- #


def test_lock_delegation_encodes_and_round_trips_through_the_registry() -> None:
    m = msg.stakingtier.lock_delegation(
        delegator=ADDR, validator=VAL, amount="10000000", months=6
    )
    assert m.type_url == "/qorechain.stakingtier.v1.MsgLockDelegation"
    cls = QORECHAIN_REGISTRY_TYPES[m.type_url]
    decoded = cls.FromString(m.value.SerializeToString())  # type: ignore[attr-defined]
    assert decoded.delegator == ADDR
    assert decoded.validator == VAL
    assert decoded.amount == "10000000"
    assert decoded.months == 6
    assert isinstance(decoded, stakingtier_tx.MsgLockDelegation)


def test_lock_delegation_applies_the_chains_checks() -> None:
    base: dict[str, Any] = {
        "delegator": ADDR,
        "validator": VAL,
        "amount": "10000000",
        "months": 3,
    }
    assert STAKING_LOCK_MONTHS == (3, 6, 12)
    with pytest.raises(ValueError, match="months must be one of 3, 6, 12"):
        msg.stakingtier.lock_delegation(**{**base, "months": 4})
    with pytest.raises(ValueError, match="positive integer"):
        msg.stakingtier.lock_delegation(**{**base, "amount": "0"})
    with pytest.raises(ValueError, match="positive integer"):
        msg.stakingtier.lock_delegation(**{**base, "amount": "1.5"})
    with pytest.raises(ValueError, match="validator"):
        msg.stakingtier.lock_delegation(**{**base, "validator": ""})
    with pytest.raises(ValueError, match="delegator"):
        msg.stakingtier.lock_delegation(**{**base, "delegator": ""})


def test_unlock_early_claim_bonus_and_update_params_are_registered() -> None:
    for m, url in (
        (
            msg.stakingtier.unlock_early(delegator=ADDR, lock_id=7),
            "/qorechain.stakingtier.v1.MsgUnlockEarly",
        ),
        (msg.stakingtier.claim_bonus(holder=ADDR), "/qorechain.stakingtier.v1.MsgClaimBonus"),
        (
            msg.stakingtier.update_params(authority=ADDR),
            "/qorechain.stakingtier.v1.MsgUpdateParams",
        ),
    ):
        assert m.type_url == url
        assert url in QORECHAIN_REGISTRY_TYPES


def test_reads_params_locks_and_pool() -> None:
    params = fetch_staking_tier_params(
        FakeRest(
            {
                "lock_tiers": [{"months": 3, "bonus_bps": 150}, {"months": 12, "bonus_bps": 500}],
                "light_node_bonus_bps": 200,
                "validator_bonus_bps": 300,
                "max_total_apy_bps": 2500,
                "early_unlock_penalty_bps": 500,
                "enabled": True,
                "min_lock_amount": "10000000",
            }
        )
    )
    assert [(t.months, t.bonus_bps) for t in params.lock_tiers] == [(3, 150), (12, 500)]
    assert params.min_lock_amount == 10_000_000
    assert params.enabled is True
    assert params.max_total_apy_bps == 2500

    rest = FakeRest(
        {
            "locks": [
                {
                    "id": "1",
                    "validator": VAL,
                    "locked_amount": "20000000",
                    "months": 6,
                    "end_time": "1800000000",
                    "accrued_bonus": "5",
                    "released": False,
                }
            ],
            "claimable": "5",
            "total_claimable": "5",
        }
    )
    locks = fetch_staking_locks(rest, ADDR)
    assert rest.paths == [f"/qorechain/stakingtier/v1/locks/{ADDR}"]
    lock = locks.locks[0]
    assert (lock.id, lock.locked_amount, lock.months, lock.end_time, lock.released) == (
        1,
        20_000_000,
        6,
        1_800_000_000,
        False,
    )
    assert locks.claimable == 5

    pool = fetch_staking_tier_pool(
        FakeRest({"balance": "0", "lock_count": "3", "last_base_apy_bps": "4510.47"})
    )
    assert pool.lock_count == 3
    assert pool.last_base_apy_bps == "4510.47"
    assert pool.balance == 0


def test_reads_params_async() -> None:
    rest = FakeAsyncRest({"enabled": False, "min_lock_amount": "1"})
    params = asyncio.run(fetch_staking_tier_params_async(rest))
    assert rest.paths == ["/qorechain/stakingtier/v1/params"]
    assert params.min_lock_amount == 1
    assert params.lock_tiers == ()


@respx.mock
def test_reads_over_a_rest_client() -> None:
    respx.get("https://lcd/qorechain/stakingtier/v1/pool").mock(
        return_value=httpx.Response(200, json={"surplus": "12", "lock_count": "0"})
    )
    with RestClient("https://lcd/") as rest:
        assert fetch_staking_tier_pool(rest).surplus == 12


def test_decodes_the_modules_errors() -> None:
    assert decode_tx_error(5, codespace="stakingtier").kind == "stakingtier_invalid_term"
    assert decode_tx_error(13, codespace="stakingtier").kind == "stakingtier_stake_locked"


# --------------------------------------------------------------------------- #
# chain v3.2.4 reads
# --------------------------------------------------------------------------- #


def test_protocol_features() -> None:
    rest = FakeRest(
        {
            "features": [
                {"name": "pqc-sign-bytes-v2", "enabled": True, "known": True, "staged": False},
                {"name": "x", "enabled": False, "known": True, "staged": True},
            ],
            "height": "3758400",
        }
    )
    r = fetch_protocol_features(rest)
    assert r.height == 3_758_400
    assert (r.features[1].name, r.features[1].enabled, r.features[1].known) == ("x", False, True)
    assert r.features[1].staged is True
    assert rest.paths[0] == "/qorechain/pqc/v1/protocol_features"
    assert is_protocol_feature_enabled(rest, "pqc-sign-bytes-v2") is True
    assert is_protocol_feature_enabled(rest, "x") is False
    assert is_protocol_feature_enabled(rest, "absent") is False


def test_auth_nonce_bytes_or_hex_key() -> None:
    rest = FakeRest({"nonce": "7", "linked": True})
    r = fetch_auth_nonce(rest, ADDR, bytes([0xAB, 0x01]))
    assert (r.nonce, r.linked) == (7, True)
    assert rest.paths[0] == f"/qorechain/abstractaccount/v1/auth_nonce/{ADDR}/ab01"
    fetch_auth_nonce(rest, ADDR, "0xAB01")
    assert rest.paths[1].endswith("/AB01")
    for bad in ("zz", "", "abc", "0x"):
        with pytest.raises(ValueError, match="hex"):
            fetch_auth_nonce(rest, ADDR, bad)
    assert len(rest.paths) == 2  # a bad key is refused before any read
    with pytest.raises(ValueError, match="no nonce"):
        fetch_auth_nonce(FakeRest({"linked": False}), ADDR, "ab")


@respx.mock
def test_pqc_status_carries_possession_proven() -> None:
    clear_pqc_status_cache()
    route = respx.get(f"https://lcd/qorechain/pqc/v1/account/{ADDR}").mock(
        return_value=httpx.Response(
            200, json={"found": True, "account": {"public_key": "AQID", "possession_proven": True}}
        )
    )
    assert fetch_pqc_status("https://lcd", ADDR)["possession_proven"] is True
    # Cached with the rest of the status.
    assert fetch_pqc_status("https://lcd", ADDR)["possession_proven"] is True
    assert route.call_count == 1
    clear_pqc_status_cache()


def test_ibc_timeout_timestamp_is_absolute_unix_nanoseconds() -> None:
    now = datetime(2026, 10, 25, tzinfo=timezone.utc)
    expected = (int(now.timestamp() * 1000) + 600_000) * 1_000_000
    assert ibc_timeout_timestamp(600, now=now) == expected
    for bad in (0, -1, float("inf"), float("nan")):
        with pytest.raises(ValueError, match="positive"):
            ibc_timeout_timestamp(bad)


def test_upgrade_constant() -> None:
    assert CHAIN_UPGRADE_V3_2_4 == "v3.2.4"


SIM_TEXT = (
    "rpc error: code = Unknown desc = failed to execute message; message index: 0: "
    "no bonus to claim [baseapp.go:1052] with gas used: '111685': unknown request"
)


def test_decode_tx_error_on_a_failed_simulation_text_only() -> None:
    from qorsdk import decode_tx_error

    d = decode_tx_error(0, None, SIM_TEXT)
    assert (d.codespace, d.code, d.kind) == ("stakingtier", 12, "stakingtier_nothing_to_claim")
    assert d.raw_log == SIM_TEXT
    # The longest match wins: the hybrid failure is not the plain PQC one.
    h = decode_tx_error(0, None, "hybrid PQC signature verification failed")
    assert (h.codespace, h.code) == ("pqc", 21)
    # A coded error is left alone.
    assert decode_tx_error(5, "sdk", "no bonus to claim").code == 5
    # Text that names nothing stays generic.
    assert decode_tx_error(0, None, "something else").kind == "sdk_0"


@respx.mock
def test_failed_simulation_raises_a_named_refusal() -> None:
    from cosmpy.protos.cosmos.tx.v1beta1.tx_pb2 import TxRaw

    from qorsdk import QoreTxError, SimulationRefusedError, simulate_gas_used
    from qorsdk.tx import BuiltTx

    raw = TxRaw(body_bytes=b"\x01", auth_info_bytes=b"\x02", signatures=[b"\x03"])
    built = BuiltTx(tx_raw=raw, tx_raw_bytes=raw.SerializeToString(), auth_info_bytes=b"\x02")
    route = respx.post("https://lcd/cosmos/tx/v1beta1/simulate")
    route.mock(
        return_value=httpx.Response(500, json={"code": 2, "message": SIM_TEXT, "details": []})
    )
    with pytest.raises(SimulationRefusedError) as info:
        simulate_gas_used("https://lcd", built)
    err = info.value
    assert isinstance(err, QoreTxError) and isinstance(err, httpx.HTTPStatusError)
    assert (err.codespace, err.code) == ("stakingtier", 12)
    assert err.kind == "stakingtier_nothing_to_claim"
    assert err.raw_log == SIM_TEXT
    assert err.response.status_code == 500
    # A failure that names no refusal is the plain HTTP error, as before.
    route.mock(return_value=httpx.Response(502, text="bad gateway"))
    with pytest.raises(httpx.HTTPStatusError) as plain:
        simulate_gas_used("https://lcd", built)
    assert not isinstance(plain.value, SimulationRefusedError)
