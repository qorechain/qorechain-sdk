"""eth-native (``eth_secp256k1``) Native-lane signing for QoreChain.

A QoreChain account created eth-native (address = ``keccak(pubkey)[12:]``, see
:mod:`qorsdk.unified`) signs Native-lane txs with the ``eth_secp256k1`` scheme:
the classical signature is secp256k1 over the **KECCAK-256** of the ``SignDoc``
(NOT sha256), and the account's pubkey ``Any`` uses the type URL
``/cosmos.evm.crypto.v1.ethsecp256k1.PubKey`` (wire shape identical to the
standard secp256k1 ``PubKey`` — ``{key: compressed}`` — only the ``typeUrl``
differs). This is the SAME account that spends on the EVM lane, so its
``qor1``/``0x``/svm forms are one identity.

Mainnet requires the ML-DSA-87 hybrid extension in the tx body:
:func:`sign_hybrid_eth` adds it (reusing the exact hybrid framing / extension
encoding from :mod:`qorsdk.tx`). :func:`sign_classical_eth` omits it — used for
the one-time PQC key registration, which is bootstrap-exempt from the hybrid
requirement.

This mirrors ``@qorechain/wallet-adapter`` (``sign-eth.js``) but is reimplemented
natively here. Only two things change relative to the standard Native signing in
:mod:`qorsdk.tx`: the classical hash (keccak, not sha256) and the pubkey
``typeUrl``.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from cosmpy.protos.cosmos.crypto.secp256k1.keys_pb2 import PubKey as Secp256k1PubKey
from cosmpy.protos.cosmos.tx.signing.v1beta1.signing_pb2 import SignMode
from cosmpy.protos.cosmos.tx.v1beta1.tx_pb2 import (
    AuthInfo,
    ModeInfo,
    SignDoc,
    SignerInfo,
    TxBody,
    TxRaw,
)
from ecdsa import SECP256k1, SigningKey
from ecdsa.util import sigencode_string_canonize
from google.protobuf.any_pb2 import Any as ProtoAny

from .pqc import (
    ALGORITHM_DILITHIUM5,
    HYBRID_SIG_TYPE_URL,
    build_hybrid_signature_extension,
    pqc_sign,
)
from .tx import BuiltTx, FeeDict, _encode_message, _fee_to_proto
from .unified import UnifiedAccount
from .utils.hash import keccak256

#: cosmos/evm ``eth_secp256k1`` pubkey type URL. Wire shape is identical to the
#: cosmos secp256k1 ``PubKey`` (``{1: bytes key}``); only the type URL differs.
ETHSECP256K1_PUBKEY_TYPE = "/cosmos.evm.crypto.v1.ethsecp256k1.PubKey"


def _be32(n: int) -> bytes:
    return n.to_bytes(4, "big")


def _eth_pubkey_any(compressed_pubkey: bytes) -> ProtoAny:
    """Pack a compressed secp256k1 pubkey into an ``eth_secp256k1`` ``Any``.

    The value bytes are the standard secp256k1 ``PubKey`` proto (``{key}``); only
    the ``type_url`` is the eth_secp256k1 one, matching how the chain's ante
    handler resolves the eth-native signer.
    """
    return ProtoAny(
        type_url=ETHSECP256K1_PUBKEY_TYPE,
        value=Secp256k1PubKey(key=compressed_pubkey).SerializeToString(),
    )


def _build_eth_auth_info_bytes(
    compressed_pubkey: bytes, sequence: int, fee: FeeDict
) -> bytes:
    """Single-signer SIGN_MODE_DIRECT ``AuthInfo`` with the eth_secp256k1 pubkey."""
    signer_info = SignerInfo(
        public_key=_eth_pubkey_any(compressed_pubkey),
        mode_info=ModeInfo(single=ModeInfo.Single(mode=SignMode.SIGN_MODE_DIRECT)),
        sequence=int(sequence),
    )
    auth_info = AuthInfo(signer_infos=[signer_info], fee=_fee_to_proto(fee))
    serialized: bytes = auth_info.SerializeToString()
    return serialized


def _eth_sign(sign_bytes: bytes, private_key: bytes) -> bytes:
    """eth_secp256k1 classical signature over a ``SignDoc``.

    secp256k1 sign of ``keccak256(sign_bytes)``, serialized as the 64-byte
    ``r‖s`` low-s (canonical) encoding. Deterministic (RFC 6979).
    """
    digest = keccak256(sign_bytes)
    sk = SigningKey.from_string(private_key, curve=SECP256k1)
    signature: bytes = sk.sign_digest_deterministic(
        digest, hashfunc=hashlib.sha256, sigencode=sigencode_string_canonize
    )
    return signature


def sign_classical_eth(
    account: UnifiedAccount,
    chain_id: str,
    account_number: int,
    messages: list[object],
    fee: FeeDict,
    sequence: int,
    memo: str = "",
    timeout_height: int = 0,
) -> BuiltTx:
    """Classical-only ``eth_secp256k1`` Native tx (no PQC extension).

    Use for the one-time ``MsgRegisterPQCKeyV2`` (bootstrap-exempt from the
    hybrid requirement). Signs ``keccak256(SignDoc)`` with the account's
    secp256k1 key and encodes the signer pubkey as ``eth_secp256k1``.

    :param account: A :class:`~qorsdk.unified.UnifiedAccount`.
    :param messages: ``Msg`` objects or ``{"type_url", "value"}`` dicts.
    :returns: A :class:`~qorsdk.tx.BuiltTx` (PQC fields empty).
    """
    encoded = [_encode_message(m) for m in messages]
    body_bytes = TxBody(
        messages=encoded, memo=memo, timeout_height=int(timeout_height)
    ).SerializeToString()
    auth_info_bytes = _build_eth_auth_info_bytes(account.public_key, sequence, fee)
    sign_doc = SignDoc(
        body_bytes=body_bytes,
        auth_info_bytes=auth_info_bytes,
        chain_id=chain_id,
        account_number=int(account_number),
    )
    classical = _eth_sign(sign_doc.SerializeToString(), account.private_key)
    tx_raw = TxRaw(
        body_bytes=body_bytes, auth_info_bytes=auth_info_bytes, signatures=[classical]
    )
    return BuiltTx(
        tx_raw=tx_raw,
        tx_raw_bytes=tx_raw.SerializeToString(),
        auth_info_bytes=auth_info_bytes,
    )


def sign_hybrid_eth(
    account: UnifiedAccount,
    chain_id: str,
    account_number: int,
    messages: list[object],
    fee: FeeDict,
    sequence: int,
    memo: str = "",
    timeout_height: int = 0,
    include_pqc_public_key: bool = False,
) -> BuiltTx:
    """Hybrid ``eth_secp256k1`` + ML-DSA-87 Native tx.

    Follows the chain contract identically to :func:`qorsdk.tx.build_hybrid_tx`,
    with two eth-native differences: the classical signature is secp256k1 over
    ``keccak256(SignDoc)`` and the signer pubkey ``Any`` is ``eth_secp256k1``.

    Build sequence:

    1. ``B0`` — the ``TxBody`` WITHOUT the PQC extension.
    2. ``A``  — the single-signer SIGN_MODE_DIRECT ``AuthInfo`` (eth pubkey).
    3. ``pqc_sig = mldsa_sign(secret, frame(B0, A))`` where
       ``frame = BE32(len B0) ‖ B0 ‖ BE32(len A) ‖ A``.
    4. Attach the ``PQCHybridSignature`` extension to the final body.
    5. Classical secp256k1 signature over ``keccak256(SignDoc(final_body, A))``.

    :param account: A :class:`~qorsdk.unified.UnifiedAccount` (carries the PQC key).
    :returns: A :class:`~qorsdk.tx.BuiltTx` exposing ``pqc_signed_message`` /
        ``pqc_signature`` so the contract can be asserted/audited.
    """
    encoded = [_encode_message(m) for m in messages]

    # 1. B0 — body without the PQC extension.
    b0 = TxBody(
        messages=encoded, memo=memo, timeout_height=int(timeout_height)
    ).SerializeToString()

    # 2. A — single-signer AuthInfo with the eth_secp256k1 pubkey.
    auth_info_bytes = _build_eth_auth_info_bytes(account.public_key, sequence, fee)

    # 3. ML-DSA-87 over frame(B0, A).
    pqc_signed_message = _be32(len(b0)) + b0 + _be32(len(auth_info_bytes)) + auth_info_bytes
    pqc_signature = pqc_sign(account.pqc.secret_key, pqc_signed_message)

    # 4. Build the extension Any and attach it to the FINAL body.
    ext = build_hybrid_signature_extension(
        ALGORITHM_DILITHIUM5,
        pqc_signature,
        account.pqc.public_key if include_pqc_public_key else None,
    )
    ext_any = ProtoAny(
        type_url=HYBRID_SIG_TYPE_URL,
        value=json.dumps(ext, separators=(",", ":")).encode("utf-8"),
    )
    body_bytes_final = TxBody(
        messages=encoded,
        memo=memo,
        timeout_height=int(timeout_height),
        extension_options=[ext_any],
    ).SerializeToString()

    # 5. Classical eth_secp256k1 signature over the FINAL body + A.
    sign_doc = SignDoc(
        body_bytes=body_bytes_final,
        auth_info_bytes=auth_info_bytes,
        chain_id=chain_id,
        account_number=int(account_number),
    )
    classical = _eth_sign(sign_doc.SerializeToString(), account.private_key)

    tx_raw = TxRaw(
        body_bytes=body_bytes_final,
        auth_info_bytes=auth_info_bytes,
        signatures=[classical],
    )
    return BuiltTx(
        tx_raw=tx_raw,
        tx_raw_bytes=tx_raw.SerializeToString(),
        auth_info_bytes=auth_info_bytes,
        pqc_signed_message=pqc_signed_message,
        pqc_signature=pqc_signature,
    )


def parse_eth_account_pubkey(pubkey_any: Any) -> bytes:
    """Decode an on-chain pubkey ``Any`` of type ``eth_secp256k1`` to its key.

    Accepts a protobuf ``Any`` (or any object with ``type_url`` / ``value``
    attributes, or a ``{"type_url"/"typeUrl", "value"}`` dict) whose type URL is
    :data:`ETHSECP256K1_PUBKEY_TYPE`, and returns the compressed secp256k1 key
    bytes. Used when reading an account's ``account_number`` / ``sequence`` from
    an on-chain ``BaseAccount`` whose pubkey is eth-native.

    :raises ValueError: If the ``Any`` type URL is not the eth_secp256k1 type.
    """
    if isinstance(pubkey_any, dict):
        type_url = pubkey_any.get("type_url") or pubkey_any.get("typeUrl")
        value = pubkey_any["value"]
    else:
        type_url = getattr(pubkey_any, "type_url", None)
        value = pubkey_any.value
    if type_url != ETHSECP256K1_PUBKEY_TYPE:
        raise ValueError(
            f"expected {ETHSECP256K1_PUBKEY_TYPE}, got {type_url!r}"
        )
    raw = value if isinstance(value, bytes) else bytes(value)
    pubkey = Secp256k1PubKey()
    pubkey.ParseFromString(raw)
    return bytes(pubkey.key)
