"""Post-quantum consent for EIP-7702 delegations (chain v3.2.2, ``x/pqc``).

An EIP-7702 authorization tuple installs code on the account that signed it, and
the tuple is signed with the classical secp256k1 key alone. Once the delegation
is installed, that code acts for the account. So from v3.2.2 the EVM lane admits
a type-4 transaction only if every account whose tuple would take effect holds a
registered post-quantum key AND has consented, with a Cosmos-lane message signed
by that key, to exactly the delegate the tuple names. Clearing a delegation (the
zero address) needs consent too.

How a delegation goes through
-----------------------------

1. Broadcast :func:`qorsdk.msg.pqc.authorize_evm_delegation` (Cosmos lane,
   hybrid signature). This ADVANCES the account's nonce: the Cosmos sequence and
   the EVM nonce are one counter.
2. Read :func:`get_evm_delegation_consent`. Its ``nonce`` is the account's EVM
   nonce NOW, after the consent.
3. Sign the authorization tuple with that nonce if someone else sponsors the
   type-4 transaction, or with ``nonce + 1`` if the account sends the type-4
   transaction itself (its own nonce is consumed first) -
   :func:`evm_delegation_tuple_nonce`.
4. Send the type-4 transaction. The sender still needs an open EVM window; a
   sponsor pays from its own.

The consent is used up by the transaction that installs the delegation, it
expires after ``blocks``, a new one replaces the old, and ``MsgCloseEVMWindow``
revokes it. :func:`qorsdk.msg.pqc.clear_evm_delegation` removes an installed
delegation directly, without any EVM transaction.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal, Protocol
from urllib.parse import quote

from .evm_window import MAX_EVM_WINDOW_BLOCKS

#: Type URL of the consent message.
AUTHORIZE_EVM_DELEGATION_TYPE_URL = "/qorechain.pqc.v1.MsgAuthorizeEVMDelegation"

#: Type URL of the direct clear message.
CLEAR_EVM_DELEGATION_TYPE_URL = "/qorechain.pqc.v1.MsgClearEVMDelegation"

#: The longest a consent may wait to be used, in blocks (the window's bound).
MAX_EVM_DELEGATION_CONSENT_BLOCKS = MAX_EVM_WINDOW_BLOCKS

#: The delegate to consent to when the intent is to CLEAR the delegation.
EVM_DELEGATION_CLEAR = "0x0000000000000000000000000000000000000000"

#: The most authorization tuples the EVM lane accepts in one type-4 transaction.
MAX_EVM_AUTHORIZATIONS_PER_TX = 8

#: ``pqc`` 60 - no live consent for the delegation a tuple would install.
ERR_NO_EVM_DELEGATION_CONSENT = 60

#: ``pqc`` 61 - a malformed consent or clear request, or no PQC key.
ERR_INVALID_EVM_DELEGATION = 61

_ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")


def validate_evm_delegation_consent(*, delegate: str, blocks: int) -> tuple[str, int]:
    """Check a consent request against the chain's rules.

    :returns: ``(delegate lower-cased, blocks)``. The chain compares the
        delegate case-insensitively; lower-casing keeps the message identical
        across clients.
    :raises ValueError: Naming the rule that was violated.
    """
    if not isinstance(delegate, str) or not _ADDRESS.match(delegate):
        raise ValueError(
            "delegate must be a 0x-prefixed 20-byte address (use EVM_DELEGATION_CLEAR "
            f"to consent to clearing), got {delegate!r}"
        )
    if not isinstance(blocks, int) or isinstance(blocks, bool):
        raise ValueError(f"blocks must be an integer, got {blocks!r}")
    if blocks < 1 or blocks > MAX_EVM_DELEGATION_CONSENT_BLOCKS:
        raise ValueError(
            f"blocks must be in 1..{MAX_EVM_DELEGATION_CONSENT_BLOCKS}, got {blocks}"
        )
    return delegate.lower(), blocks


def evm_delegation_consent_path(address: str) -> str:
    """The REST path of the consent query for ``address`` (``qor1…`` or 0x)."""
    return f"/qorechain/pqc/v1/evm_delegation_consent/{quote(address, safe='')}"


@dataclass(frozen=True)
class EVMDelegationConsent:
    """An account's delegation consent, and what a client needs to sign the tuple."""

    #: Whether a consent is stored. A stored consent may be expired.
    found: bool
    #: Whether it can still be used at the current height.
    live: bool
    #: The 0x address the consent names, lower case; zero address = clearing.
    delegate: str
    granted_height: int
    expiry_height: int
    #: The delegation installed on the account now; empty when there is none.
    current_delegate: str
    #: The account's EVM nonce now. A SPONSORED tuple carries this; one in the
    #: account's OWN type-4 transaction carries ``nonce + 1``.
    nonce: int


def _as_int(payload: Mapping[str, Any], field: str) -> int:
    raw = payload.get(field)
    if raw is None or raw == "":
        return 0
    if isinstance(raw, bool):
        raise ValueError(f"evm_delegation_consent field {field!r} is a boolean")
    if isinstance(raw, int):
        return raw
    if isinstance(raw, str):
        try:
            return int(raw.strip(), 10)
        except ValueError:
            raise ValueError(
                f"evm_delegation_consent field {field!r} is not an integer: {raw!r}"
            ) from None
    raise ValueError(f"evm_delegation_consent field {field!r} is not an integer: {raw!r}")


def parse_evm_delegation_consent(payload: Mapping[str, Any]) -> EVMDelegationConsent:
    """Parse the ``evm_delegation_consent`` REST payload."""
    delegate = payload.get("delegate")
    current = payload.get("current_delegate")
    return EVMDelegationConsent(
        found=payload.get("found") is True,
        live=payload.get("live") is True,
        delegate=delegate if isinstance(delegate, str) else "",
        granted_height=_as_int(payload, "granted_height"),
        expiry_height=_as_int(payload, "expiry_height"),
        current_delegate=current if isinstance(current, str) else "",
        nonce=_as_int(payload, "nonce"),
    )


class _RestGet(Protocol):
    def get(self, path: str, params: dict[str, Any] | None = ...) -> Any: ...


class _AsyncRestGet(Protocol):
    async def get(self, path: str, params: dict[str, Any] | None = ...) -> Any: ...


def get_evm_delegation_consent(rest: _RestGet, address: str) -> EVMDelegationConsent:
    """Read an account's delegation consent over REST.

    The endpoint exists from chain v3.2.2; an older node answers an HTTP error,
    which propagates rather than being read as "no consent".
    """
    return parse_evm_delegation_consent(rest.get(evm_delegation_consent_path(address)))


async def get_evm_delegation_consent_async(
    rest: _AsyncRestGet, address: str
) -> EVMDelegationConsent:
    """Asynchronous mirror of :func:`get_evm_delegation_consent`."""
    return parse_evm_delegation_consent(await rest.get(evm_delegation_consent_path(address)))


def evm_delegation_tuple_nonce(consent: EVMDelegationConsent, *, sponsored: bool) -> int:
    """The nonce an authorization tuple must carry, from a consent read AFTER the
    consent message was included.

    :param sponsored: ``True`` when another account sends the type-4 transaction.
    """
    return consent.nonce if sponsored else consent.nonce + 1


EVMDelegationErrorKind = Literal["no_consent", "invalid_delegation"]

_TEXTS: tuple[tuple[str, EVMDelegationErrorKind], ...] = (
    ("no post-quantum consent for this eip-7702 delegation", "no_consent"),
    ("invalid eip-7702 delegation request", "invalid_delegation"),
)


def classify_evm_delegation_error(
    *, code: int | None = None, codespace: str | None = None, message: str | None = None
) -> EVMDelegationErrorKind | None:
    """Classify a delegation refusal, or ``None`` when it is something else.

    The text is matched first: over EVM JSON-RPC only the text arrives.
    """
    if message:
        low = message.lower()
        for needle, kind in _TEXTS:
            if needle in low:
                return kind
    if codespace == "pqc":
        if code == ERR_NO_EVM_DELEGATION_CONSENT:
            return "no_consent"
        if code == ERR_INVALID_EVM_DELEGATION:
            return "invalid_delegation"
    return None
