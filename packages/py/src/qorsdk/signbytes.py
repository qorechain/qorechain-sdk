"""Per-network post-quantum sign-bytes (v1 / v2) for QoreChain.

Chain release ``v3.2.0`` (taken by the testnet under the earlier name
``v3.1.98``) changed the exact bytes an ML-DSA-87 key signs for three payloads.
Each network verifies exactly ONE form at any height (there is no overlap
window, by design), and the two public networks switch at different times, so a
client must sign the form the TARGET network verifies right now.

Byte layouts (all lengths big-endian, strings UTF-8, no terminators):

Hybrid tx (``B0`` = ``TxBody`` WITHOUT the PQC extension, ``A`` = ``AuthInfo``)::

    v1: BE32(len B0) ‖ B0 ‖ BE32(len A) ‖ A
    v2: "qorechain-pqc-hybrid-v2" ‖ BE64(len chainID) ‖ chainID ‖
        BE32(len B0) ‖ B0 ‖ BE32(len A) ‖ A

PQC key migration::

    v1: "qorechain-key-migration:chain=%s:from=%d:to=%d:account=%s:height=%d"
    v2: "qorechain-key-migration-v2" ‖ BE64(len chainID) ‖ chainID ‖
        BE64(len account) ‖ account ‖ BE32(from) ‖ BE32(to) ‖ BE64(height) ‖
        BE32(len oldPub) ‖ oldPub ‖ BE32(len newPub) ‖ newPub

Bridge attestation::

    v1: chain|eventType|operationID|txHash|amount|asset   (no chain-id)
    v2: "qorechain-bridge-attestation-v2" ‖ for f in [chainID, chain, eventType,
        operationID, txHash, amount, asset]: BE64(len f) ‖ f

v2 adds a domain tag (so a signature made in another context, e.g. a login
challenge, can never be valid as a tx signature) and binds the chain-id (so the
post-quantum signature itself refuses to verify on another network).

Choosing the form (:func:`sign_bytes_version_for`, mirroring the chain's
``SignBytesVersionFor``): v2 if the v2 upgrade plan has been applied
(height > 0) OR the chain is not one of the networks that existed before v2
(``qorechain-vladi`` / ``qorechain-diana``); otherwise v1.

The switch shipped under TWO plan names (:data:`SIGN_BYTES_V2_UPGRADES`): the
testnet took it as ``v3.1.98`` and keeps that record forever, while mainnet
takes it as ``v3.2.0``. Both names run the same handler, so a client must ask
``GET {rest}/cosmos/upgrade/v1beta1/applied_plan/{name}`` for EVERY name and use
v2 when the numeric height of ANY of them is above 0. :class:`SignBytesResolver`
does that (in the order of :data:`SIGN_BYTES_V2_UPGRADES`, stopping at the first
positive height) with a short cache, because a network can upgrade while a
wallet is open. If the answer cannot be obtained for a legacy network,
resolution fails loudly: the SDK never guesses.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any, Literal

import httpx

#: Domain tag prefixed to the v2 hybrid tx sign-bytes.
HYBRID_SIGN_BYTES_DOMAIN = "qorechain-pqc-hybrid-v2"
#: Domain tag prefixed to the v2 PQC key-migration sign-bytes.
MIGRATION_SIGN_BYTES_DOMAIN = "qorechain-key-migration-v2"
#: Domain tag prefixed to the v2 bridge-attestation sign-bytes.
BRIDGE_ATTESTATION_SIGN_BYTES_DOMAIN = "qorechain-bridge-attestation-v2"

#: The coordinated upgrade whose handler switches a pre-existing chain to v2,
#: under its primary (mainnet) name. See :data:`SIGN_BYTES_V2_UPGRADES`.
SIGN_BYTES_V2_UPGRADE = "v3.2.0"

#: EVERY upgrade name that switches a network to v2, in query order. The same
#: handler ships under both: mainnet applies ``v3.2.0``, the testnet already
#: applied ``v3.1.98`` and keeps that record forever. A client must ask
#: ``applied_plan`` for each name and use v2 if ANY of them has a height above
#: 0; asking for one name only picks v1 on the other network and every hybrid
#: transaction is then refused with ``pqc`` code 21.
SIGN_BYTES_V2_UPGRADES: tuple[str, ...] = ("v3.2.0", "v3.1.98")

#: Networks that existed before v2 and switch to it only at one of
#: :data:`SIGN_BYTES_V2_UPGRADES`. Every other chain verifies v2 from block one.
LEGACY_SIGN_BYTES_CHAINS: frozenset[str] = frozenset({"qorechain-vladi", "qorechain-diana"})

#: Default resolver cache lifetime, in seconds.
DEFAULT_SIGN_BYTES_CACHE_TTL = 60.0

#: The pqc codespace / code the chain answers when the hybrid signature fails.
HYBRID_REJECTION_CODESPACE = "pqc"
HYBRID_REJECTION_CODE = 21
HYBRID_REJECTION_MESSAGE = "hybrid PQC signature verification failed"

#: A concrete sign-bytes form.
SignBytesVersion = Literal["v1", "v2"]
#: A sign-bytes choice: a concrete form, or ``"auto"`` (ask the network).
SignBytesOption = Literal["auto", "v1", "v2"]

_OPTIONS: tuple[str, ...] = ("auto", "v1", "v2")


class SignBytesVersionError(Exception):
    """The sign-bytes form for a network could not be determined.

    Raised instead of guessing: pass ``rest_url`` so the SDK can ask the node, or
    pass an explicit ``sign_bytes_version="v1"`` / ``"v2"``.
    """


# --------------------------------------------------------------------------- #
# encoding helpers
# --------------------------------------------------------------------------- #


def _be32(n: int) -> bytes:
    return int(n).to_bytes(4, "big")


def _be64(n: int) -> bytes:
    return int(n).to_bytes(8, "big")


def _utf8(s: str) -> bytes:
    return s.encode("utf-8")


def _check_version(version: str) -> SignBytesVersion:
    if version == "v1":
        return "v1"
    if version == "v2":
        return "v2"
    raise ValueError(f"sign-bytes version must be 'v1' or 'v2', got {version!r}")


def _check_option(option: str) -> SignBytesOption:
    if option not in _OPTIONS:
        raise ValueError(f"sign_bytes_version must be 'auto', 'v1' or 'v2', got {option!r}")
    return option  # type: ignore[return-value]


# --------------------------------------------------------------------------- #
# hybrid tx sign-bytes
# --------------------------------------------------------------------------- #


def hybrid_sign_bytes_v1(body_without_pqc_ext: bytes, auth_info: bytes) -> bytes:
    """v1 hybrid sign-bytes: ``BE32(len B0) ‖ B0 ‖ BE32(len A) ‖ A``."""
    b0, a = bytes(body_without_pqc_ext), bytes(auth_info)
    return _be32(len(b0)) + b0 + _be32(len(a)) + a


def hybrid_sign_bytes_v2(chain_id: str, body_without_pqc_ext: bytes, auth_info: bytes) -> bytes:
    """v2 hybrid sign-bytes: domain ‖ BE64(len chainID) ‖ chainID ‖ v1 frame."""
    cid = _utf8(chain_id)
    return (
        _utf8(HYBRID_SIGN_BYTES_DOMAIN)
        + _be64(len(cid))
        + cid
        + hybrid_sign_bytes_v1(body_without_pqc_ext, auth_info)
    )


def hybrid_sign_bytes(
    version: SignBytesVersion,
    chain_id: str,
    body_without_pqc_ext: bytes,
    auth_info: bytes,
) -> bytes:
    """The hybrid tx sign-bytes in the given form (``chain_id`` is unused by v1)."""
    if _check_version(version) == "v2":
        return hybrid_sign_bytes_v2(chain_id, body_without_pqc_ext, auth_info)
    return hybrid_sign_bytes_v1(body_without_pqc_ext, auth_info)


# --------------------------------------------------------------------------- #
# PQC key-migration sign-bytes
# --------------------------------------------------------------------------- #


def migration_sign_bytes_v1(
    chain_id: str,
    account: str,
    from_algorithm_id: int,
    to_algorithm_id: int,
    execution_height: int,
) -> bytes:
    """v1 (legacy ASCII) key-migration sign-bytes."""
    return _utf8(
        f"qorechain-key-migration:chain={chain_id}:from={int(from_algorithm_id)}"
        f":to={int(to_algorithm_id)}:account={account}:height={int(execution_height)}"
    )


def migration_sign_bytes_v2(
    chain_id: str,
    account: str,
    from_algorithm_id: int,
    to_algorithm_id: int,
    execution_height: int,
    old_public_key: bytes,
    new_public_key: bytes,
) -> bytes:
    """v2 key-migration sign-bytes (binds both public keys)."""
    cid, acct = _utf8(chain_id), _utf8(account)
    old, new = bytes(old_public_key), bytes(new_public_key)
    return (
        _utf8(MIGRATION_SIGN_BYTES_DOMAIN)
        + _be64(len(cid))
        + cid
        + _be64(len(acct))
        + acct
        + _be32(from_algorithm_id)
        + _be32(to_algorithm_id)
        + _be64(execution_height)
        + _be32(len(old))
        + old
        + _be32(len(new))
        + new
    )


def migration_sign_bytes(
    version: SignBytesVersion,
    chain_id: str,
    account: str,
    from_algorithm_id: int,
    to_algorithm_id: int,
    execution_height: int,
    old_public_key: bytes | None = None,
    new_public_key: bytes | None = None,
) -> bytes:
    """The key-migration sign-bytes in the given form.

    :raises ValueError: For v2 when either public key is missing.
    """
    if _check_version(version) == "v1":
        return migration_sign_bytes_v1(
            chain_id, account, from_algorithm_id, to_algorithm_id, execution_height
        )
    if old_public_key is None or new_public_key is None:
        raise ValueError("v2 migration sign-bytes require old_public_key and new_public_key")
    return migration_sign_bytes_v2(
        chain_id,
        account,
        from_algorithm_id,
        to_algorithm_id,
        execution_height,
        old_public_key,
        new_public_key,
    )


# --------------------------------------------------------------------------- #
# bridge attestation sign-bytes
# --------------------------------------------------------------------------- #


def bridge_attestation_sign_bytes_v1(
    chain: str,
    event_type: str,
    operation_id: str,
    tx_hash: str,
    amount: str | int,
    asset: str,
) -> bytes:
    """v1 (legacy ASCII, pipe-joined, no chain-id) bridge-attestation sign-bytes."""
    return _utf8("|".join([chain, event_type, operation_id, tx_hash, str(amount), asset]))


def bridge_attestation_sign_bytes_v2(
    chain_id: str,
    chain: str,
    event_type: str,
    operation_id: str,
    tx_hash: str,
    amount: str | int,
    asset: str,
) -> bytes:
    """v2 bridge-attestation sign-bytes (domain tag, BE64-prefixed fields)."""
    out = bytearray(_utf8(BRIDGE_ATTESTATION_SIGN_BYTES_DOMAIN))
    for field in (chain_id, chain, event_type, operation_id, tx_hash, str(amount), asset):
        raw = _utf8(field)
        out += _be64(len(raw))
        out += raw
    return bytes(out)


def bridge_attestation_sign_bytes(
    version: SignBytesVersion,
    chain_id: str,
    chain: str,
    event_type: str,
    operation_id: str,
    tx_hash: str,
    amount: str | int,
    asset: str,
) -> bytes:
    """The bridge-attestation sign-bytes in the given form (v1 ignores ``chain_id``)."""
    if _check_version(version) == "v2":
        return bridge_attestation_sign_bytes_v2(
            chain_id, chain, event_type, operation_id, tx_hash, amount, asset
        )
    return bridge_attestation_sign_bytes_v1(chain, event_type, operation_id, tx_hash, amount, asset)


# --------------------------------------------------------------------------- #
# version selection
# --------------------------------------------------------------------------- #


def is_legacy_sign_bytes_chain(chain_id: str) -> bool:
    """True for networks that existed before v2 (they switch at the upgrade)."""
    return chain_id in LEGACY_SIGN_BYTES_CHAINS


def _upgrade_names() -> str:
    """``SIGN_BYTES_V2_UPGRADES`` as ``"v3.2.0 or v3.1.98"``, for error messages."""
    return " or ".join(SIGN_BYTES_V2_UPGRADES)


def sign_bytes_version_for(chain_id: str, v2_applied_height: int) -> SignBytesVersion:
    """The form ``chain_id`` verifies, given the height the v2 upgrade was applied at.

    Mirror of the chain's ``SignBytesVersionFor``: v2 if the upgrade has been
    applied (height > 0) or the chain is not a legacy network; else v1. The
    height is the greatest one any of :data:`SIGN_BYTES_V2_UPGRADES` answers.
    """
    if int(v2_applied_height) > 0 or not is_legacy_sign_bytes_chain(chain_id):
        return "v2"
    return "v1"


def pick_build_sign_bytes_version(
    chain_id: str, sign_bytes_version: str | None
) -> SignBytesVersion:
    """Pick the form for a synchronous (network-free) tx builder.

    An explicit ``"v1"`` / ``"v2"`` is used as-is. When omitted (or ``"auto"``),
    a non-legacy chain is v2 by definition; a legacy chain raises
    :class:`SignBytesVersionError` rather than silently defaulting, because the
    answer depends on the network's current height.
    """
    if sign_bytes_version is not None and sign_bytes_version != "auto":
        return _check_version(sign_bytes_version)
    if not is_legacy_sign_bytes_chain(chain_id):
        return "v2"
    raise SignBytesVersionError(
        f"{chain_id} verifies either v1 or v2 hybrid sign-bytes depending on whether "
        f"upgrade {_upgrade_names()} has been applied; pass sign_bytes_version='v1' "
        "or 'v2' (resolve it first with resolve_sign_bytes_version(chain_id, rest_url=...))"
    )


def _parse_applied_height(data: Any) -> int:
    if not isinstance(data, dict):
        raise ValueError(f"unexpected applied_plan response: {data!r}")
    raw = data.get("height")
    if raw is None or raw == "":
        return 0
    return int(raw)


def applied_plan_url(rest_url: str, plan_name: str = SIGN_BYTES_V2_UPGRADE) -> str:
    """The ``applied_plan`` endpoint for one upgrade name (default: the primary).

    The resolver asks this for every name in :data:`SIGN_BYTES_V2_UPGRADES`.
    """
    return f"{rest_url.rstrip('/')}/cosmos/upgrade/v1beta1/applied_plan/{plan_name}"


def _missing_rest_url_error(chain_id: str) -> SignBytesVersionError:
    return SignBytesVersionError(
        f"cannot resolve the sign-bytes form for {chain_id} without a node: pass rest_url "
        "or an explicit sign_bytes_version='v1' / 'v2'"
    )


def _query_failed_error(
    chain_id: str, rest_url: str, plan_name: str, err: BaseException
) -> SignBytesVersionError:
    return SignBytesVersionError(
        f"cannot ask {rest_url} whether {plan_name} is applied on {chain_id} "
        f"(the v2 sign-bytes upgrade ships as {_upgrade_names()}) ({err}); "
        "pass an explicit sign_bytes_version='v1' / 'v2'"
    )


class SignBytesResolver:
    """Resolves ``"auto"`` to the form a network verifies, with a short cache.

    A lookup asks ``applied_plan`` for every name in
    :data:`SIGN_BYTES_V2_UPGRADES`, in order, and stops at the first positive
    height: mainnet (``v3.2.0``) costs one request, the testnet (``v3.1.98``)
    two, and a chain on neither name two.

    Answers are cached per ``(rest_url, chain_id)`` for ``ttl`` seconds (default
    60), not for a whole session, because a network can upgrade while a wallet
    is open. ``force_refresh=True`` bypasses the cache; :meth:`clear` empties it.
    """

    def __init__(
        self,
        *,
        ttl: float = DEFAULT_SIGN_BYTES_CACHE_TTL,
        clock: Callable[[], float] = time.monotonic,
        timeout: float = 10.0,
    ) -> None:
        self.ttl = float(ttl)
        self._clock = clock
        self._timeout = timeout
        self._cache: dict[tuple[str, str], tuple[SignBytesVersion, float]] = {}

    def clear(self) -> None:
        """Forget every cached answer."""
        self._cache.clear()

    def invalidate(self, rest_url: str, chain_id: str) -> None:
        """Forget the cached answer for one ``(rest_url, chain_id)``."""
        self._cache.pop((rest_url.rstrip("/"), chain_id), None)

    def _pre(
        self, chain_id: str, rest_url: str | None, sign_bytes_version: str, force_refresh: bool
    ) -> SignBytesVersion | None:
        option = _check_option(sign_bytes_version)
        if option != "auto":
            return _check_version(option)
        if not is_legacy_sign_bytes_chain(chain_id):
            return "v2"
        if not rest_url:
            raise _missing_rest_url_error(chain_id)
        if not force_refresh:
            hit = self._cache.get((rest_url.rstrip("/"), chain_id))
            if hit is not None and hit[1] > self._clock():
                return hit[0]
        return None

    def _store(self, rest_url: str, chain_id: str, height: int) -> SignBytesVersion:
        version = sign_bytes_version_for(chain_id, height)
        self._cache[(rest_url.rstrip("/"), chain_id)] = (version, self._clock() + self.ttl)
        return version

    def resolve(
        self,
        chain_id: str,
        *,
        rest_url: str | None = None,
        sign_bytes_version: str = "auto",
        force_refresh: bool = False,
        client: httpx.Client | None = None,
    ) -> SignBytesVersion:
        """Resolve ``sign_bytes_version`` (``"auto"`` | ``"v1"`` | ``"v2"``) for ``chain_id``.

        :raises SignBytesVersionError: For a legacy chain when ``rest_url`` is
            missing or the node cannot be queried.
        """
        pre = self._pre(chain_id, rest_url, sign_bytes_version, force_refresh)
        if pre is not None:
            return pre
        assert rest_url is not None
        owns = client is None
        http = client or httpx.Client(timeout=self._timeout)
        try:
            height = 0
            # Every name that switched a network to v2; any positive height wins.
            for plan_name in SIGN_BYTES_V2_UPGRADES:
                try:
                    resp = http.get(applied_plan_url(rest_url, plan_name))
                    resp.raise_for_status()
                    height = _parse_applied_height(resp.json())
                except Exception as err:  # noqa: BLE001 - any failure means "unknown"
                    raise _query_failed_error(chain_id, rest_url, plan_name, err) from err
                if height > 0:
                    break
        finally:
            if owns:
                http.close()
        return self._store(rest_url, chain_id, height)

    async def resolve_async(
        self,
        chain_id: str,
        *,
        rest_url: str | None = None,
        sign_bytes_version: str = "auto",
        force_refresh: bool = False,
        client: httpx.AsyncClient | None = None,
    ) -> SignBytesVersion:
        """Async variant of :meth:`resolve`."""
        pre = self._pre(chain_id, rest_url, sign_bytes_version, force_refresh)
        if pre is not None:
            return pre
        assert rest_url is not None
        owns = client is None
        http = client or httpx.AsyncClient(timeout=self._timeout)
        try:
            height = 0
            # Every name that switched a network to v2; any positive height wins.
            for plan_name in SIGN_BYTES_V2_UPGRADES:
                try:
                    resp = await http.get(applied_plan_url(rest_url, plan_name))
                    resp.raise_for_status()
                    height = _parse_applied_height(resp.json())
                except Exception as err:  # noqa: BLE001 - any failure means "unknown"
                    raise _query_failed_error(chain_id, rest_url, plan_name, err) from err
                if height > 0:
                    break
        finally:
            if owns:
                await http.aclose()
        return self._store(rest_url, chain_id, height)


#: The process-wide resolver used by the module-level helpers.
default_sign_bytes_resolver = SignBytesResolver()


def resolve_sign_bytes_version(
    chain_id: str,
    *,
    rest_url: str | None = None,
    sign_bytes_version: str = "auto",
    force_refresh: bool = False,
    client: httpx.Client | None = None,
) -> SignBytesVersion:
    """Resolve the sign-bytes form via :data:`default_sign_bytes_resolver`."""
    return default_sign_bytes_resolver.resolve(
        chain_id,
        rest_url=rest_url,
        sign_bytes_version=sign_bytes_version,
        force_refresh=force_refresh,
        client=client,
    )


async def resolve_sign_bytes_version_async(
    chain_id: str,
    *,
    rest_url: str | None = None,
    sign_bytes_version: str = "auto",
    force_refresh: bool = False,
    client: httpx.AsyncClient | None = None,
) -> SignBytesVersion:
    """Async variant of :func:`resolve_sign_bytes_version`."""
    return await default_sign_bytes_resolver.resolve_async(
        chain_id,
        rest_url=rest_url,
        sign_bytes_version=sign_bytes_version,
        force_refresh=force_refresh,
        client=client,
    )


def clear_sign_bytes_cache() -> None:
    """Empty the cache of :data:`default_sign_bytes_resolver`."""
    default_sign_bytes_resolver.clear()


# --------------------------------------------------------------------------- #
# rejection detection
# --------------------------------------------------------------------------- #


def _matches(codespace: Any, code: Any, text: Any) -> bool:
    try:
        code_ok = code is not None and int(code) == HYBRID_REJECTION_CODE
    except (TypeError, ValueError):
        code_ok = False
    if codespace == HYBRID_REJECTION_CODESPACE and code_ok:
        return True
    return isinstance(text, str) and HYBRID_REJECTION_MESSAGE in text


def is_hybrid_signature_rejection(result: Any) -> bool:
    """True if ``result`` is the chain refusing the hybrid PQC signature.

    Matches ``codespace == "pqc" and code == 21``, or a log / message containing
    ``"hybrid PQC signature verification failed"``. Code 21 from any other
    codespace (e.g. ``sdk`` 21 = tx too large) does NOT match.

    Accepts a broadcast response dict (``{"tx_response": {...}}`` or the inner
    object), an exception carrying ``codespace`` / ``code`` / ``raw_log`` (such as
    :class:`~qorsdk.errors.QoreTxError`), an ``httpx.HTTPStatusError`` (its body is
    inspected), or a plain string.
    """
    if result is None:
        return False
    if isinstance(result, str):
        return _matches(None, None, result)
    if isinstance(result, dict):
        inner = result.get("tx_response")
        if isinstance(inner, dict) and is_hybrid_signature_rejection(inner):
            return True
        return _matches(
            result.get("codespace"),
            result.get("code"),
            " ".join(
                str(result.get(k)) for k in ("raw_log", "log", "message") if result.get(k)
            ),
        )
    if isinstance(result, BaseException):
        if _matches(
            getattr(result, "codespace", None),
            getattr(result, "code", None),
            " ".join(
                str(x) for x in (getattr(result, "raw_log", None), str(result)) if x
            ),
        ):
            return True
        if isinstance(result, httpx.HTTPStatusError):
            try:
                body = result.response.json()
            except Exception:  # noqa: BLE001 - non-JSON body
                return _matches(None, None, result.response.text)
            return is_hybrid_signature_rejection(body)
        return False
    return _matches(
        getattr(result, "codespace", None),
        getattr(result, "code", None),
        getattr(result, "raw_log", None),
    )


__all__ = [
    "HYBRID_SIGN_BYTES_DOMAIN",
    "MIGRATION_SIGN_BYTES_DOMAIN",
    "BRIDGE_ATTESTATION_SIGN_BYTES_DOMAIN",
    "SIGN_BYTES_V2_UPGRADE",
    "SIGN_BYTES_V2_UPGRADES",
    "LEGACY_SIGN_BYTES_CHAINS",
    "DEFAULT_SIGN_BYTES_CACHE_TTL",
    "HYBRID_REJECTION_CODESPACE",
    "HYBRID_REJECTION_CODE",
    "HYBRID_REJECTION_MESSAGE",
    "SignBytesVersion",
    "SignBytesOption",
    "SignBytesVersionError",
    "hybrid_sign_bytes_v1",
    "hybrid_sign_bytes_v2",
    "hybrid_sign_bytes",
    "migration_sign_bytes_v1",
    "migration_sign_bytes_v2",
    "migration_sign_bytes",
    "bridge_attestation_sign_bytes_v1",
    "bridge_attestation_sign_bytes_v2",
    "bridge_attestation_sign_bytes",
    "is_legacy_sign_bytes_chain",
    "applied_plan_url",
    "sign_bytes_version_for",
    "pick_build_sign_bytes_version",
    "SignBytesResolver",
    "default_sign_bytes_resolver",
    "resolve_sign_bytes_version",
    "resolve_sign_bytes_version_async",
    "clear_sign_bytes_cache",
    "is_hybrid_signature_rejection",
]
