"""PQC key registration integrity (chain v3.2.3).

From v3.2.3 the chain refuses a registration that protects nothing, and accepts
proof that the registrant holds the key's secret:

- ``key_type="classical_only"`` registers no post-quantum key, and the account
  could then never sign a transaction again;
- an empty public key;
- a degenerate ML-DSA-87 key, whose ``t1`` part (every byte after the 32-byte
  ``rho``) is zero: anyone can forge signatures for it;
- ``proof_of_possession`` (optional now, to become mandatory): the key's own
  ML-DSA signature over
  ``"qorechain-pqc-pop-v1|<chain-id>|<algorithm>|<account>|<hex(public key)>"``,
  lower-case hex, deterministic, empty context - like every SDK signature.

Also from v3.2.3: an account that already has a key must send
``MsgRegisterPQCKeyV2`` / ``MsgMigratePQCKey`` with the hybrid signature (only the
repair of a record holding no usable key may go classically), a rotation or
migration to a key the account used before is refused, and none of the
key-management messages may travel inside authz ``MsgExec``.

``proof_of_possession`` is a new field: a node below v3.2.3 refuses the whole
transaction when it is set. Attach it only when the network accepts it, which
:func:`should_attach_proof_of_possession` decides:

* the protocol feature ``pqc-possession-flag``
  (:data:`PQC_POSSESSION_FEATURE`) is listed: attach when it is enabled, do not
  when it is disabled, and no upgrade plan is asked;
* the node definitively does not serve it (HTTP 404 or 501, an empty feature
  list, or that feature absent): attach once the network has applied v3.2.3
  (:func:`qorsdk.upgrades.is_upgrade_applied` with ``CHAIN_UPGRADE_V3_2_3``);
* the node could not be asked (transport error, timeout, another HTTP status,
  a body that is not the expected JSON): :class:`ProofOfPossessionDecisionError`.
  There is no fallback in that case: a fork or fresh devnet answers the v3.2.3
  plan with height 0 while accepting the field.
"""

from __future__ import annotations

import time
from collections.abc import Callable

import httpx

from .pqc import PqcKeypair, pqc_sign, pqc_verify
from .protocol_features import (
    FeatureLookup,
    ProtocolFeatureQueryError,
    lookup_protocol_feature,
    lookup_protocol_feature_async,
)
from .rest import AsyncRestClient, RestClient
from .upgrades import (
    CHAIN_UPGRADE_V3_2_3,
    applied_plan_path,
    is_upgrade_applied,
    parse_applied_height,
)

#: Size of an ML-DSA-87 public key.
ML_DSA_87_PUBLIC_KEY_LENGTH = 2592

#: The key type the chain refuses from v3.2.3.
KEY_TYPE_CLASSICAL_ONLY = "classical_only"

#: Domain of the proof-of-possession sign-bytes.
PROOF_OF_POSSESSION_DOMAIN = "qorechain-pqc-pop-v1"

_RHO_LENGTH = 32


def is_degenerate_pqc_public_key(public_key: bytes) -> bool:
    """True for an ML-DSA-87 public key nobody needs a secret for: right length,
    every byte after ``rho`` zero. Keys of another length are not judged."""
    if len(public_key) != ML_DSA_87_PUBLIC_KEY_LENGTH:
        return False
    return not any(public_key[_RHO_LENGTH:])


def validate_registered_pqc_key(key_type: str | None, public_key: bytes) -> None:
    """Refuse a registration the chain refuses from v3.2.3. Not network-gated:
    such a registration protects nothing, or locks the account, on any network.

    :raises ValueError: Naming the reason.
    """
    if key_type == KEY_TYPE_CLASSICAL_ONLY:
        raise ValueError(
            'key_type "classical_only" registers no post-quantum key; the account '
            "would be unable to sign any transaction afterwards"
        )
    if not public_key:
        raise ValueError("a post-quantum public key is required")
    if is_degenerate_pqc_public_key(public_key):
        raise ValueError("the key's t1 part is all zero, so anyone can forge its signatures")


def proof_of_possession_sign_bytes(
    *, chain_id: str, account: str, public_key: bytes, algorithm_id: int = 1
) -> bytes:
    """The bytes the key being registered signs to prove its owner holds the
    secret. They name the chain, the algorithm, the account and the key."""
    if not chain_id:
        raise ValueError("chain_id is required")
    if not account:
        raise ValueError("account is required")
    return (
        f"{PROOF_OF_POSSESSION_DOMAIN}|{chain_id}|{algorithm_id}|{account}|"
        f"{public_key.hex()}"
    ).encode()


def sign_proof_of_possession(
    *, chain_id: str, account: str, keypair: PqcKeypair, algorithm_id: int = 1
) -> bytes:
    """Sign the proof of possession with the key being registered (deterministic
    ML-DSA-87, empty context). Pass it as ``proof_of_possession`` to the
    registration builder - only on a network that has applied v3.2.3."""
    return pqc_sign(
        keypair.secret_key,
        proof_of_possession_sign_bytes(
            chain_id=chain_id,
            account=account,
            public_key=keypair.public_key,
            algorithm_id=algorithm_id,
        ),
    )


def verify_proof_of_possession(
    *, chain_id: str, account: str, public_key: bytes, proof: bytes, algorithm_id: int = 1
) -> bool:
    """Verify a proof of possession locally, as the chain will."""
    try:
        return pqc_verify(
            public_key,
            proof_of_possession_sign_bytes(
                chain_id=chain_id,
                account=account,
                public_key=public_key,
                algorithm_id=algorithm_id,
            ),
            proof,
        )
    except Exception:
        return False


# --------------------------------------------------------------------------- #
# whether to attach the proof to a registration
# --------------------------------------------------------------------------- #

#: The protocol feature switch under which the chain accepts ``proof_of_possession``.
PQC_POSSESSION_FEATURE = "pqc-possession-flag"

#: Default lifetime of a cached decision, in seconds.
DEFAULT_POSSESSION_CACHE_TTL = 60.0


class ProofOfPossessionDecisionError(ProtocolFeatureQueryError):
    """The network could not be asked whether it accepts ``proof_of_possession``.

    Raised instead of guessing: retry, or pass the choice explicitly
    (``attach_proof_of_possession=True`` / ``False``, or the proof itself).
    """


def _possession_unreachable_error(
    chain_id: str, rest_url: str, lookup: FeatureLookup
) -> ProofOfPossessionDecisionError:
    return ProofOfPossessionDecisionError(
        f"cannot ask {rest_url} for its protocol features to decide whether {chain_id} "
        f"accepts a PQC proof of possession ({lookup.detail}); the network could not be "
        "asked, so the SDK does not guess from the upgrade plans. Retry, or pass "
        "attach_proof_of_possession=True / False explicitly"
    )


class ProofOfPossessionResolver:
    """Decides whether a ``MsgRegisterPQCKeyV2`` carries ``proof_of_possession``.

    Reads :data:`PQC_POSSESSION_FEATURE` first; falls back to the v3.2.3 upgrade
    plan only when the node definitively does not serve the feature; raises
    :class:`ProofOfPossessionDecisionError` when the node could not be asked.
    Successful answers are cached per ``(rest_url, chain_id)`` for ``ttl``
    seconds (default 60); failures are never cached.
    """

    def __init__(
        self,
        *,
        ttl: float = DEFAULT_POSSESSION_CACHE_TTL,
        clock: Callable[[], float] = time.monotonic,
        timeout: float = 10.0,
    ) -> None:
        self.ttl = float(ttl)
        self._clock = clock
        self._timeout = timeout
        self._cache: dict[tuple[str, str], tuple[bool, float]] = {}

    def clear(self) -> None:
        """Forget every cached answer."""
        self._cache.clear()

    def _cached(self, rest_url: str, chain_id: str, force_refresh: bool) -> bool | None:
        if force_refresh:
            return None
        hit = self._cache.get((rest_url.rstrip("/"), chain_id))
        if hit is not None and hit[1] > self._clock():
            return hit[0]
        return None

    def _store(self, rest_url: str, chain_id: str, attach: bool) -> bool:
        self._cache[(rest_url.rstrip("/"), chain_id)] = (attach, self._clock() + self.ttl)
        return attach

    def resolve(
        self,
        chain_id: str,
        rest_url: str,
        *,
        force_refresh: bool = False,
        client: httpx.Client | None = None,
    ) -> bool:
        """True when a registration on ``chain_id`` should carry the proof.

        :raises ProofOfPossessionDecisionError: When the protocol features
            cannot be asked. A failure of the fallback ``applied_plan`` query
            raises as :func:`qorsdk.upgrades.is_upgrade_applied` does.
        """
        hit = self._cached(rest_url, chain_id, force_refresh)
        if hit is not None:
            return hit
        owns = client is None
        http = client or httpx.Client(timeout=self._timeout)
        try:
            lookup = lookup_protocol_feature(http, rest_url, PQC_POSSESSION_FEATURE)
            if lookup.found:
                return self._store(rest_url, chain_id, lookup.enabled)
            if lookup.state == "error":
                raise _possession_unreachable_error(chain_id, rest_url, lookup)
            rest = RestClient(rest_url, client=http)
            applied = is_upgrade_applied(
                rest, CHAIN_UPGRADE_V3_2_3, cache_key=rest_url, fresh=force_refresh
            )
        finally:
            if owns:
                http.close()
        return self._store(rest_url, chain_id, applied)

    async def resolve_async(
        self,
        chain_id: str,
        rest_url: str,
        *,
        force_refresh: bool = False,
        client: httpx.AsyncClient | None = None,
    ) -> bool:
        """Async variant of :meth:`resolve`."""
        hit = self._cached(rest_url, chain_id, force_refresh)
        if hit is not None:
            return hit
        owns = client is None
        http = client or httpx.AsyncClient(timeout=self._timeout)
        try:
            lookup = await lookup_protocol_feature_async(http, rest_url, PQC_POSSESSION_FEATURE)
            if lookup.found:
                return self._store(rest_url, chain_id, lookup.enabled)
            if lookup.state == "error":
                raise _possession_unreachable_error(chain_id, rest_url, lookup)
            rest = AsyncRestClient(rest_url, client=http)
            height = parse_applied_height(await rest.get(applied_plan_path(CHAIN_UPGRADE_V3_2_3)))
        finally:
            if owns:
                await http.aclose()
        return self._store(rest_url, chain_id, height > 0)


#: The process-wide resolver used by :func:`should_attach_proof_of_possession`.
default_possession_resolver = ProofOfPossessionResolver()


def should_attach_proof_of_possession(
    chain_id: str,
    rest_url: str,
    *,
    force_refresh: bool = False,
    client: httpx.Client | None = None,
) -> bool:
    """Whether a PQC key registration on ``chain_id`` should carry the proof,
    via :data:`default_possession_resolver` (see the module docstring)."""
    return default_possession_resolver.resolve(
        chain_id, rest_url, force_refresh=force_refresh, client=client
    )


async def should_attach_proof_of_possession_async(
    chain_id: str,
    rest_url: str,
    *,
    force_refresh: bool = False,
    client: httpx.AsyncClient | None = None,
) -> bool:
    """Async variant of :func:`should_attach_proof_of_possession`."""
    return await default_possession_resolver.resolve_async(
        chain_id, rest_url, force_refresh=force_refresh, client=client
    )


def clear_possession_cache() -> None:
    """Empty the cache of :data:`default_possession_resolver`."""
    default_possession_resolver.clear()
