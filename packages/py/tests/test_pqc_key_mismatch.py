"""ensure_pqc_registered compares the registered PQC key with the caller's."""

from __future__ import annotations

import base64

import httpx
import pytest
import respx
from dilithium_py.ml_dsa import ML_DSA_87

from qorsdk import (
    PqcKeyMismatchError,
    PqcKeypair,
    clear_pqc_status_cache,
    clear_upgrade_cache,
    derive_native_account,
    ensure_pqc_registered,
    fetch_pqc_status,
    is_registered_pqc_key,
    migrate_to_hybrid,
    msg,
    pqc_status_public_key,
)

TEST_MNEMONIC = (
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
)
CHAIN_ID = "qorechain-diana"
REST = "http://localhost:1317"
FEE = {"amount": [{"denom": "uqor", "amount": "5000"}], "gas": "200000"}
ACCOUNT = derive_native_account(TEST_MNEMONIC)
ADDR = ACCOUNT.address
STATUS_URL = f"{REST}/qorechain/pqc/v1/account/{ADDR}"


def _keypair(fill: int) -> PqcKeypair:
    public_key, secret_key = ML_DSA_87.key_derive(bytes([fill]) * 32)
    return PqcKeypair(public_key=bytes(public_key), secret_key=bytes(secret_key))


MINE = _keypair(2)
OTHER = _keypair(3)


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def _status_answers(*keys: bytes | None) -> list[httpx.Response]:
    """REST status answers, one per read; the last one repeats."""
    return [
        httpx.Response(
            200,
            json=(
                {"found": True, "account": {"public_key": _b64(k)}}
                if k is not None
                else {"found": False, "account": None}
            ),
        )
        for k in keys
    ]


def _mock_status(*keys: bytes | None) -> respx.Route:
    answers = _status_answers(*keys)
    calls = {"n": 0}

    def side_effect(_request: httpx.Request) -> httpx.Response:
        i = min(calls["n"], len(answers) - 1)
        calls["n"] += 1
        return answers[i]

    return respx.get(STATUS_URL).mock(side_effect=side_effect)


def _mock_node(tx_response: dict | None = None) -> respx.Route:
    clear_upgrade_cache()
    respx.get(url__regex=rf"{REST}/cosmos/upgrade/v1beta1/applied_plan/.*").mock(
        return_value=httpx.Response(200, json={"height": "0"})
    )
    return respx.post(f"{REST}/cosmos/tx/v1beta1/txs").mock(
        return_value=httpx.Response(
            200, json={"tx_response": tx_response or {"code": 0, "txhash": "DEADBEEF"}}
        )
    )


def _ensure(keypair: PqcKeypair = MINE):
    return ensure_pqc_registered(
        account=ACCOUNT,
        pqc_keypair=keypair,
        chain_id=CHAIN_ID,
        account_number=4,
        rest_url=REST,
        fee=FEE,
        sequence=2,
    )


@respx.mock
def test_mismatch_raises_and_sends_nothing():
    clear_pqc_status_cache()
    status = _mock_status(OTHER.public_key)
    broadcast = _mock_node()
    with pytest.raises(PqcKeyMismatchError, match="different PQC key") as info:
        _ensure()
    err = info.value
    assert err.kind == "pqc_key_mismatch"
    assert err.address == ADDR
    assert err.registered_public_key == OTHER.public_key
    assert err.public_key == MINE.public_key
    assert "Nothing was sent" in str(err)
    assert broadcast.call_count == 0
    # The mismatch is confirmed with a fresh (uncached) read before raising.
    assert status.call_count == 2


@respx.mock
def test_rereads_so_a_cached_key_from_before_a_rotation_is_no_false_alarm():
    clear_pqc_status_cache()
    _mock_status(OTHER.public_key, MINE.public_key)
    fetch_pqc_status(REST, ADDR)  # cached: the old key
    broadcast = _mock_node()
    assert _ensure() == {"already_registered": True}
    assert broadcast.call_count == 0


@respx.mock
def test_own_key_is_already_registered_with_one_read():
    clear_pqc_status_cache()
    status = _mock_status(MINE.public_key)
    broadcast = _mock_node()
    assert _ensure() == {"already_registered": True}
    assert status.call_count == 1
    assert broadcast.call_count == 0


@respx.mock
def test_migrate_to_hybrid_refuses_a_keypair_the_chain_does_not_hold():
    clear_pqc_status_cache()
    _mock_status(OTHER.public_key)
    broadcast = _mock_node()
    payment = msg.bank.send(from_address=ADDR, to_address=ADDR, amount=[])
    with pytest.raises(PqcKeyMismatchError):
        migrate_to_hybrid(
            account=ACCOUNT,
            pqc_keypair=MINE,
            messages=[payment],
            chain_id=CHAIN_ID,
            account_number=4,
            rest_url=REST,
            fee=FEE,
            qor=None,
        )
    assert broadcast.call_count == 0


def test_pre_read_status_hex_or_bytes_is_compared():
    other_hex = {"registered": True, "pubkey": OTHER.public_key.hex()}
    assert is_registered_pqc_key(other_hex, MINE.public_key) is False  # type: ignore[arg-type]
    other_0x = {"registered": True, "pubkey": "0x" + OTHER.public_key.hex()}
    assert pqc_status_public_key(other_0x) == OTHER.public_key  # type: ignore[arg-type]
    mine_bytes = {"registered": True, "pubkey": MINE.public_key}
    assert is_registered_pqc_key(mine_bytes, MINE.public_key) is True  # type: ignore[arg-type]
    url_safe = {"registered": True, "pubkey": base64.urlsafe_b64encode(MINE.public_key).decode()}
    assert pqc_status_public_key(url_safe) == MINE.public_key  # type: ignore[arg-type]
    assert pqc_status_public_key({"registered": True, "pubkey": "not a key!"}) is None  # type: ignore[arg-type]


@respx.mock
def test_status_without_a_key_is_already_registered():
    clear_pqc_status_cache()
    respx.get(STATUS_URL).mock(
        return_value=httpx.Response(200, json={"found": True, "account": None})
    )
    broadcast = _mock_node()
    assert _ensure() == {"already_registered": True}
    assert broadcast.call_count == 0
    assert is_registered_pqc_key({"registered": True}, MINE.public_key) is None


_REFUSED = {
    "code": 7,
    "codespace": "pqc",
    "raw_log": "PQC account already registered",
    "txhash": "AB",
}


@respx.mock
def test_race_refusal_with_another_key_raises():
    clear_pqc_status_cache()
    # First read: not registered. Then someone registers OTHER before our tx lands.
    _mock_status(None, OTHER.public_key)
    broadcast = _mock_node(_REFUSED)
    with pytest.raises(PqcKeyMismatchError):
        _ensure()
    assert broadcast.call_count == 1


@respx.mock
def test_race_refusal_with_own_key_is_already_registered():
    clear_pqc_status_cache()
    _mock_status(None, MINE.public_key)
    _mock_node(_REFUSED)
    assert _ensure() == {"already_registered": True}


@respx.mock
def test_positive_cache_keeps_the_key():
    clear_pqc_status_cache()
    status = _mock_status(MINE.public_key)
    fetch_pqc_status(REST, ADDR)
    again = fetch_pqc_status(REST, ADDR)
    assert status.call_count == 1
    assert pqc_status_public_key(again) == MINE.public_key
    assert is_registered_pqc_key(again, MINE.public_key) is True
    assert is_registered_pqc_key(again, OTHER.public_key) is False


@respx.mock
def test_fetch_pqc_status_reads_algorithm_id_from_the_account() -> None:
    # Keys the SDK registers have key_type "hybrid", which names no algorithm;
    # the account carries algorithm_id itself.
    clear_pqc_status_cache()
    respx.get(STATUS_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "found": True,
                "account": {"public_key": "AQID", "algorithm_id": 1, "key_type": "hybrid"},
            },
        )
    )
    status = fetch_pqc_status(REST, ADDR)
    assert status["algorithm_id"] == 1
    assert status["key_type"] == "hybrid"
