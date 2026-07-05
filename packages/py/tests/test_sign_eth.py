"""Tests for eth-native (``eth_secp256k1``) Native-lane signing.

Verifies the two things that differ from standard Native signing: the classical
signature is secp256k1 over ``keccak256(SignDoc)`` (NOT sha256), and the signer
pubkey ``Any`` uses the ``/cosmos.evm.crypto.v1.ethsecp256k1.PubKey`` type URL.
Also asserts the hybrid B0 framing excludes the PQC extension.
"""

from __future__ import annotations

import hashlib

import pytest
from cosmpy.protos.cosmos.bank.v1beta1.tx_pb2 import MsgSend
from cosmpy.protos.cosmos.base.v1beta1.coin_pb2 import Coin
from cosmpy.protos.cosmos.tx.v1beta1.tx_pb2 import AuthInfo, SignDoc, TxBody, TxRaw
from ecdsa import SECP256k1, VerifyingKey
from ecdsa.util import sigdecode_string
from google.protobuf.any_pb2 import Any as ProtoAny

from qorsdk import (
    ETHSECP256K1_PUBKEY_TYPE,
    MSG_SEND_TYPE_URL,
    parse_eth_account_pubkey,
    sign_classical_eth,
    sign_hybrid_eth,
    unified_account_from_seed,
)
from qorsdk.proto.qorechain.pqc.v1.hybrid_pb2 import PQCHybridSignature
from qorsdk.utils.hash import keccak256

CHAIN_ID = "qorechain-vladi"
ACCOUNT_NUMBER = 7
SEQUENCE = 3
FEE = {"amount": [{"denom": "uqor", "amount": "200"}], "gas": "100000"}


def _account():
    return unified_account_from_seed(bytes([1]) * 32)


def _msg(acct):
    return {
        "type_url": MSG_SEND_TYPE_URL,
        "value": MsgSend(
            from_address=acct.cosmos,
            to_address=acct.cosmos,
            amount=[Coin(denom="uqor", amount="1000")],
        ),
    }


def _verifies_over_keccak(tx_raw_bytes: bytes, pubkey: bytes) -> bool:
    tr = TxRaw()
    tr.ParseFromString(tx_raw_bytes)
    sd = SignDoc(
        body_bytes=tr.body_bytes,
        auth_info_bytes=tr.auth_info_bytes,
        chain_id=CHAIN_ID,
        account_number=ACCOUNT_NUMBER,
    )
    digest = keccak256(sd.SerializeToString())
    vk = VerifyingKey.from_string(pubkey, curve=SECP256k1)
    return bool(vk.verify_digest(tr.signatures[0], digest, sigdecode=sigdecode_string))


def test_classical_signature_verifies_over_keccak_signbytes():
    acct = _account()
    built = sign_classical_eth(
        acct, CHAIN_ID, ACCOUNT_NUMBER, [_msg(acct)], FEE, SEQUENCE
    )
    assert _verifies_over_keccak(built.tx_raw_bytes, acct.public_key)
    # classical-only: no PQC artifacts.
    assert built.pqc_signature == b""
    assert built.pqc_signed_message == b""


def test_classical_signature_is_not_over_sha256():
    acct = _account()
    built = sign_classical_eth(
        acct, CHAIN_ID, ACCOUNT_NUMBER, [_msg(acct)], FEE, SEQUENCE
    )
    tr = TxRaw()
    tr.ParseFromString(built.tx_raw_bytes)
    sd = SignDoc(
        body_bytes=tr.body_bytes,
        auth_info_bytes=tr.auth_info_bytes,
        chain_id=CHAIN_ID,
        account_number=ACCOUNT_NUMBER,
    )
    sha = hashlib.sha256(sd.SerializeToString()).digest()
    vk = VerifyingKey.from_string(acct.public_key, curve=SECP256k1)
    # The eth_secp256k1 sig must NOT verify against the sha256 digest (keccak-only).
    import ecdsa

    with pytest.raises(ecdsa.keys.BadSignatureError):
        vk.verify_digest(tr.signatures[0], sha, sigdecode=sigdecode_string)


def test_signer_pubkey_uses_ethsecp256k1_type_url():
    acct = _account()
    built = sign_classical_eth(
        acct, CHAIN_ID, ACCOUNT_NUMBER, [_msg(acct)], FEE, SEQUENCE
    )
    ai = AuthInfo()
    ai.ParseFromString(built.auth_info_bytes)
    pk_any = ai.signer_infos[0].public_key
    assert pk_any.type_url == ETHSECP256K1_PUBKEY_TYPE
    # value decodes as a standard secp256k1 PubKey → same compressed key.
    assert parse_eth_account_pubkey(pk_any) == acct.public_key


def test_hybrid_signature_verifies_and_body_carries_extension():
    acct = _account()
    built = sign_hybrid_eth(
        acct, CHAIN_ID, ACCOUNT_NUMBER, [_msg(acct)], FEE, SEQUENCE
    )
    # classical over keccak(final body incl. ext).
    assert _verifies_over_keccak(built.tx_raw_bytes, acct.public_key)
    # final body carries exactly one extension option.
    body = TxBody()
    body.ParseFromString(built.tx_raw.body_bytes)
    assert len(body.extension_options) == 1
    assert len(built.pqc_signature) == 4627  # ML-DSA-87

    # The extension value is PROTOBUF (leading 0x08), not the Go-JSON (0x7b)
    # that the chain rejects at CheckTx. Round-trips through the generated codec.
    ext_value = body.extension_options[0].value
    assert ext_value[0] == 0x08
    assert ext_value[0] != 0x7B
    decoded = PQCHybridSignature.FromString(ext_value)
    assert decoded.algorithm_id == 1  # Dilithium-5
    assert decoded.pqc_signature == built.pqc_signature


def test_hybrid_b0_frame_excludes_extension():
    acct = _account()
    built = sign_hybrid_eth(
        acct, CHAIN_ID, ACCOUNT_NUMBER, [_msg(acct)], FEE, SEQUENCE
    )
    # Reconstruct B0 (body WITHOUT ext) and the expected BE32 frame.
    msg = _msg(acct)["value"]
    b0 = TxBody(
        messages=[ProtoAny(type_url=MSG_SEND_TYPE_URL, value=msg.SerializeToString())]
    ).SerializeToString()
    frame = (
        len(b0).to_bytes(4, "big")
        + b0
        + len(built.auth_info_bytes).to_bytes(4, "big")
        + built.auth_info_bytes
    )
    assert frame == built.pqc_signed_message
    # And B0 differs from the final (ext-carrying) body.
    assert b0 != built.tx_raw.body_bytes


def test_parse_eth_account_pubkey_rejects_wrong_type():
    from cosmpy.protos.cosmos.crypto.secp256k1.keys_pb2 import PubKey as SecpPubKey

    wrong = ProtoAny(
        type_url="/cosmos.crypto.secp256k1.PubKey",
        value=SecpPubKey(key=b"\x02" * 33).SerializeToString(),
    )
    with pytest.raises(ValueError):
        parse_eth_account_pubkey(wrong)


def test_parse_eth_account_pubkey_accepts_dict():
    from cosmpy.protos.cosmos.crypto.secp256k1.keys_pb2 import PubKey as SecpPubKey

    key = b"\x03" * 33
    d = {
        "type_url": ETHSECP256K1_PUBKEY_TYPE,
        "value": SecpPubKey(key=key).SerializeToString(),
    }
    assert parse_eth_account_pubkey(d) == key
