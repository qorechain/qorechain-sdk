"""Abstract-account reads added in chain v3.2.5 (REST).

* :func:`fetch_spending_rules`: the rules stored for an account, the
  account-wide ones and the rule of every linked key that carries its own
  (``GET /qorechain/abstractaccount/v1/accounts/{address}/spending_rules``).
* :func:`fetch_authenticators`: the keys linked to an account, revoked ones
  included, with their permissions and expiry
  (``GET /qorechain/abstractaccount/v1/accounts/{address}/authenticators``).

v3.2.5 also serves ``/qorechain/abstractaccount/v1/params`` (the same answer as
``/config``) and ``/account/{address}`` (the same as ``/accounts/{address}``),
and the account view gains ``authenticators_count`` (linked keys not revoked).

Spending rules come back as plain dicts with the chain's snake_case fields, the
shape :func:`qorsdk.messages.spending_rules.validate_spending_rules` and
``msg.abstractaccount.update_spending_rules`` take.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import quote

#: REST path of the module configuration (``/params`` is an alias from v3.2.5).
ABSTRACT_ACCOUNT_CONFIG_PATH = "/qorechain/abstractaccount/v1/config"

#: Type URL of the governance message that replaces the configuration.
UPDATE_ABSTRACT_ACCOUNT_CONFIG_TYPE_URL = "/qorechain.abstractaccount.v1.MsgUpdateConfig"


def spending_rules_path(address: str) -> str:
    """The REST path of an account's spending rules."""
    return f"/qorechain/abstractaccount/v1/accounts/{quote(address, safe='')}/spending_rules"


def authenticators_path(address: str) -> str:
    """The REST path of an account's linked keys."""
    return f"/qorechain/abstractaccount/v1/accounts/{quote(address, safe='')}/authenticators"


@dataclass(frozen=True)
class AuthenticatorRule:
    """The rule a linked key carries itself."""

    scheme: str
    #: The key, hex encoded.
    pubkey_hex: str
    #: The rule (chain snake_case fields).
    rule: dict[str, Any]


@dataclass(frozen=True)
class SpendingRules:
    """An account's stored spending rules."""

    #: Account-wide rules in stored order; the first enabled one bounds every
    #: linked key without a rule of its own.
    rules: tuple[dict[str, Any], ...]
    #: Per-key rules.
    authenticator_rules: tuple[AuthenticatorRule, ...]


@dataclass(frozen=True)
class AuthenticatorView:
    """A key linked to an account."""

    scheme: str
    pubkey_hex: str
    permissions: tuple[str, ...]
    #: Unix seconds.
    expiry_unix: int
    label: str
    #: Unix seconds.
    created_at_unix: int
    revoked: bool
    #: Whether the key carries a rule of its own (see :func:`fetch_spending_rules`).
    has_spend_rule: bool


def _int(raw: Any, field: str) -> int:
    if raw is None or raw == "":
        return 0
    if isinstance(raw, bool):
        raise ValueError(f"abstractaccount field {field!r} is a boolean, expected an integer")
    if isinstance(raw, int):
        return raw
    if isinstance(raw, str):
        try:
            return int(raw.strip(), 10)
        except ValueError:
            raise ValueError(
                f"abstractaccount field {field!r} is not an integer: {raw!r}"
            ) from None
    raise ValueError(f"abstractaccount field {field!r} is not an integer: {raw!r}")


def _str(payload: Mapping[str, Any], field: str) -> str:
    raw = payload.get(field)
    return raw if isinstance(raw, str) else ""


def _list(payload: Any, field: str) -> list[Mapping[str, Any]]:
    raw = payload.get(field) if isinstance(payload, Mapping) else None
    return [x for x in raw if isinstance(x, Mapping)] if isinstance(raw, list) else []


def parse_spending_rules(payload: Mapping[str, Any]) -> SpendingRules:
    """Parse a ``spending_rules`` REST payload."""
    return SpendingRules(
        rules=tuple(dict(r) for r in _list(payload, "rules")),
        authenticator_rules=tuple(
            AuthenticatorRule(
                scheme=_str(a, "scheme"),
                pubkey_hex=_str(a, "pubkey_hex"),
                rule=dict(a["rule"]) if isinstance(a.get("rule"), Mapping) else {},
            )
            for a in _list(payload, "authenticator_rules")
        ),
    )


def parse_authenticators(payload: Mapping[str, Any]) -> tuple[AuthenticatorView, ...]:
    """Parse an ``authenticators`` REST payload."""
    out = []
    for a in _list(payload, "authenticators"):
        perms = a.get("permissions")
        out.append(
            AuthenticatorView(
                scheme=_str(a, "scheme"),
                pubkey_hex=_str(a, "pubkey_hex"),
                permissions=tuple(p for p in perms if isinstance(p, str))
                if isinstance(perms, list)
                else (),
                expiry_unix=_int(a.get("expiry_unix"), "expiry_unix"),
                label=_str(a, "label"),
                created_at_unix=_int(a.get("created_at_unix"), "created_at_unix"),
                revoked=a.get("revoked") is True,
                has_spend_rule=a.get("has_spend_rule") is True,
            )
        )
    return tuple(out)


class _RestGet(Protocol):
    def get(self, path: str, params: dict[str, Any] | None = ...) -> Any: ...


class _AsyncRestGet(Protocol):
    async def get(self, path: str, params: dict[str, Any] | None = ...) -> Any: ...


def fetch_spending_rules(rest: _RestGet, address: str) -> SpendingRules:
    """Read the spending rules stored for ``address`` (chain v3.2.5)."""
    return parse_spending_rules(rest.get(spending_rules_path(address)))


def fetch_authenticators(rest: _RestGet, address: str) -> tuple[AuthenticatorView, ...]:
    """Read the keys linked to ``address`` (chain v3.2.5)."""
    return parse_authenticators(rest.get(authenticators_path(address)))


async def fetch_spending_rules_async(rest: _AsyncRestGet, address: str) -> SpendingRules:
    """Asynchronous mirror of :func:`fetch_spending_rules`."""
    return parse_spending_rules(await rest.get(spending_rules_path(address)))


async def fetch_authenticators_async(
    rest: _AsyncRestGet, address: str
) -> tuple[AuthenticatorView, ...]:
    """Asynchronous mirror of :func:`fetch_authenticators`."""
    return parse_authenticators(await rest.get(authenticators_path(address)))


def validate_update_config(
    *,
    authority: str,
    max_session_keys: int,
    max_spending_rules: int,
    default_session_ttl: int,
) -> None:
    """The chain's checks on ``MsgUpdateConfig``: an authority, and positive
    ``max_session_keys``, ``max_spending_rules`` and ``default_session_ttl``
    (seconds), as in genesis.

    :raises ValueError: Naming the field.
    """
    if not authority:
        raise ValueError("update_config: authority (the governance module account) is required")
    for name, value in (
        ("max_session_keys", max_session_keys),
        ("max_spending_rules", max_spending_rules),
        ("default_session_ttl", default_session_ttl),
    ):
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise ValueError(f"update_config: {name} must be a positive integer, got {value!r}")


__all__ = [
    "ABSTRACT_ACCOUNT_CONFIG_PATH",
    "UPDATE_ABSTRACT_ACCOUNT_CONFIG_TYPE_URL",
    "spending_rules_path",
    "authenticators_path",
    "AuthenticatorRule",
    "SpendingRules",
    "AuthenticatorView",
    "parse_spending_rules",
    "parse_authenticators",
    "fetch_spending_rules",
    "fetch_authenticators",
    "fetch_spending_rules_async",
    "fetch_authenticators_async",
    "validate_update_config",
]
