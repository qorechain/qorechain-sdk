"""Client support for chain v3.2.3: registration integrity, proof of possession,
the EVM window scope, the abstract-account v2 digest and the new error kinds."""

from __future__ import annotations

import hashlib
from typing import Any

import pytest
from dilithium_py.ml_dsa import ML_DSA_87

from qorsdk import (
    CHAIN_UPGRADE_V3_2_3,
    KEY_TYPE_CLASSICAL_ONLY,
    clear_upgrade_cache,
    decode_tx_error,
    evm_auth_digest_version,
    evm_auth_sign_bytes,
    evm_auth_sign_bytes_v2,
    is_degenerate_pqc_public_key,
    msg,
    proof_of_possession_sign_bytes,
    sign_proof_of_possession,
    validate_registered_pqc_key,
    verify_proof_of_possession,
)
from qorsdk.evm_window import parse_evm_window
from qorsdk.messages.registry import QORECHAIN_REGISTRY_TYPES
from qorsdk.pqc import PqcKeypair
from qorsdk.pqc_dx import build_register_pqc_key

SENDER = "qor18df074t3k0xq8jf7336hpjjsktw354knr650aq"
TARGET = "0x63C0c19a282a1B52b07dD5a65b58948A07DAE32B"


def _kp() -> PqcKeypair:
    pub, sec = ML_DSA_87.key_derive(b"\x01" * 32)
    return PqcKeypair(public_key=bytes(pub), secret_key=bytes(sec))


class FakeRest:
    def __init__(self, answer: Any) -> None:
        self.answer = answer

    def get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        return self.answer


def test_registration_integrity() -> None:
    kp = _kp()
    with pytest.raises(ValueError, match="classical_only"):
        validate_registered_pqc_key(KEY_TYPE_CLASSICAL_ONLY, kp.public_key)
    with pytest.raises(ValueError, match="required"):
        validate_registered_pqc_key("hybrid", b"")
    degenerate = kp.public_key[:32] + bytes(2560)
    assert is_degenerate_pqc_public_key(degenerate)
    with pytest.raises(ValueError, match="t1"):
        validate_registered_pqc_key("hybrid", degenerate)
    assert not is_degenerate_pqc_public_key(kp.public_key)
    with pytest.raises(ValueError, match="classical_only"):
        build_register_pqc_key(
            sender=SENDER,
            dilithium_pubkey=kp.public_key,
            ecdsa_pubkey=b"",
            key_type=KEY_TYPE_CLASSICAL_ONLY,
        )


def test_proof_of_possession() -> None:
    kp = _kp()
    assert proof_of_possession_sign_bytes(
        chain_id="qorechain-diana", account=SENDER, public_key=bytes.fromhex("abcd")
    ) == f"qorechain-pqc-pop-v1|qorechain-diana|1|{SENDER}|abcd".encode()
    a = sign_proof_of_possession(chain_id="qorechain-diana", account=SENDER, keypair=kp)
    assert a == sign_proof_of_possession(chain_id="qorechain-diana", account=SENDER, keypair=kp)
    assert len(a) == 4627
    # Same vector as every other SDK.
    assert hashlib.shake_256(a).hexdigest(16) == "5b767a00efb7ad721f5416a4bd7fcdad"
    ok: dict[str, Any] = {
        "chain_id": "qorechain-diana",
        "account": SENDER,
        "public_key": kp.public_key,
        "proof": a,
    }
    assert verify_proof_of_possession(**ok)
    assert not verify_proof_of_possession(**{**ok, "chain_id": "qorechain-vladi"})
    m = build_register_pqc_key(
        sender=SENDER, dilithium_pubkey=kp.public_key, ecdsa_pubkey=b"", proof_of_possession=a
    )
    assert m.value.proof_of_possession == a
    plain = build_register_pqc_key(
        sender=SENDER, dilithium_pubkey=kp.public_key, ecdsa_pubkey=b""
    )
    # Field 6 stays off the wire for nodes below v3.2.3.
    assert plain.value.proof_of_possession == b""
    assert len(plain.value.SerializeToString()) == len(m.value.SerializeToString()) - len(a) - 3


def test_evm_window_scope() -> None:
    scoped = msg.pqc.open_evm_window(
        sender=SENDER,
        blocks=10,
        max_txs=1,
        max_value=1,
        native_only=True,
        allowed_targets=[TARGET],
    )
    assert scoped.value.native_only is True
    assert list(scoped.value.allowed_targets) == [TARGET]
    plain = msg.pqc.open_evm_window(sender=SENDER, blocks=10, max_txs=1, max_value=1)
    assert len(plain.value.SerializeToString()) < len(scoped.value.SerializeToString())
    base: dict[str, Any] = {"sender": SENDER, "blocks": 10, "max_txs": 1, "max_value": 1}
    with pytest.raises(ValueError, match="20-byte"):
        msg.pqc.open_evm_window(**base, allowed_targets=["0x12"])
    with pytest.raises(ValueError, match="more than once"):
        msg.pqc.open_evm_window(**base, allowed_targets=[TARGET, TARGET.lower()])
    many = ["0x" + format(i, "040x") for i in range(17)]
    with pytest.raises(ValueError, match="maximum is 16"):
        msg.pqc.open_evm_window(**base, allowed_targets=many)
    w = parse_evm_window(
        {"found": True, "live": True, "native_only": True, "allowed_targets": [TARGET]}
    )
    assert w.native_only and w.allowed_targets == (TARGET,)
    assert parse_evm_window({"found": True}).allowed_targets == ()


def test_aa_digest_matches_chain() -> None:
    # Computed with the chain's own EVMAuthSignBytes / EVMAuthSignBytesV2.
    args: dict[str, Any] = dict(
        chain_id="qorechain-diana",
        account="qor1hkkxx5jmmw02wcz26c74lsp74qysj6h495vv0k",
        pubkey=bytes.fromhex("038844ec286297bf780ce0fbe07df2a74c5e0e841df5f3adc363f0372755b76d74"),
        to="0x63c0c19a282a1b52b07dd5a65b58948a07dae32b",
        value="1000",
        data=bytes.fromhex("a9059cbb"),
        nonce=7,
    )
    assert evm_auth_sign_bytes(**args).hex() == (
        "c2614c477a15020777adb1e889748557debc6dece7207ded95d30ee6d7bd778a"
    )
    assert evm_auth_sign_bytes_v2(**args, gas_limit=250000).hex() == (
        "19d7518ad25079dff616819b7554d7d39700fb9e4331a6cbc635685122f0c18b"
    )
    with pytest.raises(ValueError, match="gas_limit"):
        evm_auth_sign_bytes_v2(**args, gas_limit=0)


def test_digest_version_follows_v323() -> None:
    clear_upgrade_cache()
    assert evm_auth_digest_version(FakeRest({"height": "0"})) == "v1"
    assert evm_auth_digest_version(FakeRest({"height": "8003746"})) == "v2"
    assert CHAIN_UPGRADE_V3_2_3 == "v3.2.3"


@pytest.mark.parametrize(
    ("code", "kind"),
    [
        (230, "pqc_key_weak"),
        (231, "pqc_proof_of_possession_invalid"),
        (232, "pqc_key_reused"),
        (233, "pqc_last_signature_algorithm"),
        (234, "pqc_maintenance_needs_hybrid"),
    ],
)
def test_decode_v323_codes(code: int, kind: str) -> None:
    assert decode_tx_error(code, "pqc").kind == kind


def test_update_authority_registered() -> None:
    assert "/qorechain.license.v1.MsgUpdateAuthority" in QORECHAIN_REGISTRY_TYPES
    m = msg.license.update_authority(authority="qor1gov", new_authority="qor1new")
    assert m.type_url == "/qorechain.license.v1.MsgUpdateAuthority"
