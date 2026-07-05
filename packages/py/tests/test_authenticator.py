"""Tests for the v3.1.85 authenticator lanes and PQC key rotation.

Covers the BYTE-EXACT sign-bytes KATs (shared with the TS SDK / wallet-adapter),
the three message composers (type URLs + Any round-trip), the abstractaccount
PermissionSchema query, the new error codes, and the mnemonic-driven dual-signed
rotation builder.
"""

from __future__ import annotations

import pytest
from cosmpy.protos.cosmos.base.v1beta1.coin_pb2 import Coin

from qorsdk import (
    cosmos_auth_sign_bytes,
    decode_tx_error,
    derive_pqc_legacy,
    evm_auth_sign_bytes,
    execute_cosmos_msg,
    execute_evm_msg,
    rotate_pqc_key_msg,
    rotate_pqc_key_msg_from_mnemonic,
    rotation_sign_bytes,
)
from qorsdk.authenticator import be64, lp
from qorsdk.messages import decode_any, msg, qorechain_registry
from qorsdk.pqc import ALGORITHM_DILITHIUM5, pqc_verify
from qorsdk.proto.qorechain.abstractaccount.v1 import tx_pb2 as aa_tx

# The KAT authenticator pubkey: 32 bytes of 0x01.
KAT_PUBKEY = bytes([0x01]) * 32


# --------------------------------------------------------------------------- #
# byte helpers
# --------------------------------------------------------------------------- #


def test_be64_big_endian():
    assert be64(0) == bytes(8)
    assert be64(1) == b"\x00\x00\x00\x00\x00\x00\x00\x01"
    assert be64(258) == b"\x00\x00\x00\x00\x00\x00\x01\x02"


def test_lp_length_prefix():
    assert lp(b"") == bytes(8)
    assert lp(b"ab") == b"\x00\x00\x00\x00\x00\x00\x00\x02ab"


# --------------------------------------------------------------------------- #
# sign-bytes KATs (must match the TS SDK / wallet-adapter byte-for-byte)
# --------------------------------------------------------------------------- #


def test_evm_auth_sign_bytes_kat():
    digest = evm_auth_sign_bytes(
        chain_id="qorechain-diana",
        account="qor1test",
        pubkey=KAT_PUBKEY,
        to="0xabc",
        value="1000",
        data=bytes([2, 2, 2]),
        nonce=5,
    )
    assert len(digest) == 32
    assert digest.hex() == (
        "8661921e6d37dff44e97d4a05d4efbfd3fd8ea631201479c2bbf1cb41ade7025"
    )


def test_cosmos_auth_sign_bytes_kat():
    digest = cosmos_auth_sign_bytes(
        chain_id="qorechain-diana",
        account="qor1test",
        pubkey=KAT_PUBKEY,
        to="qor1recv",
        amount="100uqor",
        nonce=3,
    )
    assert len(digest) == 32
    assert digest.hex() == (
        "5e203ef47b5fe63d0fc9c8909aecb124b32b173f8b96700003ba1d8fa0114f0f"
    )


def test_rotation_sign_bytes_kat():
    out = rotation_sign_bytes(
        "qorechain-diana", 1, "qor1test", bytes([0xAA, 0xAA]), bytes([0xBB, 0xBB])
    )
    assert out == "qorechain-pqc-rotate-v1|qorechain-diana|1|qor1test|aaaa|bbbb"


def test_evm_auth_sign_bytes_defaults_stable():
    # Empty to/data + default value/nonce still produce a stable 32-byte digest.
    digest = evm_auth_sign_bytes(chain_id="qorechain-diana", account="qor1x", pubkey=KAT_PUBKEY)
    assert len(digest) == 32
    # to/value/data/nonce defaults are "", "0", b"", 0 respectively.
    explicit = evm_auth_sign_bytes(
        chain_id="qorechain-diana",
        account="qor1x",
        pubkey=KAT_PUBKEY,
        to="",
        value="0",
        data=b"",
        nonce=0,
    )
    assert digest == explicit


# --------------------------------------------------------------------------- #
# composers: type URLs + Any round-trip
# --------------------------------------------------------------------------- #


def test_execute_evm_msg_type_url_and_fields():
    m = execute_evm_msg(
        relayer="qor1relayer",
        account="qor1acct",
        scheme="ed25519",
        pubkey=KAT_PUBKEY,
        signature=b"sig",
        to="0xabc",
        value="1000",
        data=bytes([2, 2, 2]),
        gas_limit=100000,
        nonce=5,
    )
    assert m.type_url == "/qorechain.abstractaccount.v1.MsgExecuteEVM"
    assert isinstance(m.value, aa_tx.MsgExecuteEVM)
    assert m.value.relayer == "qor1relayer"
    assert m.value.account == "qor1acct"
    assert m.value.scheme == "ed25519"
    assert m.value.pubkey == KAT_PUBKEY
    assert m.value.to == "0xabc"
    assert m.value.value == "1000"
    assert m.value.data == bytes([2, 2, 2])
    assert m.value.gas_limit == 100000
    assert m.value.nonce == 5

    # Any round-trip through the registry.
    decoded = decode_any(m.type_url, m.value.SerializeToString(), qorechain_registry())
    assert isinstance(decoded, aa_tx.MsgExecuteEVM)
    assert decoded.nonce == 5
    assert decoded.pubkey == KAT_PUBKEY


def test_execute_cosmos_msg_parses_coins_and_round_trips():
    m = execute_cosmos_msg(
        relayer="qor1relayer",
        account="qor1acct",
        scheme="secp256k1",
        pubkey=KAT_PUBKEY,
        signature=b"sig",
        to="qor1recv",
        amount="100uqor",
        nonce=3,
    )
    assert m.type_url == "/qorechain.abstractaccount.v1.MsgExecuteCosmos"
    assert list(m.value.amount) == [Coin(denom="uqor", amount="100")]
    assert m.value.to == "qor1recv"
    assert m.value.nonce == 3

    decoded = decode_any(m.type_url, m.value.SerializeToString(), qorechain_registry())
    assert isinstance(decoded, aa_tx.MsgExecuteCosmos)
    assert list(decoded.amount) == [Coin(denom="uqor", amount="100")]


def test_execute_cosmos_msg_rejects_bad_amount():
    with pytest.raises(ValueError, match="invalid amount"):
        execute_cosmos_msg(
            relayer="qor1relayer",
            account="qor1acct",
            scheme="ed25519",
            pubkey=KAT_PUBKEY,
            signature=b"sig",
            to="qor1recv",
            amount="notacoin",
            nonce=1,
        )


def test_rotate_pqc_key_msg_type_url_and_round_trip():
    m = rotate_pqc_key_msg(
        sender="qor1acct",
        old_public_key=b"old",
        new_public_key=b"new",
        old_signature=b"osig",
        new_signature=b"nsig",
    )
    assert m.type_url == "/qorechain.pqc.v1.MsgRotatePQCKey"
    decoded = decode_any(m.type_url, m.value.SerializeToString(), qorechain_registry())
    assert decoded.sender == "qor1acct"
    assert decoded.old_public_key == b"old"
    assert decoded.new_public_key == b"new"


def test_composers_registered_in_msg_namespace_and_registry():
    reg = qorechain_registry()
    assert "/qorechain.abstractaccount.v1.MsgExecuteEVM" in reg
    assert "/qorechain.abstractaccount.v1.MsgExecuteCosmos" in reg
    assert "/qorechain.pqc.v1.MsgRotatePQCKey" in reg
    # msg.* namespace exposes the generic composers too.
    m_evm = msg.abstractaccount.execute_evm(
        relayer="qor1r", account="qor1a", scheme="ed25519", pubkey=KAT_PUBKEY,
        signature=b"s", to="0x0", value="0", data=b"", gas_limit=1, nonce=0,
    )
    assert m_evm.type_url == "/qorechain.abstractaccount.v1.MsgExecuteEVM"
    m_rot = msg.pqc.rotate_pqc_key(
        sender="qor1a", old_public_key=b"o", new_public_key=b"n",
        old_signature=b"os", new_signature=b"ns",
    )
    assert m_rot.type_url == "/qorechain.pqc.v1.MsgRotatePQCKey"


# --------------------------------------------------------------------------- #
# PermissionSchema query (mocked channel)
# --------------------------------------------------------------------------- #


def test_permission_schema_query_routes_and_decodes():
    from qorsdk import connect_query_clients
    from qorsdk.proto.qorechain.abstractaccount.v1 import query_pb2 as aa_q

    resp = aa_q.QueryPermissionSchemaResponse(
        schema_version="v3.1.85",
        permissions=["send", "evm", "svm", "all"],
        msg_permissions={"/qorechain.abstractaccount.v1.MsgExecuteEVM": "evm"},
        key_management_msgs=["/qorechain.pqc.v1.MsgRotatePQCKey"],
    )

    class FakeMultiCallable:
        def __init__(self, deser, payload):
            self._deser = deser
            self._payload = payload
            self.last_request = None

        def __call__(self, request):
            self.last_request = request
            return self._deser(self._payload)

    class FakeChannel:
        def __init__(self, responses):
            self._responses = responses
            self.calls: dict[str, FakeMultiCallable] = {}

        def unary_unary(self, method, request_serializer, response_deserializer):
            mc = FakeMultiCallable(response_deserializer, self._responses.get(method, b""))
            self.calls[method] = mc
            return mc

        def close(self):  # pragma: no cover - trivial
            pass

    method = "/qorechain.abstractaccount.v1.Query/PermissionSchema"
    channel = FakeChannel({method: resp.SerializeToString()})
    clients = connect_query_clients("localhost:9090", channel=channel)
    out = clients.abstractaccount.permission_schema()
    mc = channel.calls[method]
    assert isinstance(mc.last_request, aa_q.QueryPermissionSchemaRequest)
    assert isinstance(out, aa_q.QueryPermissionSchemaResponse)
    assert out.schema_version == "v3.1.85"
    assert "evm" in out.permissions
    assert out.msg_permissions["/qorechain.abstractaccount.v1.MsgExecuteEVM"] == "evm"
    assert "/qorechain.pqc.v1.MsgRotatePQCKey" in out.key_management_msgs


# --------------------------------------------------------------------------- #
# error-code decoding (abstractaccount + pqc codespaces)
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    ("codespace", "code", "kind"),
    [
        ("abstractaccount", 5, "spending_limit_exceeded"),
        ("abstractaccount", 6, "session_key_expired"),
        ("abstractaccount", 10, "permission_denied"),
        ("abstractaccount", 11, "authenticator_replay"),
        ("pqc", 21, "hybrid_verify_failed"),
    ],
)
def test_module_error_codes_decode(codespace, code, kind):
    decoded = decode_tx_error(code, codespace=codespace, raw_log="boom")
    assert decoded.codespace == codespace
    assert decoded.code == code
    assert decoded.kind == kind
    assert "boom" in decoded.message


def test_unmapped_module_code_falls_back_to_raw_log():
    decoded = decode_tx_error(99, codespace="abstractaccount", raw_log="weird")
    assert decoded.kind == "abstractaccount_99"
    assert "weird" in decoded.message


# --------------------------------------------------------------------------- #
# mnemonic-driven dual-signed rotation
# --------------------------------------------------------------------------- #


def test_rotate_pqc_key_msg_from_mnemonic_dual_signs():
    account = "qor1test"
    mnemonic = "test test test test test test test test test test test junk"
    chain_id = "qorechain-diana"

    built = rotate_pqc_key_msg_from_mnemonic(
        account=account, mnemonic=mnemonic, chain_id=chain_id
    )
    m = built.msg
    assert m.type_url == "/qorechain.pqc.v1.MsgRotatePQCKey"

    # Old = legacy shake256(mnemonic); matches derive_pqc_legacy.
    legacy = derive_pqc_legacy(mnemonic)
    assert built.old_keypair.public_key == legacy.public_key
    # New != old (not a no-op).
    assert built.new_keypair.public_key != built.old_keypair.public_key

    # The message carries the derived public keys.
    assert m.value.old_public_key == built.old_keypair.public_key
    assert m.value.new_public_key == built.new_keypair.public_key

    # Both signatures verify against the shared domain-separated rotation bytes.
    sb = rotation_sign_bytes(
        chain_id, ALGORITHM_DILITHIUM5, account,
        built.old_keypair.public_key, built.new_keypair.public_key,
    ).encode("utf-8")
    assert pqc_verify(built.old_keypair.public_key, sb, m.value.old_signature)
    assert pqc_verify(built.new_keypair.public_key, sb, m.value.new_signature)


def test_rotate_pqc_key_msg_from_mnemonic_rejects_noop():
    with pytest.raises(ValueError, match="no-op"):
        rotate_pqc_key_msg_from_mnemonic(
            account="qor1test",
            mnemonic="test test test test test test test test test test test junk",
            chain_id="qorechain-diana",
            old_derivation="adapter",
            new_derivation="adapter",
        )


def test_rotate_pqc_key_msg_from_mnemonic_rejects_unknown_derivation():
    with pytest.raises(ValueError, match="unknown derivation"):
        rotate_pqc_key_msg_from_mnemonic(
            account="qor1test",
            mnemonic="test test test test test test test test test test test junk",
            chain_id="qorechain-diana",
            old_derivation="nope",
        )
