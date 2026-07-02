"""Quantum-safe developer-experience (DX) helpers for QoreChain's ``x/pqc`` module.

QoreChain is **quantum-safe by default**: an account can register an ML-DSA-87
(Dilithium-5) post-quantum key, after which its transactions carry a hybrid
signature (classical secp256k1 + PQC) that the chain's ante handler verifies
end-to-end. These helpers make that migration a one-liner instead of
hand-rolling key-registration messages and status queries.

Status is read via the ``qor_getPQCKeyStatus`` JSON-RPC method (exposed as
``get_pqc_key_status`` on :class:`~qorsdk.qor.QorClient` /
:class:`~qorsdk.qor.AsyncQorClient`), whose result is shaped::

    {
        "address": "qor1...",
        "has_pqc_key": true,
        "key_type": "dilithium5",          # omitted when not registered
        "created_at_height": 1234           # omitted when not registered
    }

Registration is done with ``MsgRegisterPQCKeyV2``
(``/qorechain.pqc.v1.MsgRegisterPQCKeyV2``, the chain's classical-exempt
bootstrap path), which carries the signer's ML-DSA-87 public key with an
explicit ``algorithm_id`` plus its classical ECDSA (secp256k1) public key. Once
registered, send transactions through the hybrid signing path
(:func:`qorsdk.tx.build_hybrid_tx`) so every tx is quantum-safe.

This helper mirrors the ergonomic cross-VM / rollup helpers: it wraps the typed
``msg.pqc.register_pqc_key_v2`` / ``msg.pqc.migrate_pqc_key`` composers and the
SDK's tx surface (:func:`~qorsdk.tx.send_messages` /
:func:`~qorsdk.tx.build_hybrid_tx` + :func:`~qorsdk.tx.broadcast`) so an app can
check status and register/migrate keys without touching raw messages.
"""

from __future__ import annotations

from typing import Any, TypedDict

from .accounts import Secp256k1Account
from .messages import msg
from .messages._composer import Msg
from .pqc import ALGORITHM_DILITHIUM5, PqcKeypair
from .tx import broadcast, build_hybrid_tx, send_messages

#: The default ``key_type`` registered for an ML-DSA-87 (Dilithium-5) key,
#: matching the chain's ``x/pqc`` account ``KeyType`` string for hybrid
#: (classical + PQC) accounts.
HYBRID_KEY_TYPE = "hybrid"

#: Deprecated alias kept for backwards compatibility; the chain's bootstrap
#: registration path expects ``"hybrid"``.
DILITHIUM5_KEY_TYPE = HYBRID_KEY_TYPE

#: A Cosmos ``StdFee``-shaped dict (as produced by :func:`qorsdk.fees.estimate_fee`).
FeeDict = dict[str, Any]


class PqcStatus(TypedDict, total=False):
    """The resolved PQC registration status for an address.

    ``registered`` is always present; ``key_type``, ``algorithm_id`` and
    ``created_at_height`` are populated only when a key is registered.
    """

    registered: bool
    key_type: str
    algorithm_id: int
    created_at_height: int


class EnsureResult(TypedDict, total=False):
    """Result of :func:`ensure_pqc_registered`.

    ``already_registered`` is always present. ``tx_hash`` is set only when a
    ``MsgRegisterPQCKeyV2`` was broadcast (i.e. the key was missing before).
    """

    already_registered: bool
    tx_hash: str


def _algorithm_id_for_key_type(key_type: str) -> int | None:
    """Map a chain ``key_type`` string to a PQC algorithm id, if known."""
    if key_type.lower() in ("dilithium5", "ml-dsa-87", "ml_dsa_87"):
        return ALGORITHM_DILITHIUM5
    return None


def _resolve_status(raw: Any, address: str) -> PqcStatus:
    """Normalise a ``qor_getPQCKeyStatus`` result into a :class:`PqcStatus`."""
    data: dict[str, Any] = raw if isinstance(raw, dict) else {}
    registered = bool(data.get("has_pqc_key", False))
    status: PqcStatus = {"registered": registered}
    if registered:
        key_type = data.get("key_type")
        if key_type:
            status["key_type"] = key_type
            algorithm_id = _algorithm_id_for_key_type(key_type)
            if algorithm_id is not None:
                status["algorithm_id"] = algorithm_id
        created = data.get("created_at_height")
        if created is not None:
            status["created_at_height"] = int(created)
    return status


def get_pqc_status(client: Any, address: str) -> PqcStatus:
    """Read the PQC registration status for ``address``.

    ``client`` is a :class:`~qorsdk.qor.QorClient` (anything exposing
    ``get_pqc_key_status(address)``). Returns a :class:`PqcStatus` with
    ``registered`` plus, when registered, ``key_type`` / ``algorithm_id`` /
    ``created_at_height``.
    """
    raw = client.get_pqc_key_status(address)
    return _resolve_status(raw, address)


def is_pqc_registered(client: Any, address: str) -> bool:
    """True if ``address`` has a PQC key registered (via ``qor_getPQCKeyStatus``)."""
    return get_pqc_status(client, address)["registered"]


async def get_pqc_status_async(client: Any, address: str) -> PqcStatus:
    """Async variant of :func:`get_pqc_status` (for :class:`~qorsdk.qor.AsyncQorClient`)."""
    raw = await client.get_pqc_key_status(address)
    return _resolve_status(raw, address)


async def is_pqc_registered_async(client: Any, address: str) -> bool:
    """Async variant of :func:`is_pqc_registered`."""
    return (await get_pqc_status_async(client, address))["registered"]


def build_register_pqc_key(
    *,
    sender: str,
    dilithium_pubkey: bytes,
    ecdsa_pubkey: bytes,
    key_type: str = HYBRID_KEY_TYPE,
) -> Msg:
    """Build a ``MsgRegisterPQCKeyV2`` :class:`~qorsdk.messages.Msg` (no signing).

    Uses ``/qorechain.pqc.v1.MsgRegisterPQCKeyV2`` — the chain's current
    (classical-exempt bootstrap) registration path — with an explicit
    ``algorithm_id`` (ML-DSA-87 / Dilithium-5).
    """
    message: Msg = msg.pqc.register_pqc_key_v2(
        sender=sender,
        public_key=dilithium_pubkey,
        algorithm_id=ALGORITHM_DILITHIUM5,
        ecdsa_pubkey=ecdsa_pubkey,
        key_type=key_type,
    )
    return message


def build_migrate_pqc_key(
    *,
    sender: str,
    old_public_key: bytes,
    new_public_key: bytes,
    new_algorithm_id: int,
    old_signature: bytes,
    new_signature: bytes,
) -> Msg:
    """Build a ``MsgMigratePQCKey`` :class:`~qorsdk.messages.Msg` (no signing).

    Rotates an existing PQC key to ``new_public_key`` (under ``new_algorithm_id``).
    ``old_signature`` / ``new_signature`` prove control of both keys, as required
    by the chain's ``x/pqc`` migration handler.
    """
    message: Msg = msg.pqc.migrate_pqc_key(
        sender=sender,
        old_public_key=old_public_key,
        new_public_key=new_public_key,
        new_algorithm_id=new_algorithm_id,
        old_signature=old_signature,
        new_signature=new_signature,
    )
    return message


def _broadcast_messages(
    *,
    account: Secp256k1Account,
    messages: list[Msg],
    chain_id: str,
    account_number: int,
    sequence: int,
    fee: FeeDict,
    rest_url: str,
    pqc_keypair: PqcKeypair | None,
    memo: str,
    mode: str,
) -> Any:
    """Sign (hybrid when ``pqc_keypair`` given, else classical) and broadcast."""
    if pqc_keypair is not None:
        built = build_hybrid_tx(
            account=account,
            pqc_keypair=pqc_keypair,
            messages=messages,
            fee=fee,
            chain_id=chain_id,
            account_number=account_number,
            sequence=sequence,
            memo=memo,
        )
    else:
        built = send_messages(
            account=account,
            messages=messages,
            chain_id=chain_id,
            account_number=account_number,
            sequence=sequence,
            fee=fee,
            memo=memo,
        )
    return broadcast(rest_url, built.tx_raw_bytes, mode=mode)  # type: ignore[arg-type]


def _extract_tx_hash(response: Any) -> str | None:
    """Pull ``txhash`` out of a broadcast response, if present."""
    if isinstance(response, dict):
        tx_response = response.get("tx_response")
        if isinstance(tx_response, dict) and tx_response.get("txhash"):
            return str(tx_response["txhash"])
        if response.get("txhash"):
            return str(response["txhash"])
    return None


def ensure_pqc_registered(
    *,
    account: Secp256k1Account,
    pqc_keypair: PqcKeypair,
    chain_id: str,
    account_number: int,
    rest_url: str,
    fee: FeeDict,
    sequence: int = 0,
    qor: Any,
    key_type: str = HYBRID_KEY_TYPE,
    memo: str = "",
    mode: str = "sync",
) -> EnsureResult:
    """Make sure ``account`` has a PQC key registered; register it if missing.

    Idempotent: queries ``qor_getPQCKeyStatus`` first via ``qor`` (a
    :class:`~qorsdk.qor.QorClient`). If already registered, returns
    ``{"already_registered": True}`` with no transaction. Otherwise builds and
    broadcasts a ``MsgRegisterPQCKeyV2`` carrying the signer's Dilithium public key
    (``pqc_keypair.public_key``) and classical ECDSA public key
    (``account.public_key``), returning
    ``{"already_registered": False, "tx_hash": ...}``.

    The registration tx itself is signed classically (a wallet cannot yet sign
    hybrid for the very key it is registering); subsequent txs should use the
    hybrid path — see :func:`migrate_to_hybrid`.
    """
    if is_pqc_registered(qor, account.address):
        return {"already_registered": True}

    register = build_register_pqc_key(
        sender=account.address,
        dilithium_pubkey=pqc_keypair.public_key,
        ecdsa_pubkey=account.public_key,
        key_type=key_type,
    )
    response = _broadcast_messages(
        account=account,
        messages=[register],
        chain_id=chain_id,
        account_number=account_number,
        sequence=sequence,
        fee=fee,
        rest_url=rest_url,
        pqc_keypair=None,
        memo=memo,
        mode=mode,
    )
    result: EnsureResult = {"already_registered": False}
    tx_hash = _extract_tx_hash(response)
    if tx_hash is not None:
        result["tx_hash"] = tx_hash
    return result


def migrate_to_hybrid(
    *,
    account: Secp256k1Account,
    pqc_keypair: PqcKeypair,
    messages: list[Msg],
    chain_id: str,
    account_number: int,
    rest_url: str,
    fee: FeeDict,
    sequence: int = 0,
    qor: Any,
    key_type: str = HYBRID_KEY_TYPE,
    register_sequence: int | None = None,
    memo: str = "",
    mode: str = "sync",
) -> Any:
    """Ensure ``account`` is PQC-registered, then send ``messages`` quantum-safe.

    This is the "go quantum-safe" path: it calls :func:`ensure_pqc_registered`
    (broadcasting a ``MsgRegisterPQCKeyV2`` if needed, signed classically at
    ``register_sequence`` — defaulting to ``sequence``), then signs and
    broadcasts ``messages`` through the hybrid path
    (:func:`qorsdk.tx.build_hybrid_tx`) so the transaction carries both a
    classical and an ML-DSA-87 signature.

    Returns the decoded broadcast response for the hybrid ``messages`` tx. If a
    registration tx was broadcast first, advance ``sequence`` accordingly (pass
    the registration at ``register_sequence`` and the hybrid tx at ``sequence``).

    :raises ValueError: If ``messages`` is empty.
    """
    if not messages:
        raise ValueError("migrate_to_hybrid requires at least one message to send")

    ensure_pqc_registered(
        account=account,
        pqc_keypair=pqc_keypair,
        chain_id=chain_id,
        account_number=account_number,
        rest_url=rest_url,
        fee=fee,
        sequence=sequence if register_sequence is None else register_sequence,
        qor=qor,
        key_type=key_type,
        memo=memo,
        mode=mode,
    )

    return _broadcast_messages(
        account=account,
        messages=messages,
        chain_id=chain_id,
        account_number=account_number,
        sequence=sequence,
        fee=fee,
        rest_url=rest_url,
        pqc_keypair=pqc_keypair,
        memo=memo,
        mode=mode,
    )


def migrate_pqc_key(
    *,
    account: Secp256k1Account,
    old_public_key: bytes,
    new_public_key: bytes,
    new_algorithm_id: int,
    old_signature: bytes,
    new_signature: bytes,
    chain_id: str,
    account_number: int,
    rest_url: str,
    fee: FeeDict,
    sequence: int = 0,
    pqc_keypair: PqcKeypair | None = None,
    memo: str = "",
    mode: str = "sync",
) -> Any:
    """Build, sign, and broadcast a ``MsgMigratePQCKey`` (rotate the PQC key).

    Rotates ``old_public_key`` to ``new_public_key`` under ``new_algorithm_id``,
    with ``old_signature`` / ``new_signature`` proving control of both keys. The
    tx is hybrid-signed when ``pqc_keypair`` is supplied, else classical.
    Returns the decoded broadcast response.
    """
    migrate = build_migrate_pqc_key(
        sender=account.address,
        old_public_key=old_public_key,
        new_public_key=new_public_key,
        new_algorithm_id=new_algorithm_id,
        old_signature=old_signature,
        new_signature=new_signature,
    )
    return _broadcast_messages(
        account=account,
        messages=[migrate],
        chain_id=chain_id,
        account_number=account_number,
        sequence=sequence,
        fee=fee,
        rest_url=rest_url,
        pqc_keypair=pqc_keypair,
        memo=memo,
        mode=mode,
    )


__all__ = [
    "HYBRID_KEY_TYPE",
    "DILITHIUM5_KEY_TYPE",
    "PqcStatus",
    "EnsureResult",
    "get_pqc_status",
    "is_pqc_registered",
    "get_pqc_status_async",
    "is_pqc_registered_async",
    "build_register_pqc_key",
    "build_migrate_pqc_key",
    "ensure_pqc_registered",
    "migrate_to_hybrid",
    "migrate_pqc_key",
]
