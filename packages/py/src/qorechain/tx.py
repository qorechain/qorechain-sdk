"""Native transaction building, broadcast, and hybrid (classical + post-quantum)
signing for QoreChain.

This module mirrors the QoreChain TypeScript SDK's tx surface using ``cosmpy``'s
Cosmos protobuf types (``TxBody`` / ``AuthInfo`` / ``SignDoc`` / ``TxRaw`` /
``MsgSend``) and its secp256k1 keypair for SIGN_MODE_DIRECT signing. It provides:

- :func:`bank_send` — build and sign a ``MsgSend`` into a broadcast-ready
  ``TxRaw`` (classical secp256k1 only).
- :func:`broadcast` — POST signed tx bytes to the REST ``/cosmos/tx/v1beta1/txs``
  endpoint (modes ``sync`` / ``async`` / ``block``). Broadcasting needs a live
  node, so unit tests mock this HTTP POST.
- :func:`build_hybrid_tx` — assemble a hybrid transaction carrying a classical
  secp256k1 signature in ``TxRaw.signatures`` PLUS an ML-DSA-87 (Dilithium-5)
  signature attached to the ``TxBody`` as a ``PQCHybridSignature`` extension.

──────────────────────────────────────────────────────────────────────────────
 The wallet ↔ chain hybrid contract (enforced by the chain; matches the TS SDK)
──────────────────────────────────────────────────────────────────────────────
The chain verifies the ML-DSA-87 signature over the tx body WITH the PQC
extension REMOVED:

- ``B0`` = canonical protobuf bytes of the ``TxBody`` containing the
  messages/memo/timeout but NOT the ``PQCHybridSignature`` extension.
- ``A``  = the ``AuthInfo`` bytes (signer secp256k1 pubkey, SIGN_MODE_DIRECT,
  sequence, fee) — the exact bytes that are broadcast.
- PQC signed message = ``BE32(len(B0)) || B0 || BE32(len(A)) || A`` (4-byte
  big-endian length prefixes; NO hashing, NO domain prefix).
- PQC signature = ``pqc_sign(pqc_secret, message)`` — pure ML-DSA-87, 4627 bytes.
- The ``PQCHybridSignature`` extension is then added to
  ``TxBody.extension_options`` (the CRITICAL extension-options slot) as an
  ``Any`` whose ``type_url`` is ``/qorechain.pqc.v1.PQCHybridSignature`` and
  whose ``value`` is the UTF-8 bytes of the Go-JSON
  ``{"algorithm_id", "pqc_signature", "pqc_public_key"?}`` (standard padded
  base64; ``pqc_public_key`` omitted when not supplied) → final body bytes.
- The CLASSICAL secp256k1 SIGN_MODE_DIRECT signature is computed over
  ``SignDoc(final_body, A, chain_id, account_number)`` and goes in
  ``TxRaw.signatures`` (outside the body). The classical signature never signs
  itself.

The signer's PQC key must be registered on-chain (via ``MsgRegisterPQCKey``)
before hybrid txs PQC-verify — unless ``include_pqc_public_key`` is set, which
embeds the key for auto-registration on first use. Registering the key is the
caller's responsibility.

Determinism note (same caveat as the TS SDK): the BE32 framing is byte-for-byte
deterministic on the wallet side. Cross-implementation determinism (this
``cosmpy`` proto encoding vs. the chain's re-marshal of the same ``TxBody``) is
confirmed for the default bank message types; callers using custom message types
with non-canonical field ordering must ensure their encoding is canonical.
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from typing import Any as TypingAny
from typing import Literal

import httpx
from cosmpy.crypto.keypairs import PrivateKey
from cosmpy.protos.cosmos.bank.v1beta1.tx_pb2 import MsgSend
from cosmpy.protos.cosmos.base.v1beta1.coin_pb2 import Coin
from cosmpy.protos.cosmos.crypto.secp256k1.keys_pb2 import PubKey as Secp256k1PubKey
from cosmpy.protos.cosmos.tx.signing.v1beta1.signing_pb2 import SignMode
from cosmpy.protos.cosmos.tx.v1beta1.tx_pb2 import (
    AuthInfo,
    Fee,
    ModeInfo,
    SignDoc,
    SignerInfo,
    TxBody,
    TxRaw,
)
from google.protobuf.any_pb2 import Any as ProtoAny

from .accounts import Secp256k1Account
from .pqc import (
    ALGORITHM_DILITHIUM5,
    HYBRID_SIG_TYPE_URL,
    PqcKeypair,
    build_hybrid_signature_extension,
    pqc_sign,
)

#: The ``/cosmos.bank.v1beta1.MsgSend`` type URL.
MSG_SEND_TYPE_URL = "/cosmos.bank.v1beta1.MsgSend"

#: Broadcast mode for the REST ``/cosmos/tx/v1beta1/txs`` endpoint.
BroadcastMode = Literal["sync", "async", "block"]

_BROADCAST_MODE_MAP: dict[str, str] = {
    "sync": "BROADCAST_MODE_SYNC",
    "async": "BROADCAST_MODE_ASYNC",
    "block": "BROADCAST_MODE_BLOCK",
}

#: A Cosmos coin as a plain dict, e.g. ``{"denom": "uqor", "amount": "1000"}``.
CoinDict = dict[str, str]
#: A Cosmos ``StdFee``-shaped dict (as produced by :func:`~qorechain.fees.estimate_fee`).
FeeDict = dict[str, TypingAny]


@dataclass(frozen=True)
class BuiltTx:
    """A built, signed transaction plus the intermediate artifacts.

    For a plain :func:`bank_send` the PQC fields are empty; for
    :func:`build_hybrid_tx` they expose the exact bytes signed by ML-DSA-87 so
    the contract can be asserted/audited.
    """

    #: The assembled ``TxRaw`` (final body + authInfo + classical signature).
    tx_raw: TxRaw
    #: Encoded ``TxRaw`` bytes, ready to broadcast.
    tx_raw_bytes: bytes
    #: The ``AuthInfo`` bytes (``A``) — identical in the PQC framing and SignDoc.
    auth_info_bytes: bytes
    #: The exact bytes the ML-DSA-87 signature covered (empty for non-hybrid).
    pqc_signed_message: bytes = b""
    #: The raw ML-DSA-87 signature (Dilithium-5: 4627 bytes; empty if non-hybrid).
    pqc_signature: bytes = b""


def _be32(n: int) -> bytes:
    """A big-endian 4-byte length prefix, matching the chain contract framing."""
    return n.to_bytes(4, "big")


def _to_coins(amount: list[CoinDict]) -> list[Coin]:
    return [Coin(denom=c["denom"], amount=str(c["amount"])) for c in amount]


def _fee_to_proto(fee: FeeDict) -> Fee:
    """Convert an ``estimate_fee``-style dict into a protobuf ``Fee``."""
    amount = _to_coins(list(fee.get("amount", [])))
    gas = int(fee.get("gas", 0))
    granter = fee.get("granter", "") or ""
    payer = fee.get("payer", "") or ""
    return Fee(amount=amount, gas_limit=gas, granter=granter, payer=payer)


def _encode_pubkey_any(compressed_pubkey: bytes) -> ProtoAny:
    """Pack a compressed secp256k1 pubkey into a Cosmos ``Any``."""
    any_pub = ProtoAny()
    any_pub.Pack(Secp256k1PubKey(key=compressed_pubkey), type_url_prefix="/")
    return any_pub


def _build_auth_info_bytes(
    compressed_pubkey: bytes, sequence: int, fee: FeeDict
) -> bytes:
    """Build the single-signer SIGN_MODE_DIRECT ``AuthInfo`` bytes (``A``)."""
    mode_info = ModeInfo(single=ModeInfo.Single(mode=SignMode.SIGN_MODE_DIRECT))
    signer_info = SignerInfo(
        public_key=_encode_pubkey_any(compressed_pubkey),
        mode_info=mode_info,
        sequence=int(sequence),
    )
    auth_info = AuthInfo(signer_infos=[signer_info], fee=_fee_to_proto(fee))
    serialized: bytes = auth_info.SerializeToString()
    return serialized


def _message_parts(message: TypingAny) -> tuple[str, TypingAny]:
    """Extract ``(type_url, value)`` from a :class:`~qorechain.messages.Msg` or dict.

    Accepts either a composer-produced :class:`Msg` (with ``type_url`` /
    ``value`` attributes) or a plain ``{"type_url", "value"}`` dict, so callers
    can pass composer output or hand-built messages interchangeably.
    """
    if isinstance(message, dict):
        return message["type_url"], message["value"]
    return message.type_url, message.value


def _encode_message(message: TypingAny) -> ProtoAny:
    """Encode a message into a protobuf ``Any``.

    ``message`` is a :class:`~qorechain.messages.Msg` or a ``{"type_url",
    "value"}`` dict. ``value`` may be a protobuf message instance (it is
    serialized) or raw ``bytes`` (used verbatim).
    """
    type_url, value = _message_parts(message)
    raw: bytes = (
        value.SerializeToString() if hasattr(value, "SerializeToString") else value
    )
    return ProtoAny(type_url=type_url, value=raw)


def _sign_direct(private_key: bytes, sign_doc: SignDoc) -> bytes:
    """Produce a 64-byte canonical secp256k1 SIGN_MODE_DIRECT signature.

    cosmpy's ``PrivateKey.sign`` signs ``sha256(message)`` deterministically and
    returns the canonical 64-byte ``r || s`` encoding — exactly what Cosmos
    SIGN_MODE_DIRECT expects over the serialized ``SignDoc``.
    """
    priv = PrivateKey(private_key)
    signature: bytes = priv.sign(sign_doc.SerializeToString())
    return signature


def send_messages(
    *,
    account: Secp256k1Account,
    messages: list[TypingAny],
    chain_id: str,
    account_number: int,
    sequence: int,
    fee: FeeDict,
    memo: str = "",
    timeout_height: int = 0,
) -> BuiltTx:
    """Build and sign a tx carrying ANY supported messages (classical only).

    This is the generic counterpart to :func:`bank_send`: it accepts a list of
    composer-produced :class:`~qorechain.messages.Msg` objects (or ``{"type_url",
    "value"}`` dicts), packs each into a Cosmos ``Any``, builds the single-signer
    SIGN_MODE_DIRECT ``AuthInfo`` from the account's compressed secp256k1 pubkey,
    signs the ``SignDoc``, and assembles the ``TxRaw``. It does not broadcast —
    pass :attr:`BuiltTx.tx_raw_bytes` to :func:`broadcast`.

    For a quantum-safe (classical + ML-DSA-87) transaction over the same
    messages, use :func:`build_hybrid_tx` instead.

    :param messages: Messages to include (``Msg`` objects or
        ``{"type_url", "value"}`` dicts). Must be non-empty.
    """
    if not messages:
        raise ValueError("send_messages requires at least one message")

    body = TxBody(
        messages=[_encode_message(m) for m in messages],
        memo=memo,
        timeout_height=int(timeout_height),
    )
    body_bytes = body.SerializeToString()
    auth_info_bytes = _build_auth_info_bytes(account.public_key, sequence, fee)

    sign_doc = SignDoc(
        body_bytes=body_bytes,
        auth_info_bytes=auth_info_bytes,
        chain_id=chain_id,
        account_number=int(account_number),
    )
    signature = _sign_direct(account.private_key, sign_doc)

    tx_raw = TxRaw(
        body_bytes=body_bytes,
        auth_info_bytes=auth_info_bytes,
        signatures=[signature],
    )
    return BuiltTx(
        tx_raw=tx_raw,
        tx_raw_bytes=tx_raw.SerializeToString(),
        auth_info_bytes=auth_info_bytes,
    )


def bank_send(
    *,
    account: Secp256k1Account,
    to_address: str,
    amount: list[CoinDict],
    chain_id: str,
    account_number: int,
    sequence: int,
    fee: FeeDict,
    memo: str = "",
    timeout_height: int = 0,
) -> BuiltTx:
    """Build and sign a bank ``MsgSend`` into a broadcast-ready ``TxRaw``.

    A thin convenience over :func:`send_messages` that constructs
    ``/cosmos.bank.v1beta1.MsgSend`` from ``account.address`` to ``to_address``.
    This does not broadcast — pass :attr:`BuiltTx.tx_raw_bytes` to
    :func:`broadcast`.
    """
    msg = MsgSend(
        from_address=account.address,
        to_address=to_address,
        amount=_to_coins(amount),
    )
    return send_messages(
        account=account,
        messages=[{"type_url": MSG_SEND_TYPE_URL, "value": msg}],
        chain_id=chain_id,
        account_number=account_number,
        sequence=sequence,
        fee=fee,
        memo=memo,
        timeout_height=timeout_height,
    )


def build_hybrid_tx(
    *,
    account: Secp256k1Account,
    pqc_keypair: PqcKeypair,
    messages: list[TypingAny],
    fee: FeeDict,
    chain_id: str,
    account_number: int,
    sequence: int,
    memo: str = "",
    timeout_height: int = 0,
    include_pqc_public_key: bool = False,
) -> BuiltTx:
    """Build a fully signed hybrid (classical + PQC) transaction.

    Follows the chain contract (see the module header). The build sequence:

    1. Encode ``B0`` — the ``TxBody`` WITHOUT the PQC extension.
    2. Encode ``A`` — the single-signer SIGN_MODE_DIRECT ``AuthInfo``.
    3. ``message = BE32(len B0) || B0 || BE32(len A) || A``; ML-DSA-87 sign it.
    4. Build the ``PQCHybridSignature`` extension ``Any`` and attach it to a new
       body identical to step 1 but with ``extension_options = [ext]`` → final
       body bytes.
    5. Classical SIGN_MODE_DIRECT signature over
       ``SignDoc(final_body, A, chain_id, account_number)``.
    6. Assemble ``TxRaw(final_body, A, [classical_sig])``.

    ``messages`` are composer-produced :class:`~qorechain.messages.Msg` objects
    (or ``{"type_url", "value"}`` dicts where ``value`` is a protobuf message or
    raw bytes), so any supported message carries a hybrid signature. The signer's
    PQC key must already be
    registered on-chain via ``MsgRegisterPQCKey`` unless
    ``include_pqc_public_key`` is ``True``.

    :returns: A :class:`BuiltTx` exposing ``pqc_signed_message`` and
        ``pqc_signature`` so the contract can be asserted/audited.
    """
    encoded_messages = [_encode_message(m) for m in messages]

    # 1. B0 — body WITHOUT the PQC extension.
    base_body = TxBody(
        messages=encoded_messages, memo=memo, timeout_height=int(timeout_height)
    )
    b0 = base_body.SerializeToString()

    # 2. A — single-signer AuthInfo (SIGN_MODE_DIRECT).
    auth_info_bytes = _build_auth_info_bytes(account.public_key, sequence, fee)

    # 3. PQC framing + ML-DSA-87 signature over B0 + A (NOT the final body).
    pqc_signed_message = (
        _be32(len(b0)) + b0 + _be32(len(auth_info_bytes)) + auth_info_bytes
    )
    pqc_signature = pqc_sign(pqc_keypair.secret_key, pqc_signed_message)

    # 4. Build the PQC extension Any and attach it to the FINAL body as a
    #    CRITICAL extension option. The Any.value is the Go-JSON of the extension
    #    (standard padded base64; pqc_public_key omitted unless requested).
    ext = build_hybrid_signature_extension(
        ALGORITHM_DILITHIUM5,
        pqc_signature,
        pqc_keypair.public_key if include_pqc_public_key else None,
    )
    ext_any = ProtoAny(
        type_url=HYBRID_SIG_TYPE_URL,
        value=json.dumps(ext, separators=(",", ":")).encode("utf-8"),
    )
    final_body = TxBody(
        messages=encoded_messages,
        memo=memo,
        timeout_height=int(timeout_height),
        extension_options=[ext_any],
    )
    body_bytes_final = final_body.SerializeToString()

    # 5. Classical SIGN_MODE_DIRECT signature over the FINAL body + A.
    sign_doc = SignDoc(
        body_bytes=body_bytes_final,
        auth_info_bytes=auth_info_bytes,
        chain_id=chain_id,
        account_number=int(account_number),
    )
    classical_sig = _sign_direct(account.private_key, sign_doc)

    # 6. Assemble TxRaw.
    tx_raw = TxRaw(
        body_bytes=body_bytes_final,
        auth_info_bytes=auth_info_bytes,
        signatures=[classical_sig],
    )
    return BuiltTx(
        tx_raw=tx_raw,
        tx_raw_bytes=tx_raw.SerializeToString(),
        auth_info_bytes=auth_info_bytes,
        pqc_signed_message=pqc_signed_message,
        pqc_signature=pqc_signature,
    )


def broadcast(
    rest_url: str,
    tx_bytes: bytes,
    *,
    mode: BroadcastMode = "sync",
    timeout: float = 30.0,
    client: httpx.Client | None = None,
) -> TypingAny:
    """Broadcast signed ``TxRaw`` bytes via the REST ``/cosmos/tx/v1beta1/txs``.

    POSTs ``{"tx_bytes": <base64>, "mode": "BROADCAST_MODE_*"}`` and returns the
    decoded JSON response. Broadcasting requires a live node; unit tests mock
    this POST.

    :param mode: ``sync`` (after CheckTx), ``async`` (fire-and-forget), or
        ``block`` (wait for inclusion).
    :raises httpx.HTTPStatusError: On a non-2xx response.
    """
    proto_mode = _BROADCAST_MODE_MAP[mode]
    payload = {
        "tx_bytes": base64.b64encode(tx_bytes).decode("ascii"),
        "mode": proto_mode,
    }
    url = f"{rest_url.rstrip('/')}/cosmos/tx/v1beta1/txs"
    owns_client = client is None
    http = client or httpx.Client(timeout=timeout)
    try:
        resp = http.post(url, json=payload)
        resp.raise_for_status()
        return resp.json()
    finally:
        if owns_client:
            http.close()
