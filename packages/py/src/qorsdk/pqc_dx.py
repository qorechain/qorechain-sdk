"""Developer-experience (DX) helpers for QoreChain's ``x/pqc`` module.

On QoreChain's native lane **hybrid signing is the default**: an account can register an ML-DSA-87
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
(:func:`qorsdk.tx.build_hybrid_tx`) so every native tx is hybrid-signed.

This helper mirrors the ergonomic cross-VM / rollup helpers: it wraps the typed
``msg.pqc.register_pqc_key_v2`` / ``msg.pqc.migrate_pqc_key`` composers and the
SDK's tx surface (:func:`~qorsdk.tx.send_messages` /
:func:`~qorsdk.tx.build_hybrid_tx` + :func:`~qorsdk.tx.broadcast`) so an app can
check status and register/migrate keys without touching raw messages.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
from typing import Any, TypedDict
from urllib.parse import quote

from .accounts import Secp256k1Account
from .classical_key import validate_classical_key_for_sender
from .errors import tx_error_from
from .key_integrity import sign_proof_of_possession, validate_registered_pqc_key
from .messages import msg
from .messages._composer import Msg
from .pqc import ALGORITHM_DILITHIUM5, PqcKeypair
from .rest import RestClient
from .signbytes import SignBytesVersion
from .tx import broadcast, build_hybrid_tx, hybrid_sign_and_broadcast, send_messages
from .upgrades import CHAIN_UPGRADE_V3_2_3, is_upgrade_applied

#: The default ``key_type`` registered for an ML-DSA-87 (Dilithium-5) key,
#: matching the chain's ``x/pqc`` account ``KeyType`` string for hybrid
#: (classical + PQC) accounts.
HYBRID_KEY_TYPE = "hybrid"

#: Deprecated alias kept for backwards compatibility; the chain's bootstrap
#: registration path expects ``"hybrid"``.
DILITHIUM5_KEY_TYPE = HYBRID_KEY_TYPE

#: A Native ``StdFee``-shaped dict (as produced by :func:`qorsdk.fees.estimate_fee`).
FeeDict = dict[str, Any]


class PqcStatus(TypedDict, total=False):
    """The resolved PQC registration status for an address.

    ``registered`` is always present; ``key_type``, ``algorithm_id``,
    ``created_at_height`` and ``pubkey`` are populated only when a key is
    registered. ``pubkey`` is the registered public key as the source gave it:
    base64 over REST, hex or bytes elsewhere (see :func:`pqc_status_public_key`).

    ``possession_proven`` (chain v3.2.4, read over REST) is whether the key was
    proven by a proof of possession: a registration carrying a valid proof, or a
    rotation or migration. ``False`` for a key registered without one; absent on
    nodes below v3.2.4.
    """

    registered: bool
    key_type: str
    algorithm_id: int
    created_at_height: int
    pubkey: str | bytes
    possession_proven: bool


class EnsureResult(TypedDict, total=False):
    """Result of :func:`ensure_pqc_registered`.

    ``already_registered`` is always present. ``tx_hash`` is set only when a
    ``MsgRegisterPQCKeyV2`` was broadcast (i.e. the key was missing before).

    ``key_verified`` is set when the account was already registered: ``True``
    when the registered key was compared with ``pqc_keypair`` and matched,
    ``False`` when no answer carried the key, so it could not be checked (do not
    assume it is yours). Absent when a registration was sent.
    """

    already_registered: bool
    key_verified: bool
    tx_hash: str


def _algorithm_id_for_key_type(key_type: str) -> int | None:
    """Map a chain ``key_type`` string to a PQC algorithm id, if known."""
    if key_type.lower() in ("dilithium5", "ml-dsa-87", "ml_dsa_87"):
        return ALGORITHM_DILITHIUM5
    return None


def _resolve_status(raw: Any, address: str) -> PqcStatus:
    """Normalise a ``qor_getPQCKeyStatus`` result into a :class:`PqcStatus`.

    :raises ValueError: When the answer is not a readable status. No answer is
        not "not registered": reading it that way makes a client re-register a
        key the chain already has, and pay the fee each time.
    """
    if not isinstance(raw, dict) or "has_pqc_key" not in raw:
        raise ValueError(
            f"qor_getPQCKeyStatus gave no usable answer for {address}; cannot tell "
            "whether a PQC key is registered"
        )
    data: dict[str, Any] = raw
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
        pubkey = data.get("pubkey", data.get("public_key"))
        if isinstance(pubkey, (str, bytes)) and pubkey:
            status["pubkey"] = pubkey
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


#: Positive answers per (rest_url, address), key included: a registered key
#: stays registered.
_REGISTERED_CACHE: dict[tuple[str, str], PqcStatus] = {}


def fetch_pqc_status(rest_url: str, address: str) -> PqcStatus:
    """Read the PQC registration status over REST
    (``GET {rest_url}/qorechain/pqc/v1/account/{address}``), the route every
    public endpoint serves (the ``qor_*`` JSON-RPC namespace is not exposed
    publicly).

    The chain answers ``{"found": false}`` for an account without a key.
    Anything that is not a readable ``found`` - an HTTP error, a missing field, a
    transport failure - is UNKNOWN: retried once, then raised. It is never read
    as "not registered". A positive answer is cached per (rest_url, address).

    :raises RuntimeError: When the status cannot be read.
    """
    base = rest_url.rstrip("/")
    cached = _REGISTERED_CACHE.get((base, address))
    if cached is not None:
        return PqcStatus(**cached)
    path = f"/qorechain/pqc/v1/account/{quote(address, safe='')}"
    last: Exception | None = None
    for _attempt in range(2):
        try:
            with RestClient(base) as rest:
                body = rest.get(path)
            if not isinstance(body, dict) or not isinstance(body.get("found"), bool):
                raise ValueError(f'no "found" field in the answer from {base}{path}')
            if not body["found"]:
                return {"registered": False}
            status: PqcStatus = {"registered": True}
            acct = body.get("account") or {}
            if not isinstance(acct, dict):
                acct = {}
            key_type = acct.get("key_type")
            if key_type:
                status["key_type"] = key_type
            # The account carries algorithm_id itself; key_type is "hybrid" for
            # every key the SDK registers, so it names no algorithm.
            algorithm_id = acct.get("algorithm_id")
            if isinstance(algorithm_id, (int, str)) and str(algorithm_id).isdigit():
                status["algorithm_id"] = int(algorithm_id)
            elif key_type:
                mapped = _algorithm_id_for_key_type(key_type)
                if mapped is not None:
                    status["algorithm_id"] = mapped
            public_key = acct.get("public_key")
            if isinstance(public_key, str) and public_key:
                status["pubkey"] = public_key
            possession_proven = acct.get("possession_proven")
            if isinstance(possession_proven, bool):
                status["possession_proven"] = possession_proven
            _REGISTERED_CACHE[(base, address)] = status
            return PqcStatus(**status)
        except Exception as exc:  # noqa: BLE001 - any failure means "unknown"
            last = exc
    raise RuntimeError(
        f"cannot tell whether {address} has a registered PQC key: {last}"
    ) from last


def clear_pqc_status_cache() -> None:
    """Forget cached registration answers (tests, network switches)."""
    _REGISTERED_CACHE.clear()


def _forget_status(rest_url: str, address: str) -> None:
    """Drop one cached positive answer, so the next read asks the node."""
    _REGISTERED_CACHE.pop((rest_url.rstrip("/"), address), None)


def pqc_status_public_key(status: PqcStatus) -> bytes | None:
    """The registered public key carried by a :class:`PqcStatus`, as bytes.

    The REST route returns it base64, ``qor_getPQCKeyStatus`` hex (an optional
    ``0x`` prefix is accepted); bytes are returned as they are. ``None`` when the
    status carries no key or it does not decode.
    """
    raw = status.get("pubkey")
    if isinstance(raw, (bytes, bytearray)):
        return bytes(raw) if raw else None
    if not isinstance(raw, str) or not raw:
        return None
    hex_part = raw[2:] if raw[:2] in ("0x", "0X") else raw
    if len(hex_part) % 2 == 0 and all(c in "0123456789abcdefABCDEF" for c in hex_part):
        return bytes.fromhex(hex_part)
    b64 = raw.replace("-", "+").replace("_", "/")
    try:
        decoded = base64.b64decode(b64 + "=" * (-len(b64) % 4), validate=True)
    except (binascii.Error, ValueError):
        return None
    return decoded or None


def is_registered_pqc_key(status: PqcStatus, public_key: bytes) -> bool | None:
    """Whether the key ``status`` reports registered is ``public_key``.

    ``True`` / ``False``, or ``None`` when the status carries no readable key.
    An unregistered status is ``False``.
    """
    if not status.get("registered"):
        return False
    registered = pqc_status_public_key(status)
    if registered is None:
        return None
    return registered == bytes(public_key)


def _key_fingerprint(key: bytes) -> str:
    """First 8 bytes of shake256(key), hex: enough to tell two keys apart."""
    return hashlib.shake_256(key).hexdigest(8)


class PqcKeyMismatchError(Exception):
    """Raised by :func:`ensure_pqc_registered` (and :func:`migrate_to_hybrid`)
    when the account already has a PQC key and it is NOT the caller's keypair.

    Nothing is broadcast: the chain refuses a second registration after
    charging the fee, and every hybrid transaction signed with the caller's key
    would be refused. Sign with the keypair that registered the account, or
    rotate the key (``MsgRotatePQCKey``).
    """

    #: A short stable identifier, like :attr:`qorsdk.errors.QoreTxError.kind`.
    kind = "pqc_key_mismatch"

    def __init__(self, address: str, registered_public_key: bytes, public_key: bytes) -> None:
        super().__init__(
            f"{address} already has a different PQC key registered (registered "
            f"{_key_fingerprint(registered_public_key)}, this keypair "
            f"{_key_fingerprint(public_key)}). Nothing was sent. Sign with the keypair "
            "that registered the account, or rotate its key with MsgRotatePQCKey."
        )
        #: The account.
        self.address = address
        #: The key registered on chain.
        self.registered_public_key = registered_public_key
        #: The caller's key.
        self.public_key = public_key


def _raise_if_other_key(address: str, status: PqcStatus, public_key: bytes) -> None:
    """Raise :class:`PqcKeyMismatchError` when ``status`` is registered with a
    key other than ``public_key``."""
    if status.get("registered") and is_registered_pqc_key(status, public_key) is False:
        registered = pqc_status_public_key(status)
        assert registered is not None
        raise PqcKeyMismatchError(address, registered, public_key)


def _is_already_registered(response: Any) -> bool:
    """True when a broadcast response is the chain's refusal of a second
    registration (``pqc`` 7)."""
    tx = response.get("tx_response", response) if isinstance(response, dict) else {}
    if not isinstance(tx, dict):
        return False
    log = str(tx.get("raw_log") or tx.get("log") or "")
    if "pqc account already registered" in log.lower():
        return True
    return tx.get("codespace") == "pqc" and str(tx.get("code")) == "7"


def _raise_if_check_tx_failed(response: Any) -> None:
    """Raise :class:`~qorsdk.errors.QoreTxError` when the broadcast answer
    carries a non-zero CheckTx code.

    Only the broadcast answer is read: in ``sync`` mode a failure inside the
    block is not known yet and is left to the caller's tracking.
    """
    tx = response.get("tx_response", response) if isinstance(response, dict) else {}
    if not isinstance(tx, dict):
        return
    try:
        code = int(tx.get("code") or 0)
    except (TypeError, ValueError):
        return
    if code != 0:
        raise tx_error_from(
            code,
            codespace=tx.get("codespace") or None,
            raw_log=tx.get("raw_log") or tx.get("log") or None,
            tx_hash=_extract_tx_hash(response),
        )


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
    proof_of_possession: bytes = b"",
) -> Msg:
    """Build a ``MsgRegisterPQCKeyV2`` :class:`~qorsdk.messages.Msg` (no signing).

    Uses ``/qorechain.pqc.v1.MsgRegisterPQCKeyV2`` - the chain's current
    (classical-exempt bootstrap) registration path - with an explicit
    ``algorithm_id`` (ML-DSA-87 / Dilithium-5).

    ``proof_of_possession`` (chain v3.2.3) comes from
    :func:`qorsdk.key_integrity.sign_proof_of_possession`. A node below v3.2.3
    refuses the whole transaction when it is set, so pass it only once the
    network has applied v3.2.3.

    :raises ValueError: If ``ecdsa_pubkey`` is not empty and not the sender's own
        33-byte compressed key (refused from chain v3.2.2), or the key is
        ``classical_only``, empty or degenerate (refused from v3.2.3). Not
        network-gated: such a registration is wrong anywhere.
    """
    validate_classical_key_for_sender(sender, ecdsa_pubkey)
    validate_registered_pqc_key(key_type, dilithium_pubkey)
    message: Msg = msg.pqc.register_pqc_key_v2(
        sender=sender,
        public_key=dilithium_pubkey,
        algorithm_id=ALGORITHM_DILITHIUM5,
        ecdsa_pubkey=ecdsa_pubkey,
        key_type=key_type,
        proof_of_possession=proof_of_possession,
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
    sign_bytes_version: str = "auto",
) -> Any:
    """Sign (hybrid when ``pqc_keypair`` given, else classical) and broadcast.

    The hybrid path resolves the per-network sign-bytes form (``"auto"`` asks the
    node) and retries once on a ``pqc`` code 21 refusal - see
    :func:`qorsdk.tx.hybrid_sign_and_broadcast`.
    """
    if pqc_keypair is not None:
        keypair = pqc_keypair

        def build(version: SignBytesVersion) -> Any:
            return build_hybrid_tx(
                account=account,
                pqc_keypair=keypair,
                messages=messages,
                fee=fee,
                chain_id=chain_id,
                account_number=account_number,
                sequence=sequence,
                memo=memo,
                sign_bytes_version=version,
            )

        return hybrid_sign_and_broadcast(
            build,
            chain_id=chain_id,
            rest_url=rest_url,
            sign_bytes_version=sign_bytes_version,
            mode=mode,  # type: ignore[arg-type]
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
    qor: Any = None,
    key_type: str = HYBRID_KEY_TYPE,
    memo: str = "",
    mode: str = "sync",
) -> EnsureResult:
    """Make sure ``account`` has a PQC key registered; register it if missing.

    Idempotent: reads the registration status over REST from ``rest_url``
    first (:func:`fetch_pqc_status`; the ``qor_*`` JSON-RPC namespace is not
    exposed on public endpoints, so ``qor`` is no longer needed and is
    ignored). An unreadable status raises instead of registering blind - a
    second registration is refused by the chain after the fee is charged.

    When the account already has a key, this returns
    ``{"already_registered": True}`` with no transaction, provided the
    registered key is ``pqc_keypair``'s. When it is a different key it raises
    :class:`PqcKeyMismatchError` and sends nothing: the caller's hybrid
    transactions would all be refused. A status that carries no public key, or a
    different one, is read once more uncached before deciding; when still no
    answer carries the key, the result says ``"key_verified": False`` instead of
    claiming the key is yours (``True`` when it was compared and matched). A
    refusal of the broadcast as "already registered" (``pqc`` 7) is checked the
    same way. Otherwise builds and
    broadcasts a ``MsgRegisterPQCKeyV2`` carrying the signer's Dilithium public key
    (``pqc_keypair.public_key``) and classical ECDSA public key
    (``account.public_key``), returning
    ``{"already_registered": False, "tx_hash": ...}``. Any other non-zero
    CheckTx code in the broadcast answer raises
    :class:`~qorsdk.errors.QoreTxError`.

    The registration tx itself is signed classically (a wallet cannot yet sign
    hybrid for the very key it is registering); subsequent txs should use the
    hybrid path - see :func:`migrate_to_hybrid`.
    """
    status = fetch_pqc_status(rest_url, account.address)
    if status["registered"]:
        # Registered, but by whom? A different key means the caller's hybrid
        # transactions would all be refused; say so now rather than "done".
        match = is_registered_pqc_key(status, pqc_keypair.public_key)
        if match is not True:
            # A different key, or none in the answer: read once more uncached (a
            # rotation may have just landed) rather than take "registered" for
            # "yours".
            _forget_status(rest_url, account.address)
            status = fetch_pqc_status(rest_url, account.address)
            _raise_if_other_key(account.address, status, pqc_keypair.public_key)
            match = is_registered_pqc_key(status, pqc_keypair.public_key)
        return {"already_registered": True, "key_verified": match is True}

    # From chain v3.2.3 the registration carries a proof that the registrant
    # holds the key. Sign it once the network has applied v3.2.3 - never before:
    # a node below it refuses the whole transaction for the field.
    proof = b""
    with RestClient(rest_url) as rest:
        if is_upgrade_applied(rest, CHAIN_UPGRADE_V3_2_3, cache_key=rest_url):
            proof = sign_proof_of_possession(
                chain_id=chain_id, account=account.address, keypair=pqc_keypair
            )

    register = build_register_pqc_key(
        sender=account.address,
        dilithium_pubkey=pqc_keypair.public_key,
        ecdsa_pubkey=account.public_key,
        key_type=key_type,
        proof_of_possession=proof,
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
    if _is_already_registered(response):
        # The key was registered after all (a race, or a stale answer): fine,
        # provided it is this keypair's.
        _forget_status(rest_url, account.address)
        status = fetch_pqc_status(rest_url, account.address)
        _raise_if_other_key(account.address, status, pqc_keypair.public_key)
        return {
            "already_registered": True,
            "key_verified": is_registered_pqc_key(status, pqc_keypair.public_key) is True,
        }
    # Any other refusal is a failure, not a registration.
    _raise_if_check_tx_failed(response)
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
    sign_bytes_version: str = "auto",
) -> Any:
    """Ensure ``account`` is PQC-registered, then send ``messages`` hybrid-signed.

    This is the "go hybrid" path: it calls :func:`ensure_pqc_registered`
    (broadcasting a ``MsgRegisterPQCKeyV2`` if needed, signed classically at
    ``register_sequence`` - defaulting to ``sequence``), then signs and
    broadcasts ``messages`` through the hybrid path
    (:func:`qorsdk.tx.build_hybrid_tx`) so the transaction carries both a
    classical and an ML-DSA-87 signature.

    ``sign_bytes_version`` (``"auto"`` | ``"v1"`` | ``"v2"``) picks the hybrid
    sign-bytes form; ``"auto"`` asks ``rest_url`` which form the network verifies
    and retries once on a ``pqc`` code 21 refusal.

    Sequencing: with ``register_sequence`` left as ``None`` the registration (if
    one is broadcast) goes out at ``sequence`` and the hybrid ``messages`` tx at
    ``sequence + 1``; if the key was already registered, the hybrid tx goes out
    at ``sequence``. Passing ``register_sequence`` explicitly puts the
    registration at that sequence and the hybrid tx at ``sequence`` unchanged -
    the caller then owns both nonces.

    Returns the decoded broadcast response for the hybrid ``messages`` tx.

    :raises ValueError: If ``messages`` is empty.
    :raises PqcKeyMismatchError: If the account already has a different PQC key
        registered (nothing is sent).
    :raises QoreTxError: If the registration is refused at CheckTx (the
        ``messages`` tx is then not sent).
    """
    if not messages:
        raise ValueError("migrate_to_hybrid requires at least one message to send")

    ensured = ensure_pqc_registered(
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

    # A registration broadcast in this flow consumed ``sequence``; the hybrid tx
    # must sign over the next nonce (mirrors the Go ``MigrateToHybrid``).
    hybrid_sequence = sequence
    if register_sequence is None and not ensured["already_registered"]:
        hybrid_sequence = sequence + 1

    return _broadcast_messages(
        account=account,
        messages=messages,
        chain_id=chain_id,
        account_number=account_number,
        sequence=hybrid_sequence,
        fee=fee,
        rest_url=rest_url,
        pqc_keypair=pqc_keypair,
        memo=memo,
        mode=mode,
        sign_bytes_version=sign_bytes_version,
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
    sign_bytes_version: str = "auto",
) -> Any:
    """Build, sign, and broadcast a ``MsgMigratePQCKey`` (rotate the PQC key).

    Rotates ``old_public_key`` to ``new_public_key`` under ``new_algorithm_id``,
    with ``old_signature`` / ``new_signature`` proving control of both keys. The
    tx is hybrid-signed when ``pqc_keypair`` is supplied (sign-bytes form per
    ``sign_bytes_version``, default ``"auto"``), else classical.

    Pass ``pqc_keypair`` - the CURRENTLY registered key. From chain v3.2.3 (and
    in the mempool of every v3.2.3 node) an account that has a PQC key must send
    ``MsgMigratePQCKey`` with the hybrid signature; a classical one is refused
    (``pqc`` 234).
    Returns the decoded broadcast response.

    ``old_signature`` / ``new_signature`` are signatures over the key-migration
    sign-bytes; build those with :func:`qorsdk.signbytes.migration_sign_bytes`
    in the form the network verifies.
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
        sign_bytes_version=sign_bytes_version,
    )


__all__ = [
    "HYBRID_KEY_TYPE",
    "DILITHIUM5_KEY_TYPE",
    "PqcStatus",
    "EnsureResult",
    "PqcKeyMismatchError",
    "pqc_status_public_key",
    "is_registered_pqc_key",
    "get_pqc_status",
    "fetch_pqc_status",
    "clear_pqc_status_cache",
    "is_pqc_registered",
    "get_pqc_status_async",
    "is_pqc_registered_async",
    "build_register_pqc_key",
    "build_migrate_pqc_key",
    "ensure_pqc_registered",
    "migrate_to_hybrid",
    "migrate_pqc_key",
]
