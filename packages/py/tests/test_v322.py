"""Client support for chain v3.2.2: delegation consent, the ecdsa_pubkey rule,
upgrade detection and the new error kinds."""

from __future__ import annotations

from typing import Any

import pytest
from bech32 import bech32_encode, convertbits
from bip_utils import Secp256k1PrivateKey

from qorsdk import (
    CHAIN_UPGRADE_V3_2_2,
    EVM_DELEGATION_CLEAR,
    MAX_EVM_DELEGATION_CONSENT_BLOCKS,
    classify_evm_delegation_error,
    clear_upgrade_cache,
    decode_tx_error,
    evm_delegation_tuple_nonce,
    get_evm_delegation_consent,
    is_upgrade_applied,
    msg,
    require_upgrade_applied,
    upgrade_applied_height,
    validate_classical_key_for_sender,
)
from qorsdk.messages.registry import QORECHAIN_REGISTRY_TYPES as REGISTRY
from qorsdk.pqc_dx import build_register_pqc_key
from qorsdk.utils import ripemd160, sha256

SENDER = "qor18df074t3k0xq8jf7336hpjjsktw354knr650aq"
DELEGATE = "0x63C0c19a282a1B52b07dD5a65b58948A07DAE32B"


class FakeRest:
    def __init__(self, *answers: Any) -> None:
        self.answers = list(answers)
        self.paths: list[str] = []

    def get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        self.paths.append(path)
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer


def _cosmos_key() -> tuple[str, bytes]:
    pub = Secp256k1PrivateKey.FromBytes(b"\x11" * 32).PublicKey().RawCompressed().ToBytes()
    words = convertbits(ripemd160(sha256(pub)), 8, 5)
    assert words is not None
    return bech32_encode("qor", words), pub


@pytest.mark.parametrize(
    "type_url",
    [
        "/qorechain.pqc.v1.MsgAuthorizeEVMDelegation",
        "/qorechain.pqc.v1.MsgClearEVMDelegation",
        "/qorechain.bridge.v1.MsgUpdateCircuitBreakerLimits",
        "/qorechain.multilayer.v1.MsgUpdateParams",
    ],
)
def test_new_messages_registered(type_url: str) -> None:
    assert type_url in REGISTRY


def test_authorize_evm_delegation_lowercases_and_bounds() -> None:
    m = msg.pqc.authorize_evm_delegation(sender=SENDER, delegate=DELEGATE, blocks=600)
    assert m.type_url == "/qorechain.pqc.v1.MsgAuthorizeEVMDelegation"
    assert m.value.delegate == DELEGATE.lower()
    assert m.value.blocks == 600
    clear = msg.pqc.authorize_evm_delegation(
        sender=SENDER, delegate=EVM_DELEGATION_CLEAR, blocks=1
    )
    assert clear.value.delegate == EVM_DELEGATION_CLEAR
    with pytest.raises(ValueError, match="1..17280"):
        msg.pqc.authorize_evm_delegation(sender=SENDER, delegate=DELEGATE, blocks=0)
    with pytest.raises(ValueError, match="1..17280"):
        msg.pqc.authorize_evm_delegation(
            sender=SENDER, delegate=DELEGATE, blocks=MAX_EVM_DELEGATION_CONSENT_BLOCKS + 1
        )
    with pytest.raises(ValueError, match="0x-prefixed"):
        msg.pqc.authorize_evm_delegation(sender=SENDER, delegate="63c0c19a", blocks=5)


def test_clear_evm_delegation() -> None:
    m = msg.pqc.clear_evm_delegation(sender=SENDER)
    assert m.type_url == "/qorechain.pqc.v1.MsgClearEVMDelegation"
    assert m.value.sender == SENDER


def test_consent_query_and_tuple_nonce() -> None:
    rest = FakeRest(
        {
            "found": True,
            "live": True,
            "delegate": DELEGATE.lower(),
            "granted_height": "6905100",
            "expiry_height": "6905700",
            "current_delegate": "",
            "nonce": "7",
        }
    )
    c = get_evm_delegation_consent(rest, SENDER)
    assert rest.paths == [f"/qorechain/pqc/v1/evm_delegation_consent/{SENDER}"]
    assert (c.found, c.live, c.expiry_height, c.nonce) == (True, True, 6905700, 7)
    assert evm_delegation_tuple_nonce(c, sponsored=True) == 7
    assert evm_delegation_tuple_nonce(c, sponsored=False) == 8


def test_classify_evm_delegation_error() -> None:
    assert (
        classify_evm_delegation_error(
            message="no post-quantum consent for this EIP-7702 delegation: authority 0xabc"
        )
        == "no_consent"
    )
    assert classify_evm_delegation_error(code=61, codespace="pqc") == "invalid_delegation"
    assert classify_evm_delegation_error(code=26, codespace="pqc") is None


def test_classical_key_accepted_by_diana() -> None:
    # Registration accepted on diana at h 7,911,828, with the v3.2.2 rule on.
    assert (
        validate_classical_key_for_sender(
            "qor1hkkxx5jmmw02wcz26c74lsp74qysj6h495vv0k",
            bytes.fromhex("038844ec286297bf780ce0fbe07df2a74c5e0e841df5f3adc363f0372755b76d74"),
        )
        == "eth"
    )


def test_classical_key_cosmos_empty_and_refusals() -> None:
    addr, pub = _cosmos_key()
    assert validate_classical_key_for_sender(addr, pub) == "cosmos"
    assert validate_classical_key_for_sender(SENDER, b"") == "empty"
    assert validate_classical_key_for_sender(SENDER, None) == "empty"
    with pytest.raises(ValueError, match="does not belong"):
        validate_classical_key_for_sender(SENDER, pub)
    with pytest.raises(ValueError, match="33-byte"):
        validate_classical_key_for_sender(SENDER, b"\x04" + b"\x01" * 64)


def test_build_register_pqc_key_applies_the_rule() -> None:
    addr, pub = _cosmos_key()
    with pytest.raises(ValueError, match="does not belong"):
        build_register_pqc_key(
            sender=SENDER, dilithium_pubkey=b"\x00" * 2592, ecdsa_pubkey=pub
        )
    m = build_register_pqc_key(sender=addr, dilithium_pubkey=b"\x00" * 2592, ecdsa_pubkey=pub)
    assert m.value.ecdsa_pubkey == pub


def test_upgrade_detection() -> None:
    clear_upgrade_cache()
    rest = FakeRest({"height": "6905034"})
    assert upgrade_applied_height(rest, CHAIN_UPGRADE_V3_2_2, cache_key="diana") == 6905034
    assert is_upgrade_applied(rest, CHAIN_UPGRADE_V3_2_2, cache_key="diana")
    assert rest.paths == ["/cosmos/upgrade/v1beta1/applied_plan/v3.2.2"]

    mainnet = FakeRest({"height": "0"}, {"height": "0"}, {"height": "42"})
    assert not is_upgrade_applied(mainnet, CHAIN_UPGRADE_V3_2_2, cache_key="vladi")
    with pytest.raises(ValueError, match="native_only needs chain v3.2.2"):
        require_upgrade_applied(
            mainnet, CHAIN_UPGRADE_V3_2_2, "native_only", cache_key="vladi-2"
        )
    assert is_upgrade_applied(mainnet, CHAIN_UPGRADE_V3_2_2, cache_key="vladi", fresh=True)

    with pytest.raises(RuntimeError):
        is_upgrade_applied(FakeRest(RuntimeError("HTTP 503")), CHAIN_UPGRADE_V3_2_2)


def test_decode_tx_error_v322() -> None:
    log = (
        "sender qor1abc has sent 600 transactions in the last 30 blocks, "
        "at the configured limit of 600 per minute"
    )
    assert decode_tx_error(3, "ai", log).kind == "rate_limited"
    assert decode_tx_error(3, None, log).kind == "rate_limited"
    assert decode_tx_error(3, "ai", "transaction rejected by AI engine").kind != "rate_limited"
    assert decode_tx_error(2, "ai", log).kind != "rate_limited"
    assert decode_tx_error(60, "pqc").kind == "evm_delegation_no_consent"
    assert decode_tx_error(61, "pqc").kind == "evm_delegation_invalid"
