"""Tests for the v3.2.0 EVM authorisation window client surface.

Covers the composer round-trip through the registry, the client-side bounds that
mirror the chain's ``ValidateBasic``, parsing of both shapes the ``evm_window``
query returns (with exact integers well above 2^53), and the refusal classifier
over codes, the chain's own texts, and an unrelated error.
"""

from __future__ import annotations

import httpx
import pytest
import respx

from qorsdk import (
    CLOSE_EVM_WINDOW_TYPE_URL,
    ERR_EVM_WINDOW_EXHAUSTED,
    ERR_INVALID_EVM_WINDOW,
    ERR_NO_EVM_WINDOW,
    MAX_EVM_WINDOW_BLOCKS,
    MAX_EVM_WINDOW_TXS,
    OPEN_EVM_WINDOW_TYPE_URL,
    AsyncRestClient,
    EVMWindowStatus,
    RestClient,
    classify_evm_window_error,
    decode_any,
    decode_tx_error,
    describe_evm_window_error,
    evm_window_path,
    evm_window_remedy,
    get_evm_window,
    get_evm_window_async,
    msg,
    parse_evm_window,
    qorechain_registry,
    resolve_message_type,
    validate_evm_window_params,
)
from qorsdk.messages import Msg

ADDR = "qor1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"

# The live shape, verified on the testnet after the v3.2.0 upgrade.
LIVE_PAYLOAD = {
    "found": True,
    "live": True,
    "opened_height": "6069608",
    "expiry_height": "6069908",
    "max_txs": "5",
    "used_txs": "1",
    "max_value": "2000000",
    "used_value": "3363",
    "remaining_blocks": "286",
    "remaining_txs": "4",
    "remaining_value": "1996637",
}

# The chain's own refusal texts, as they arrive over EVM JSON-RPC (a broadcast
# error carrying the message, with no codespace attached).
NO_WINDOW_TEXT = (
    f"account {ADDR} has no open EVM authorisation window; open one with "
    "MsgOpenEVMWindow, signed on the Cosmos lane with the account's post-quantum key"
)
NO_PQC_KEY_TEXT = f"account {ADDR} has no registered post-quantum key"


# --------------------------------------------------------------------------- #
# Composers
# --------------------------------------------------------------------------- #


def test_open_evm_window_composer_round_trips_through_the_registry() -> None:
    m = msg.pqc.open_evm_window(
        sender=ADDR, blocks=300, max_txs=5, max_value="2000000"
    )
    assert isinstance(m, Msg)
    assert m.type_url == OPEN_EVM_WINDOW_TYPE_URL

    raw = m.value.SerializeToString()
    decoded = decode_any(m.type_url, raw)
    assert decoded.sender == ADDR
    assert decoded.blocks == 300
    assert decoded.max_txs == 5
    assert decoded.max_value == "2000000"
    # The same bytes the chain would produce for the registered type.
    assert resolve_message_type(m.type_url) is type(decoded)
    assert decoded.SerializeToString() == raw


def test_close_evm_window_composer_round_trips_through_the_registry() -> None:
    m = msg.pqc.close_evm_window(sender=ADDR)
    assert m.type_url == CLOSE_EVM_WINDOW_TYPE_URL
    raw = m.value.SerializeToString()
    decoded = decode_any(m.type_url, raw)
    assert decoded.sender == ADDR
    assert decoded.SerializeToString() == raw


def test_both_window_messages_are_registered() -> None:
    reg = qorechain_registry()
    assert OPEN_EVM_WINDOW_TYPE_URL in reg
    assert CLOSE_EVM_WINDOW_TYPE_URL in reg


def test_open_evm_window_accepts_an_integer_max_value() -> None:
    m = msg.pqc.open_evm_window(sender=ADDR, blocks=1, max_txs=1, max_value=2_000_000)
    assert m.value.max_value == "2000000"


# --------------------------------------------------------------------------- #
# Validation bounds (mirror of the chain's ValidateBasic)
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("blocks", [0, -1, MAX_EVM_WINDOW_BLOCKS + 1])
def test_blocks_outside_the_bound_is_refused_naming_the_bound(blocks: int) -> None:
    with pytest.raises(ValueError) as excinfo:
        msg.pqc.open_evm_window(
            sender=ADDR, blocks=blocks, max_txs=1, max_value="1"
        )
    text = str(excinfo.value)
    assert "blocks" in text
    assert str(MAX_EVM_WINDOW_BLOCKS) in text


@pytest.mark.parametrize("blocks", [1, MAX_EVM_WINDOW_BLOCKS])
def test_blocks_at_the_bound_is_accepted(blocks: int) -> None:
    m = msg.pqc.open_evm_window(sender=ADDR, blocks=blocks, max_txs=1, max_value="1")
    assert m.value.blocks == blocks


@pytest.mark.parametrize("max_txs", [0, -1, MAX_EVM_WINDOW_TXS + 1])
def test_max_txs_outside_the_bound_is_refused_naming_the_bound(max_txs: int) -> None:
    with pytest.raises(ValueError) as excinfo:
        msg.pqc.open_evm_window(
            sender=ADDR, blocks=10, max_txs=max_txs, max_value="1"
        )
    text = str(excinfo.value)
    assert "max_txs" in text
    assert str(MAX_EVM_WINDOW_TXS) in text


@pytest.mark.parametrize("max_txs", [1, MAX_EVM_WINDOW_TXS])
def test_max_txs_at_the_bound_is_accepted(max_txs: int) -> None:
    m = msg.pqc.open_evm_window(sender=ADDR, blocks=10, max_txs=max_txs, max_value="1")
    assert m.value.max_txs == max_txs


@pytest.mark.parametrize("max_value", ["0", 0, "-1", -1])
def test_non_positive_max_value_is_refused_naming_the_bound(
    max_value: str | int,
) -> None:
    with pytest.raises(ValueError) as excinfo:
        msg.pqc.open_evm_window(
            sender=ADDR, blocks=10, max_txs=1, max_value=max_value
        )
    text = str(excinfo.value)
    assert "max_value" in text
    assert "greater than 0" in text


@pytest.mark.parametrize("max_value", ["1.5", "abc", "", "1e6"])
def test_non_integer_max_value_is_refused(max_value: str) -> None:
    with pytest.raises(ValueError) as excinfo:
        msg.pqc.open_evm_window(
            sender=ADDR, blocks=10, max_txs=1, max_value=max_value
        )
    assert "max_value" in str(excinfo.value)


def test_validate_evm_window_params_returns_the_normalized_bounds() -> None:
    params = validate_evm_window_params(blocks=300, max_txs=5, max_value=2_000_000)
    assert params.blocks == 300
    assert params.max_txs == 5
    assert params.max_value == "2000000"


def test_every_field_is_required_no_defaults() -> None:
    with pytest.raises(TypeError):
        msg.pqc.open_evm_window(sender=ADDR, blocks=300, max_txs=5)  # type: ignore[call-arg]


# --------------------------------------------------------------------------- #
# Query parsing
# --------------------------------------------------------------------------- #


def test_parse_absent_window() -> None:
    status = parse_evm_window({"found": False})
    assert status == EVMWindowStatus(
        found=False,
        live=False,
        opened_height=0,
        expiry_height=0,
        max_txs=0,
        used_txs=0,
        max_value=0,
        used_value=0,
        remaining_blocks=0,
        remaining_txs=0,
        remaining_value=0,
    )


def test_parse_live_window() -> None:
    status = parse_evm_window(LIVE_PAYLOAD)
    assert status.found is True
    assert status.live is True
    assert status.opened_height == 6_069_608
    assert status.expiry_height == 6_069_908
    assert status.max_txs == 5
    assert status.used_txs == 1
    assert status.max_value == 2_000_000
    # The measured cost of a 1,000 uqor transfer with 21,000 gas at 112.5 gwei:
    # max_value bounds value PLUS the maximum fee, and wei -> uqor rounds up.
    assert status.used_value == 3_363
    assert status.remaining_blocks == 286
    assert status.remaining_txs == 4
    assert status.remaining_value == 1_996_637


def test_parse_keeps_cosmos_int_exact_above_2_to_the_53() -> None:
    huge = "9007199254740993000000"  # > 2^53; a float would lose the low digits
    payload = dict(LIVE_PAYLOAD, max_value=huge, remaining_value=huge)
    status = parse_evm_window(payload)
    assert status.max_value == 9_007_199_254_740_993_000_000
    assert str(status.max_value) == huge
    assert status.remaining_value == 9_007_199_254_740_993_000_000


def test_parse_refuses_a_float_field() -> None:
    with pytest.raises(ValueError, match="max_value"):
        parse_evm_window(dict(LIVE_PAYLOAD, max_value=2000000.0))


def test_evm_window_path_is_the_documented_route() -> None:
    assert evm_window_path(ADDR) == f"/qorechain/pqc/v1/evm_window/{ADDR}"


@respx.mock
def test_get_evm_window_over_rest() -> None:
    respx.get(f"https://lcd.example{evm_window_path(ADDR)}").mock(
        return_value=httpx.Response(200, json=LIVE_PAYLOAD)
    )
    with RestClient("https://lcd.example") as rest:
        status = get_evm_window(rest, ADDR)
    assert status.remaining_value == 1_996_637


@respx.mock
def test_get_evm_window_absent_is_a_200() -> None:
    respx.get(f"https://lcd.example{evm_window_path(ADDR)}").mock(
        return_value=httpx.Response(200, json={"found": False})
    )
    with RestClient("https://lcd.example") as rest:
        status = get_evm_window(rest, ADDR)
    assert status.found is False
    assert status.live is False


@respx.mock
async def test_get_evm_window_async() -> None:
    respx.get(f"https://lcd.example{evm_window_path(ADDR)}").mock(
        return_value=httpx.Response(200, json=LIVE_PAYLOAD)
    )
    async with AsyncRestClient("https://lcd.example") as rest:
        status = await get_evm_window_async(rest, ADDR)
    assert status.max_txs == 5


# --------------------------------------------------------------------------- #
# Refusal classifier
# --------------------------------------------------------------------------- #


def test_classifies_pqc_codes() -> None:
    assert (
        classify_evm_window_error(code=ERR_NO_EVM_WINDOW, codespace="pqc")
        == "no_window"
    )
    assert (
        classify_evm_window_error(code=ERR_EVM_WINDOW_EXHAUSTED, codespace="pqc")
        == "window_exhausted"
    )
    assert (
        classify_evm_window_error(code=ERR_INVALID_EVM_WINDOW, codespace="pqc")
        == "invalid_window"
    )


def test_classifies_the_chain_texts_without_a_codespace() -> None:
    assert classify_evm_window_error(message=NO_WINDOW_TEXT) == "no_window"
    assert classify_evm_window_error(message=NO_PQC_KEY_TEXT) == "no_pqc_key"


def test_no_pqc_key_is_its_own_state_under_code_28() -> None:
    # Code 28 covers two states; the text decides, and the remedies differ.
    assert (
        classify_evm_window_error(
            code=ERR_INVALID_EVM_WINDOW, codespace="pqc", message=NO_PQC_KEY_TEXT
        )
        == "no_pqc_key"
    )
    assert "register a post-quantum key" in evm_window_remedy("no_pqc_key")
    assert "open an EVM authorisation window" in evm_window_remedy("no_window")


def test_exhausted_and_invalid_texts() -> None:
    assert (
        classify_evm_window_error(message="EVM authorisation window is exhausted")
        == "window_exhausted"
    )
    assert (
        classify_evm_window_error(message="invalid EVM authorization window")
        == "invalid_window"
    )


@pytest.mark.parametrize(
    "kwargs",
    [
        {"code": 5, "codespace": "sdk", "message": "insufficient funds"},
        {"message": "nonce too low"},
        # A numeric code means nothing outside its codespace.
        {"code": ERR_NO_EVM_WINDOW, "codespace": "sdk"},
        {"code": ERR_NO_EVM_WINDOW},
        {},
    ],
)
def test_unrelated_errors_do_not_match(kwargs: dict[str, object]) -> None:
    assert classify_evm_window_error(**kwargs) is None  # type: ignore[arg-type]
    assert describe_evm_window_error(**kwargs) is None  # type: ignore[arg-type]


def test_describe_pairs_the_kind_with_its_remedy() -> None:
    refusal = describe_evm_window_error(
        code=ERR_NO_EVM_WINDOW, codespace="pqc", message=NO_WINDOW_TEXT
    )
    assert refusal is not None
    assert refusal.kind == "no_window"
    assert refusal.message == NO_WINDOW_TEXT
    # The ordering trap is part of the remedy a wallet shows.
    assert "read the nonce" in refusal.remedy


def test_decode_tx_error_knows_the_window_codes() -> None:
    decoded = decode_tx_error(ERR_NO_EVM_WINDOW, "pqc", NO_WINDOW_TEXT)
    assert decoded.kind == "no_evm_window"
    assert decode_tx_error(ERR_EVM_WINDOW_EXHAUSTED, "pqc").kind == (
        "evm_window_exhausted"
    )
    assert decode_tx_error(ERR_INVALID_EVM_WINDOW, "pqc").kind == "invalid_evm_window"
