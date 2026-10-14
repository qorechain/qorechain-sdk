"""v3.1.85 authenticator lanes (EVM + Native/Cosmos) and same-algorithm PQC key
rotation — the Python mirror of the canonical TypeScript SDK / wallet-adapter
``authenticator`` module.

v3.1.84 introduced the SVM authenticator lane. v3.1.85 adds two more lanes so a
linked external key (Phantom ed25519 / a secp256k1 key) can spend from the ONE
unified PQC-required account under least-privilege, spend-limited, revocable
terms — via a relayer, WITHOUT the external key ever producing an ML-DSA
co-signature:

* **EVM lane** — :func:`execute_evm_msg` / ``MsgExecuteEVM``: an EVM
  call/transfer FROM the account's ``0x`` address.
* **Native lane** — :func:`execute_cosmos_msg` / ``MsgExecuteCosmos``: a bank
  send FROM the account (Cosmos).

The relayer submits + pays fees (its own hybrid-PQC signature satisfies the ante
on the envelope); the authenticator's signature over the domain-separated,
replay-bound sign-bytes IS the authorization. The digests below are rebuilt
BYTE-FOR-BYTE from the chain (``x/abstractaccount/types/{evm,cosmos}_sign.go``) —
a mismatch is rejected on-chain (codespace ``abstractaccount``: code 11 replay /
10 permission / 5 spending-limit / 6 session-expired).

**Nonces.** ``MsgExecuteEVM.nonce`` and ``MsgExecuteCosmos.nonce`` are both the
per-authenticator sequence for ``(account, pubkey)``: a counter the chain keeps
for each linked key, starting at 0 and incremented by each successful execution.
For the EVM lane it is NOT the account's EVM nonce (the chain checks this counter
since v3.2.0). There is no query for it yet, so track it per linked key; a
mismatch is refused with abstractaccount code 11.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Any

from cosmpy.protos.cosmos.base.v1beta1.coin_pb2 import Coin
from dilithium_py.ml_dsa import ML_DSA_87

from .messages._composer import Msg
from .pqc import ALGORITHM_DILITHIUM5, PqcKeypair
from .proto.qorechain.abstractaccount.v1 import tx_pb2 as abstractaccount_tx
from .proto.qorechain.pqc.v1 import tx_pb2 as pqc_tx
from .unified import qore_addresses
from .upgrades import CHAIN_UPGRADE_V3_2_3, is_upgrade_applied

# --------------------------------------------------------------------------- #
# byte helpers (match the chain's binary.BigEndian + length-prefix framing)
# --------------------------------------------------------------------------- #

#: The type URLs the composers below emit.
EXECUTE_EVM_TYPE_URL = "/qorechain.abstractaccount.v1.MsgExecuteEVM"
EXECUTE_COSMOS_TYPE_URL = "/qorechain.abstractaccount.v1.MsgExecuteCosmos"
ROTATE_PQC_KEY_TYPE_URL = "/qorechain.pqc.v1.MsgRotatePQCKey"

#: The canonical (SDK / wallet-adapter) address-bound PQC derivation label.
CANONICAL_DERIVATION = "adapter"
#: The legacy (chain-bridge / faucet-api) mnemonic-only PQC derivation label.
LEGACY_DERIVATION = "bridge"


def be64(n: int) -> bytes:
    """Encode ``n`` as an 8-byte big-endian unsigned integer (chain framing)."""
    return int(n).to_bytes(8, "big")


def lp(data: bytes) -> bytes:
    """Length-prefix a field: ``BE64(len(data)) || data`` (chain framing)."""
    return be64(len(data)) + data


def _utf8(value: str) -> bytes:
    return value.encode("utf-8")


# --------------------------------------------------------------------------- #
# sign-bytes (the digest an authenticator signs) — BYTE-EXACT
# --------------------------------------------------------------------------- #


def evm_auth_sign_bytes(
    chain_id: str,
    account: str,
    pubkey: bytes,
    to: str = "",
    value: str = "0",
    data: bytes = b"",
    nonce: int = 0,
) -> bytes:
    """Rebuild the 32-byte digest the chain re-derives for a ``MsgExecuteEVM``.

    ``sha256("qorechain-evm-auth-v1" || LP(chain_id) || LP(account) || LP(pubkey)
    || LP(to) || LP(value) || LP(data) || BE64(nonce))``.

    ``to`` is the ``0x``-hex recipient string, ``value`` is the decimal wei
    (aqor) string, ``data`` is raw calldata, ``pubkey`` is the authenticator's
    raw public key (32 bytes for ed25519; the 20-byte eth address for
    secp256k1). Returns the 32 bytes the wallet signs.
    """
    body = (
        b"qorechain-evm-auth-v1"
        + lp(_utf8(chain_id))
        + lp(_utf8(account))
        + lp(pubkey)
        + lp(_utf8(to))
        + lp(_utf8(value))
        + lp(data)
        + be64(nonce)
    )
    return hashlib.sha256(body).digest()


def evm_auth_sign_bytes_v2(
    chain_id: str,
    account: str,
    pubkey: bytes,
    to: str = "",
    value: str = "0",
    data: bytes = b"",
    nonce: int = 0,
    *,
    gas_limit: int,
) -> bytes:
    """The v2 digest of a ``MsgExecuteEVM`` (chain v3.2.3,
    ``abstractaccount-hardening``).

    ``sha256("qorechain-evm-auth-v2" || LP(chain_id) || LP(account) || LP(pubkey)
    || LP(to) || LP(value) || LP(data) || BE64(nonce) || BE64(gas_limit))``.

    v1 left the gas limit to whoever relayed the message. The chain verifies
    exactly one form per block: v1 below the v3.2.3 upgrade, v2 from it — pick
    with :func:`evm_auth_digest_version`.

    :raises ValueError: If ``gas_limit`` is zero; the chain refuses it.
    """
    if gas_limit <= 0:
        raise ValueError(
            "gas_limit must be set (non-zero): the v2 digest binds it and the chain refuses 0"
        )
    body = (
        b"qorechain-evm-auth-v2"
        + lp(_utf8(chain_id))
        + lp(_utf8(account))
        + lp(pubkey)
        + lp(_utf8(to))
        + lp(_utf8(value))
        + lp(data)
        + be64(nonce)
        + be64(gas_limit)
    )
    return hashlib.sha256(body).digest()


def evm_auth_digest_version(rest: Any, *, cache_key: str | None = None) -> str:
    """The ``MsgExecuteEVM`` digest the network verifies now: ``"v2"`` once it
    has applied v3.2.3, ``"v1"`` before. Raises when the node cannot be asked —
    never guess, the other form is refused."""
    return "v2" if is_upgrade_applied(rest, CHAIN_UPGRADE_V3_2_3, cache_key=cache_key) else "v1"


def cosmos_auth_sign_bytes(
    chain_id: str,
    account: str,
    pubkey: bytes,
    to: str,
    amount: str,
    nonce: int,
) -> bytes:
    """Rebuild the 32-byte digest the chain re-derives for a ``MsgExecuteCosmos``.

    ``sha256("qorechain-cosmos-auth-v1" || LP(chain_id) || LP(account)
    || LP(pubkey) || LP(to) || LP(amount) || BE64(nonce))``.

    ``to`` is the bech32 recipient, ``amount`` is the canonical single-coin
    ``sdk.Coins`` string (e.g. ``"100uqor"``). Returns 32 bytes.
    """
    body = (
        b"qorechain-cosmos-auth-v1"
        + lp(_utf8(chain_id))
        + lp(_utf8(account))
        + lp(pubkey)
        + lp(_utf8(to))
        + lp(_utf8(amount))
        + be64(nonce)
    )
    return hashlib.sha256(body).digest()


def rotation_sign_bytes(
    chain_id: str,
    algorithm_id: int,
    account: str,
    old_pub: bytes,
    new_pub: bytes,
) -> str:
    """Return the domain-separated STRING both keys sign for ``MsgRotatePQCKey``.

    ``"qorechain-pqc-rotate-v1|<chain_id>|<algorithm_id>|<account>|<old_hex>|<new_hex>"``
    where ``old_hex``/``new_hex`` are lowercase hex of the public keys. Sign the
    UTF-8 encoding of this string.
    """
    return (
        f"qorechain-pqc-rotate-v1|{chain_id}|{algorithm_id}|{account}"
        f"|{old_pub.hex()}|{new_pub.hex()}"
    )


# --------------------------------------------------------------------------- #
# message composers
# --------------------------------------------------------------------------- #


def _parse_coins(amount: str) -> list[Coin]:
    """Parse a single-coin amount string like ``"100uqor"`` → ``[Coin]``."""
    text = amount.strip()
    split = len(text)
    for i, ch in enumerate(text):
        if not (ch.isdigit()):
            split = i
            break
    digits, denom = text[:split], text[split:]
    if not digits or not denom or not (denom[0].isalpha()):
        raise ValueError(f'invalid amount "{amount}" (expected e.g. "100uqor")')
    return [Coin(denom=denom, amount=digits)]


def execute_evm_msg(
    relayer: str,
    account: str,
    scheme: str,
    pubkey: bytes,
    signature: bytes,
    to: str = "",
    value: str = "0",
    data: bytes = b"",
    gas_limit: int = 0,
    nonce: int = 0,
) -> Msg:
    """Compose a ``MsgExecuteEVM`` — the relayer broadcasts it (fee payer)."""
    return Msg(
        type_url=EXECUTE_EVM_TYPE_URL,
        value=abstractaccount_tx.MsgExecuteEVM(
            relayer=relayer,
            account=account,
            scheme=scheme,
            pubkey=bytes(pubkey),
            signature=bytes(signature),
            to=to,
            value=value,
            data=bytes(data),
            gas_limit=int(gas_limit),
            nonce=int(nonce),
        ),
    )


def execute_cosmos_msg(
    relayer: str,
    account: str,
    scheme: str,
    pubkey: bytes,
    signature: bytes,
    to: str,
    amount: str,
    nonce: int,
) -> Msg:
    """Compose a ``MsgExecuteCosmos`` — the relayer broadcasts it (fee payer).

    ``amount`` is a single-coin string like ``"100uqor"`` (parsed into
    ``sdk.Coins``).
    """
    return Msg(
        type_url=EXECUTE_COSMOS_TYPE_URL,
        value=abstractaccount_tx.MsgExecuteCosmos(
            relayer=relayer,
            account=account,
            scheme=scheme,
            pubkey=bytes(pubkey),
            signature=bytes(signature),
            to=to,
            amount=_parse_coins(amount),
            nonce=int(nonce),
        ),
    )


def rotate_pqc_key_msg(
    sender: str,
    old_public_key: bytes,
    new_public_key: bytes,
    old_signature: bytes,
    new_signature: bytes,
) -> Msg:
    """Compose a ``MsgRotatePQCKey`` (sender-signed hybrid; dual-signed payload)."""
    return Msg(
        type_url=ROTATE_PQC_KEY_TYPE_URL,
        value=pqc_tx.MsgRotatePQCKey(
            sender=sender,
            old_public_key=bytes(old_public_key),
            new_public_key=bytes(new_public_key),
            old_signature=bytes(old_signature),
            new_signature=bytes(new_signature),
        ),
    )


# --------------------------------------------------------------------------- #
# key rotation (legacy → canonical migration)
# --------------------------------------------------------------------------- #


def derive_pqc_legacy(mnemonic: str) -> PqcKeypair:
    """Derive the LEGACY (chain-bridge) ML-DSA-87 keypair for a ``mnemonic``.

    Legacy derivation = ``mldsa.keygen(shake256(utf8(mnemonic), 32))`` — the
    ``shake256(mnemonic)`` seed a backend (chain-bridge / faucet-api) used before
    the address-bound canonical derivation existed.
    """
    seed = hashlib.shake_256(_utf8(mnemonic)).digest(32)
    public_key, secret_key = ML_DSA_87.key_derive(seed)
    return PqcKeypair(public_key=bytes(public_key), secret_key=bytes(secret_key))


_HEX40 = re.compile(r"[0-9a-fA-F]{40}")


def canonical_account(account: str) -> str:
    """Resolve ``account`` to the canonical lower-case ``qor1…`` bech32 form.

    This is the form the address-bound PQC derivation and the rotation message
    use. Accepts a bech32 address in either case (all-lower or all-upper, as
    bech32 allows) or a ``0x``/``0X`` EVM address, which is re-encoded to its
    bech32 form. Byte-identical to the Go SDK's resolution: the 20-byte payload
    is re-encoded with the ``qor`` prefix.

    :raises ValueError: if ``account`` is not a valid 20-byte account address.
    """
    if account[:2] in ("0x", "0X"):
        body = account[2:]
        if not _HEX40.fullmatch(body):
            raise ValueError(f"invalid hex address (need 20 bytes): {account!r}")
        return qore_addresses(hex=body)["cosmos"]
    try:
        return qore_addresses(cosmos=account)["cosmos"]
    except ValueError as exc:
        raise ValueError(
            f'cannot resolve account "{account}" to a bech32 cosmos address: {exc}'
        ) from exc


def derive_pqc_canonical(account: str, mnemonic: str) -> PqcKeypair:
    """Derive the canonical address-bound ML-DSA-87 keypair (SDK / wallet-adapter).

    Canonical derivation = ``mldsa.keygen(shake256("qorechain:pqc:v1|" + cosmos
    + "|" + mnemonic, 32))`` where ``cosmos`` is ``account`` resolved by
    :func:`canonical_account` — so an upper-case bech32 or a ``0x`` form of the
    same account yields the same key. The seed matches
    :func:`qorsdk.unified._derive_pqc`, so a wallet moved to this derivation
    matches the unified account's key.

    :raises ValueError: if ``account`` is not a valid 20-byte account address.
    """
    cosmos = canonical_account(account)
    seed = hashlib.shake_256(
        b"qorechain:pqc:v1|" + _utf8(cosmos) + b"|" + _utf8(mnemonic)
    ).digest(32)
    public_key, secret_key = ML_DSA_87.key_derive(seed)
    return PqcKeypair(public_key=bytes(public_key), secret_key=bytes(secret_key))


def _derive_pqc_by_scheme(scheme: str, account: str, mnemonic: str) -> PqcKeypair:
    if scheme in (LEGACY_DERIVATION, "mnemonic-only"):
        return derive_pqc_legacy(mnemonic)
    if scheme in (CANONICAL_DERIVATION, ""):
        return derive_pqc_canonical(account, mnemonic)
    raise ValueError(f'unknown derivation "{scheme}" (use adapter|bridge)')


@dataclass(frozen=True)
class RotationBuild:
    """A dual-signed ``MsgRotatePQCKey`` plus the old/new keypairs it rotates."""

    #: The composed, ready-to-broadcast rotation message.
    msg: Msg
    #: The OLD keypair (proves ownership; still the registered key pre-rotation).
    old_keypair: PqcKeypair
    #: The NEW keypair (proves control; the key registered after the rotation).
    new_keypair: PqcKeypair


def rotate_pqc_key_msg_from_mnemonic(
    account: str,
    mnemonic: str,
    chain_id: str,
    algorithm_id: int = ALGORITHM_DILITHIUM5,
    old_derivation: str = LEGACY_DERIVATION,
    new_derivation: str = CANONICAL_DERIVATION,
) -> RotationBuild:
    """Build a ``MsgRotatePQCKey`` rotating an account's ML-DSA-87 key (SAME algo).

    The canonical use is migrating a LEGACY chain-bridge key
    (``shake256(mnemonic)``) to the canonical address-bound key
    (``shake256("qorechain:pqc:v1|" + account + "|" + mnemonic)``), so a wallet
    whose key was registered by a backend can move to the standard derivation.
    Both keys dual-sign the domain-separated rotation bytes (old proves
    ownership, new proves control).

    The returned message must be broadcast BY the account, cosigned (hybrid) with
    the OLD key — it is still the registered key until the rotation lands.

    ``account`` may be any encoding :func:`canonical_account` accepts; the
    message ``sender`` and the rotation sign-bytes always carry the canonical
    lower-case ``qor1…`` form.

    :raises ValueError: if the two derivations produce the same key (a no-op),
        if a derivation label is unknown, or if ``account`` is not a valid
        account address.
    """
    # The sender and the account in the rotation sign-bytes use the canonical
    # lower-case bech32 form, so an upper-case or 0x input builds the same
    # message the canonical input does (matching the Go SDK).
    account = canonical_account(account)
    old_kp = _derive_pqc_by_scheme(old_derivation, account, mnemonic)
    new_kp = _derive_pqc_by_scheme(new_derivation, account, mnemonic)
    if old_kp.public_key == new_kp.public_key:
        raise ValueError(
            "old and new derivations produce the same key — rotation would be a no-op"
        )
    sign_bytes = _utf8(
        rotation_sign_bytes(
            chain_id, algorithm_id, account, old_kp.public_key, new_kp.public_key
        )
    )
    msg = rotate_pqc_key_msg(
        sender=account,
        old_public_key=old_kp.public_key,
        new_public_key=new_kp.public_key,
        old_signature=bytes(ML_DSA_87.sign(old_kp.secret_key, sign_bytes, deterministic=True)),
        new_signature=bytes(ML_DSA_87.sign(new_kp.secret_key, sign_bytes, deterministic=True)),
    )
    return RotationBuild(msg=msg, old_keypair=old_kp, new_keypair=new_kp)


__all__ = [
    "EXECUTE_EVM_TYPE_URL",
    "EXECUTE_COSMOS_TYPE_URL",
    "ROTATE_PQC_KEY_TYPE_URL",
    "CANONICAL_DERIVATION",
    "LEGACY_DERIVATION",
    "be64",
    "lp",
    "evm_auth_sign_bytes",
    "cosmos_auth_sign_bytes",
    "rotation_sign_bytes",
    "execute_evm_msg",
    "execute_cosmos_msg",
    "rotate_pqc_key_msg",
    "derive_pqc_legacy",
    "derive_pqc_canonical",
    "canonical_account",
    "rotate_pqc_key_msg_from_mnemonic",
    "RotationBuild",
]
