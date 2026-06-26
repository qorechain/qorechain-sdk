"""Tests for native transaction building, broadcast, and hybrid PQC signing.

The network is always mocked: broadcasting against a live node is out of scope
for unit tests, so :func:`broadcast` is exercised with a stubbed HTTP POST and
the hybrid build is asserted purely on its local byte-for-byte contract.
"""

from __future__ import annotations

import base64
import hashlib
import json

import pytest
from cosmpy.protos.cosmos.bank.v1beta1.tx_pb2 import MsgSend
from cosmpy.protos.cosmos.tx.v1beta1.tx_pb2 import SignDoc, TxBody, TxRaw

from qorsdk import (
    ALGORITHM_DILITHIUM5,
    HYBRID_SIG_TYPE_URL,
    ML_DSA_87_SIGNATURE_LENGTH,
    build_hybrid_tx,
    derive_native_account,
    generate_pqc_keypair,
    pqc_verify,
)
from qorsdk.tx import MSG_SEND_TYPE_URL, bank_send, broadcast

# Public test mnemonic only — never a real one.
TEST_MNEMONIC = (
    "abandon abandon abandon abandon abandon abandon abandon abandon "
    "abandon abandon abandon about"
)
CHAIN_ID = "qorechain-diana"
FEE = {"amount": [{"denom": "uqor", "amount": "5000"}], "gas": "200000"}


def _be32(n: int) -> bytes:
    return n.to_bytes(4, "big")


@pytest.fixture
def native():
    return derive_native_account(TEST_MNEMONIC)


@pytest.fixture
def pqc():
    return generate_pqc_keypair()


# --------------------------------------------------------------------------- #
# bank_send
# --------------------------------------------------------------------------- #
def test_bank_send_builds_msgsend_and_signs(native):
    recipient = "qor1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqp0z7dl"
    amount = [{"denom": "uqor", "amount": "1000"}]
    built = bank_send(
        account=native,
        to_address=recipient,
        amount=amount,
        chain_id=CHAIN_ID,
        account_number=7,
        sequence=3,
        fee=FEE,
        memo="hi",
    )

    # The body carries exactly one MsgSend with the correct from/to/amount.
    body = TxBody()
    body.ParseFromString(built.tx_raw.body_bytes)
    assert len(body.messages) == 1
    assert body.messages[0].type_url == MSG_SEND_TYPE_URL
    assert body.memo == "hi"
    msg = MsgSend()
    msg.ParseFromString(body.messages[0].value)
    assert msg.from_address == native.address
    assert msg.to_address == recipient
    assert list(msg.amount)[0].denom == "uqor"
    assert list(msg.amount)[0].amount == "1000"

    # A signed TxRaw with a single 64-byte classical signature, round-trippable.
    assert len(built.tx_raw.signatures) == 1
    assert len(built.tx_raw.signatures[0]) == 64
    decoded = TxRaw()
    decoded.ParseFromString(built.tx_raw_bytes)
    assert decoded.body_bytes == built.tx_raw.body_bytes
    assert decoded.auth_info_bytes == built.auth_info_bytes


def test_bank_send_classical_signature_over_signdoc(native):
    built = bank_send(
        account=native,
        to_address=native.address,
        amount=[{"denom": "uqor", "amount": "1"}],
        chain_id=CHAIN_ID,
        account_number=7,
        sequence=3,
        fee=FEE,
    )
    # Reconstruct the SignDoc and verify the secp256k1 signature.
    sign_doc = SignDoc(
        body_bytes=built.tx_raw.body_bytes,
        auth_info_bytes=built.auth_info_bytes,
        chain_id=CHAIN_ID,
        account_number=7,
    )
    from ecdsa import VerifyingKey
    from ecdsa.curves import SECP256k1
    from ecdsa.util import sigdecode_string

    vk = VerifyingKey.from_string(
        _decompress(native.public_key), curve=SECP256k1, hashfunc=hashlib.sha256
    )
    assert vk.verify(
        built.tx_raw.signatures[0],
        sign_doc.SerializeToString(),
        hashfunc=hashlib.sha256,
        sigdecode=sigdecode_string,
    )


def _decompress(compressed: bytes) -> bytes:
    """Decompress a 33-byte secp256k1 pubkey to the 64-byte X||Y form ecdsa wants."""
    from ecdsa import VerifyingKey
    from ecdsa.curves import SECP256k1

    vk = VerifyingKey.from_string(compressed, curve=SECP256k1)
    return vk.to_string()


# --------------------------------------------------------------------------- #
# broadcast (mocked HTTP POST)
# --------------------------------------------------------------------------- #
def test_broadcast_posts_to_rest_endpoint():
    import httpx
    import respx

    base = "https://rest.example"
    with respx.mock:
        route = respx.post(f"{base}/cosmos/tx/v1beta1/txs").mock(
            return_value=httpx.Response(
                200, json={"tx_response": {"code": 0, "txhash": "AB"}}
            )
        )
        tx_bytes = b"\x01\x02\x03"
        res = broadcast(base, tx_bytes, mode="sync")
        assert route.called
        sent = json.loads(route.calls[0].request.content)
        assert sent["mode"] == "BROADCAST_MODE_SYNC"
        assert sent["tx_bytes"] == base64.b64encode(tx_bytes).decode("ascii")
        assert res["tx_response"]["txhash"] == "AB"


@pytest.mark.parametrize(
    "mode,expected",
    [
        ("sync", "BROADCAST_MODE_SYNC"),
        ("async", "BROADCAST_MODE_ASYNC"),
        ("block", "BROADCAST_MODE_BLOCK"),
    ],
)
def test_broadcast_mode_mapping(mode, expected):
    import httpx
    import respx

    base = "https://rest.example"
    with respx.mock:
        route = respx.post(f"{base}/cosmos/tx/v1beta1/txs").mock(
            return_value=httpx.Response(200, json={"tx_response": {"code": 0}})
        )
        broadcast(base, b"\x00", mode=mode)
        sent = json.loads(route.calls[0].request.content)
        assert sent["mode"] == expected


# --------------------------------------------------------------------------- #
# Hybrid PQC tx — the core invariants, mirroring the TS/Go contract.
# --------------------------------------------------------------------------- #
def test_hybrid_pqc_message_is_over_b0_not_final_body(native, pqc):
    """The PQC signed message must cover B0 (body WITHOUT the ext), framed with A."""
    built = build_hybrid_tx(
        account=native,
        pqc_keypair=pqc,
        messages=[_msg(native)],
        fee=FEE,
        chain_id=CHAIN_ID,
        account_number=7,
        sequence=3,
        memo="hi",
    )

    # Independently: decode the final body, strip the PQC ext, re-encode, re-frame.
    final_body = TxBody()
    final_body.ParseFromString(built.tx_raw.body_bytes)
    assert len(final_body.extension_options) == 1

    stripped = TxBody()
    stripped.CopyFrom(final_body)
    del stripped.extension_options[:]
    b0 = stripped.SerializeToString()
    a = built.auth_info_bytes
    expected = _be32(len(b0)) + b0 + _be32(len(a)) + a
    assert built.pqc_signed_message == expected

    # It must NOT be a framing over the with-ext (final) body.
    final_bytes = built.tx_raw.body_bytes
    wrong = _be32(len(final_bytes)) + final_bytes + _be32(len(a)) + a
    assert built.pqc_signed_message != wrong


def test_hybrid_pqc_signature_size_and_verifies(native, pqc):
    built = build_hybrid_tx(
        account=native,
        pqc_keypair=pqc,
        messages=[_msg(native)],
        fee=FEE,
        chain_id=CHAIN_ID,
        account_number=0,
        sequence=0,
    )
    assert len(built.pqc_signature) == ML_DSA_87_SIGNATURE_LENGTH
    assert pqc_verify(pqc.public_key, built.pqc_signed_message, built.pqc_signature)


def test_hybrid_extension_any_shape(native, pqc):
    built = build_hybrid_tx(
        account=native,
        pqc_keypair=pqc,
        messages=[_msg(native)],
        fee=FEE,
        chain_id=CHAIN_ID,
        account_number=0,
        sequence=0,
    )
    body = TxBody()
    body.ParseFromString(built.tx_raw.body_bytes)
    assert len(body.extension_options) == 1
    assert len(body.non_critical_extension_options) == 0
    ext = body.extension_options[0]
    assert ext.type_url == HYBRID_SIG_TYPE_URL

    decoded = json.loads(ext.value.decode("utf-8"))
    assert decoded["algorithm_id"] == ALGORITHM_DILITHIUM5
    # Standard padded base64 of the 4627-byte signature.
    expected_sig = base64.b64encode(built.pqc_signature).decode("ascii")
    assert decoded["pqc_signature"] == expected_sig
    assert len(expected_sig) % 4 == 0
    # No public key by default (omitempty contract).
    assert "pqc_public_key" not in decoded


def test_hybrid_includes_public_key_when_requested(native, pqc):
    built = build_hybrid_tx(
        account=native,
        pqc_keypair=pqc,
        messages=[_msg(native)],
        fee=FEE,
        chain_id=CHAIN_ID,
        account_number=0,
        sequence=0,
        include_pqc_public_key=True,
    )
    body = TxBody()
    body.ParseFromString(built.tx_raw.body_bytes)
    decoded = json.loads(body.extension_options[0].value.decode("utf-8"))
    assert decoded["pqc_public_key"] == base64.b64encode(pqc.public_key).decode("ascii")


def test_hybrid_classical_signature_in_txraw_over_final_body(native, pqc):
    built = build_hybrid_tx(
        account=native,
        pqc_keypair=pqc,
        messages=[_msg(native)],
        fee=FEE,
        chain_id=CHAIN_ID,
        account_number=7,
        sequence=3,
    )
    assert len(built.tx_raw.signatures) == 1
    assert len(built.tx_raw.signatures[0]) == 64

    from ecdsa import VerifyingKey
    from ecdsa.curves import SECP256k1
    from ecdsa.util import sigdecode_string

    sign_doc = SignDoc(
        body_bytes=built.tx_raw.body_bytes,
        auth_info_bytes=built.auth_info_bytes,
        chain_id=CHAIN_ID,
        account_number=7,
    )
    vk = VerifyingKey.from_string(
        _decompress(native.public_key), curve=SECP256k1, hashfunc=hashlib.sha256
    )
    assert vk.verify(
        built.tx_raw.signatures[0],
        sign_doc.SerializeToString(),
        hashfunc=hashlib.sha256,
        sigdecode=sigdecode_string,
    )


def _msg(account):
    return {
        "type_url": MSG_SEND_TYPE_URL,
        "value": MsgSend(
            from_address=account.address,
            to_address=account.address,
            amount=[{"denom": "uqor", "amount": "1000"}],
        ),
    }
