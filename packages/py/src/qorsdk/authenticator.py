"""v3.1.85 authenticator lanes (EVM + Native/Cosmos) and same-algorithm PQC key
rotation - the Python mirror of the canonical TypeScript SDK / wallet-adapter
``authenticator`` module.

v3.1.84 introduced the SVM authenticator lane. v3.1.85 adds two more lanes so a
linked external key (Phantom ed25519 / a secp256k1 key) can spend from the ONE
unified PQC-required account under least-privilege, spend-limited, revocable
terms - via a relayer, WITHOUT the external key ever producing an ML-DSA
co-signature:

* **EVM lane** - :func:`execute_evm_msg` / ``MsgExecuteEVM``: an EVM
  call/transfer FROM the account's ``0x`` address.
* **Native lane** - :func:`execute_cosmos_msg` / ``MsgExecuteCosmos``: a bank
  send FROM the account (Cosmos).

The relayer submits + pays fees (its own hybrid-PQC signature satisfies the ante
on the envelope); the authenticator's signature over the domain-separated,
replay-bound sign-bytes IS the authorization. The digests below are rebuilt
BYTE-FOR-BYTE from the chain (``x/abstractaccount/types/{evm,cosmos}_sign.go``) -
a mismatch is rejected on-chain (codespace ``abstractaccount``: code 11 replay /
10 permission / 5 spending-limit / 6 session-expired).

**Nonces.** ``MsgExecuteEVM.nonce`` and ``MsgExecuteCosmos.nonce`` are both the
per-authenticator sequence for ``(account, pubkey)``: a counter the chain keeps
for each linked key, starting at 0 and incremented by each successful execution.
For the EVM lane it is NOT the account's EVM nonce (the chain checks this counter
since v3.2.0). Read it with :func:`fetch_auth_nonce` (chain v3.2.4); a mismatch
is refused with abstractaccount code 11.

**Linking a key (chain v3.2.8).** ``MsgRegisterAuthenticator`` must carry a
``possession_proof``: a signature BY THE KEY BEING LINKED over
:func:`authenticator_link_message`. A browser wallet signs that text itself
(Phantom ``signMessage``, MetaMask ``personal_sign``); with the private key in
hand use :func:`link_proof_ed25519`, :func:`link_proof_secp256k1` or
:func:`link_proof_eth`. A key with any of the permissions ``send``, ``evm``,
``deploy``, ``svm`` or ``all`` also needs an enabled spending rule on the
account that bounds every denom; :func:`link_authenticator_msgs` builds the
``[MsgUpdateSpendingRules, MsgRegisterAuthenticator]`` pair to send in ONE
owner-signed transaction.

**Failed executions (chain v3.2.8).** An authorised ``MsgExecuteEVM`` /
``MsgExecuteCosmos`` whose execution fails no longer fails the transaction: the
tx has code 0, the response carries ``success=false`` and the chain emits
``abstractaccount_execution_failed``. The nonce is consumed, so the same
signature cannot be relayed again. Check every delivered result with
:func:`decode_execution_results` / :func:`require_executions_succeeded`.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

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
# sign-bytes (the digest an authenticator signs) - BYTE-EXACT
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
    exactly one form per block: v1 below the v3.2.3 upgrade, v2 from it - pick
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
    has applied v3.2.3, ``"v1"`` before. Raises when the node cannot be asked -
    never guess, the other form is refused."""
    return "v2" if is_upgrade_applied(rest, CHAIN_UPGRADE_V3_2_3, cache_key=cache_key) else "v1"


@dataclass(frozen=True)
class AuthNonce:
    """A linked key's sequence, from :func:`fetch_auth_nonce`."""

    #: The nonce the next ``MsgExecuteEVM`` / ``MsgExecuteCosmos`` from this key
    #: must carry.
    nonce: int
    #: Whether the key is currently linked (present and not revoked); the counter
    #: is kept either way.
    linked: bool


_HEX = re.compile(r"^[0-9a-fA-F]+$")


def auth_nonce_path(address: str, pubkey: bytes | str) -> str:
    """The REST path of the ``auth_nonce`` query for ``(address, pubkey)``.

    :param pubkey: The authenticator public key: bytes, or hex (``0x`` optional).
    :raises ValueError: If ``pubkey`` is empty, not hex, or of odd length.
    """
    if isinstance(pubkey, (bytes, bytearray)):
        hex_key = bytes(pubkey).hex()
    elif isinstance(pubkey, str):
        hex_key = pubkey[2:] if pubkey[:2] in ("0x", "0X") else pubkey
    else:
        hex_key = ""
    if not _HEX.match(hex_key) or len(hex_key) % 2 != 0:
        raise ValueError("fetch_auth_nonce: pubkey must be bytes or a hex string")
    return f"/qorechain/abstractaccount/v1/auth_nonce/{quote(address, safe='')}/{hex_key}"


def parse_auth_nonce(payload: Any) -> AuthNonce:
    """Parse an ``auth_nonce`` REST payload.

    :raises ValueError: When the answer carries no nonce.
    """
    raw = payload.get("nonce") if isinstance(payload, dict) else None
    if isinstance(raw, bool) or not isinstance(raw, (int, str)):
        raise ValueError("auth_nonce query: no nonce in the answer")
    try:
        nonce = int(raw.strip(), 10) if isinstance(raw, str) else raw
    except ValueError:
        raise ValueError(f"auth_nonce query: nonce is not an integer: {raw!r}") from None
    return AuthNonce(nonce=nonce, linked=payload.get("linked") is True)


def fetch_auth_nonce(rest: Any, address: str, pubkey: bytes | str) -> AuthNonce:
    """Read the sequence a linked authenticator key must sign next
    (``/qorechain/abstractaccount/v1/auth_nonce/{address}/{pubkey_hex}``, chain
    v3.2.4).

    This is the ``nonce`` of :func:`evm_auth_sign_bytes` /
    :func:`evm_auth_sign_bytes_v2` / :func:`cosmos_auth_sign_bytes`: the key's
    own counter, not the account's EVM nonce. A key that never executed reads 0.

    :param rest: A :class:`~qorsdk.rest.RestClient` (or anything with ``get``).
    :param address: The ``qor1…`` account the key acts for.
    :param pubkey: The authenticator public key: bytes, or hex (``0x`` optional).
    :raises ValueError: If ``pubkey`` is not bytes or hex (nothing is sent), or
        the answer carries no nonce.
    """
    return parse_auth_nonce(rest.get(auth_nonce_path(address, pubkey)))


async def fetch_auth_nonce_async(rest: Any, address: str, pubkey: bytes | str) -> AuthNonce:
    """Asynchronous mirror of :func:`fetch_auth_nonce`."""
    return parse_auth_nonce(await rest.get(auth_nonce_path(address, pubkey)))


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
    """Compose a ``MsgExecuteEVM`` - the relayer broadcasts it (fee payer).

    :raises ValueError: If ``gas_limit`` is above the chain's EVM gas cap
        (:data:`~qorsdk.gas.EVM_TX_MAX_GAS`, 30,000,000 on v3.2.8).
    """
    from .gas import check_evm_gas_limit

    check_evm_gas_limit(int(gas_limit))
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
    """Compose a ``MsgExecuteCosmos`` - the relayer broadcasts it (fee payer).

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
# authenticator link: possession proof (chain v3.2.8)
# --------------------------------------------------------------------------- #

#: The first line of the link message (the chain's ``AuthenticatorLinkDomain``).
AUTHENTICATOR_LINK_DOMAIN = "QoreChain authenticator link v1"

#: The schemes a linked key may use.
AUTHENTICATOR_SCHEMES = ("ed25519", "secp256k1")


def _link_pubkey(scheme: str, pubkey: bytes | str) -> bytes:
    """Check ``pubkey`` against ``scheme`` and return it as bytes."""
    if isinstance(pubkey, str):
        text = pubkey[2:] if pubkey[:2] in ("0x", "0X") else pubkey
        if not _HEX.match(text) or len(text) % 2 != 0:
            raise ValueError("authenticator pubkey must be bytes or a hex string")
        key = bytes.fromhex(text)
    else:
        key = bytes(pubkey)
    if scheme == "ed25519":
        if len(key) != 32:
            raise ValueError(f"an ed25519 authenticator key is 32 bytes, got {len(key)}")
    elif scheme == "secp256k1":
        if len(key) == 65:
            raise ValueError(
                "a 65-byte uncompressed secp256k1 key is refused: link the 33-byte "
                "compressed key, or the 20-byte Ethereum address for a MetaMask-style link"
            )
        if len(key) not in (33, 20):
            raise ValueError(
                "a secp256k1 authenticator key is the 33-byte compressed key or the 20-byte "
                f"Ethereum address, got {len(key)} bytes"
            )
    else:
        raise ValueError(f"unknown authenticator scheme {scheme!r} (use ed25519 or secp256k1)")
    return key


def authenticator_link_text(
    chain_id: str, account_address: str, scheme: str, pubkey: bytes | str
) -> str:
    """The text the key being linked signs for ``possession_proof`` (chain v3.2.8).

    Five lines joined with ``"\\n"`` and no trailing newline::

        QoreChain authenticator link v1
        chain: <chain_id>
        account: <account_address>
        scheme: <scheme>
        key: <lowercase hex of pubkey>

    ``pubkey`` is exactly the bytes put in the message's ``pubkey``: the 32-byte
    ed25519 key, the 33-byte compressed secp256k1 key, or the 20-byte Ethereum
    address for a MetaMask-style link (bytes or hex).

    :raises ValueError: If the scheme is unknown or the key has the wrong length
        (a 65-byte uncompressed key is refused).
    """
    key = _link_pubkey(scheme, pubkey)
    return (
        f"{AUTHENTICATOR_LINK_DOMAIN}\nchain: {chain_id}\naccount: {account_address}"
        f"\nscheme: {scheme}\nkey: {key.hex()}"
    )


def authenticator_link_message(
    chain_id: str, account_address: str, scheme: str, pubkey: bytes | str
) -> bytes:
    """The UTF-8 bytes of :func:`authenticator_link_text`, the exact bytes signed.

    How the chain verifies the proof over these bytes:

    * ed25519 (32-byte key): ed25519 signature over the raw bytes (Phantom
      ``signMessage``);
    * secp256k1, 33-byte key: 64-byte ``r || s`` ECDSA signature (low-S) over
      ``sha256(message)``;
    * secp256k1, 20-byte Ethereum address: EIP-191 ``personal_sign`` of the
      message, 65 bytes ``r || s || v`` (v = 27/28, 0/1 also accepted).
    """
    return authenticator_link_text(chain_id, account_address, scheme, pubkey).encode("utf-8")


def eip191_hash(message: bytes) -> bytes:
    """``keccak256("\\x19Ethereum Signed Message:\\n" + len(message) + message)``."""
    from .utils.hash import keccak256

    prefix = f"\x19Ethereum Signed Message:\n{len(message)}".encode()
    return keccak256(prefix + bytes(message))


@dataclass(frozen=True)
class AuthenticatorLinkProof:
    """A linked key and its possession proof, ready for ``MsgRegisterAuthenticator``."""

    #: ``"ed25519"`` or ``"secp256k1"``.
    scheme: str
    #: The bytes for the message's ``pubkey`` field.
    pubkey: bytes
    #: The signature for the message's ``possession_proof`` field.
    possession_proof: bytes


def _ed25519_seed(private_key: bytes) -> bytes:
    key = bytes(private_key)
    if len(key) == 64:  # Solana-style secret key: seed || public key
        return key[:32]
    if len(key) != 32:
        raise ValueError("an ed25519 private key is a 32-byte seed or a 64-byte secret key")
    return key


def link_proof_ed25519(
    private_key: bytes, *, chain_id: str, account_address: str
) -> AuthenticatorLinkProof:
    """Sign the link message with an ed25519 key (32-byte seed, or the 64-byte
    Solana-style secret key of :class:`~qorsdk.accounts.Ed25519Account`)."""
    from nacl.signing import SigningKey as Ed25519SigningKey

    signing = Ed25519SigningKey(_ed25519_seed(private_key))
    pubkey = bytes(signing.verify_key)
    message = authenticator_link_message(chain_id, account_address, "ed25519", pubkey)
    return AuthenticatorLinkProof(
        scheme="ed25519", pubkey=pubkey, possession_proof=bytes(signing.sign(message).signature)
    )


def link_proof_secp256k1(
    private_key: bytes, *, chain_id: str, account_address: str
) -> AuthenticatorLinkProof:
    """Sign the link message with a secp256k1 key linked by its 33-byte
    compressed public key: 64-byte low-S ``r || s`` over ``sha256(message)``."""
    from ecdsa import SECP256k1, SigningKey
    from ecdsa.util import sigencode_string_canonize

    sk = SigningKey.from_string(bytes(private_key), curve=SECP256k1)
    pubkey = bytes(sk.get_verifying_key().to_string("compressed"))
    message = authenticator_link_message(chain_id, account_address, "secp256k1", pubkey)
    proof = sk.sign_digest_deterministic(
        hashlib.sha256(message).digest(),
        hashfunc=hashlib.sha256,
        sigencode=sigencode_string_canonize,
    )
    return AuthenticatorLinkProof(scheme="secp256k1", pubkey=pubkey, possession_proof=bytes(proof))


def _eth_address(uncompressed64: bytes) -> bytes:
    from .utils.hash import keccak256

    return keccak256(uncompressed64)[12:]


def _recover_eth_address(rs: bytes, digest: bytes, recid: int) -> bytes | None:
    """The Ethereum address that signed ``digest`` with ``r || s`` and recovery id
    ``recid`` (the parity of R's y), or ``None`` if no key recovers."""
    from ecdsa import SECP256k1
    from ecdsa.ellipticcurve import Point
    from ecdsa.numbertheory import inverse_mod

    curve = SECP256k1.curve
    n = SECP256k1.order
    p = curve.p()
    r = int.from_bytes(rs[:32], "big")
    s = int.from_bytes(rs[32:64], "big")
    if not (0 < r < n and 0 < s < n):
        return None
    alpha = (pow(r, 3, p) + 7) % p
    beta = pow(alpha, (p + 1) // 4, p)
    if beta * beta % p != alpha:
        return None
    y = beta if beta % 2 == recid else p - beta
    big_r = Point(curve, r, y, n)
    gen = SECP256k1.generator
    g = Point(curve, gen.x(), gen.y(), n)
    e = int.from_bytes(digest, "big") % n
    q = (big_r * s + g * ((-e) % n)) * inverse_mod(r, n)
    if q.x() is None:
        return None
    return _eth_address(int(q.x()).to_bytes(32, "big") + int(q.y()).to_bytes(32, "big"))


def link_proof_eth(
    private_key: bytes, *, chain_id: str, account_address: str
) -> AuthenticatorLinkProof:
    """Sign the link message as MetaMask ``personal_sign`` would, for a key
    linked by its 20-byte Ethereum address: 65 bytes ``r || s || v`` with
    v = 27/28 over the EIP-191 hash."""
    from ecdsa import SECP256k1, SigningKey
    from ecdsa.util import sigencode_string_canonize

    sk = SigningKey.from_string(bytes(private_key), curve=SECP256k1)
    address = _eth_address(sk.get_verifying_key().to_string())
    message = authenticator_link_message(chain_id, account_address, "secp256k1", address)
    digest = eip191_hash(message)
    rs = sk.sign_digest_deterministic(
        digest, hashfunc=hashlib.sha256, sigencode=sigencode_string_canonize
    )
    recid = next(i for i in (0, 1) if _recover_eth_address(rs, digest, i) == address)
    return AuthenticatorLinkProof(
        scheme="secp256k1", pubkey=address, possession_proof=bytes(rs) + bytes([27 + recid])
    )


def verify_link_proof(
    *,
    chain_id: str,
    account_address: str,
    scheme: str,
    pubkey: bytes,
    possession_proof: bytes,
) -> bool:
    """Check a possession proof the way the chain does; ``False`` if it does not verify."""
    try:
        message = authenticator_link_message(chain_id, account_address, scheme, pubkey)
    except ValueError:
        return False
    proof = bytes(possession_proof)
    key = bytes(pubkey)
    try:
        if scheme == "ed25519":
            from nacl.signing import VerifyKey

            if len(proof) != 64:
                return False
            VerifyKey(key).verify(message, proof)
            return True
        from ecdsa import SECP256k1, VerifyingKey
        from ecdsa.util import sigdecode_string

        if len(key) == 33:
            if len(proof) != 64:
                return False
            n = SECP256k1.order
            if int.from_bytes(proof[32:], "big") > n // 2:
                return False  # the chain accepts low-S only
            vk = VerifyingKey.from_string(key, curve=SECP256k1)
            return bool(
                vk.verify_digest(
                    proof, hashlib.sha256(message).digest(), sigdecode=sigdecode_string
                )
            )
        if len(proof) != 65:
            return False
        v = proof[64]
        recid = v - 27 if v >= 27 else v
        if recid not in (0, 1):
            return False
        return _recover_eth_address(proof[:64], eip191_hash(message), recid) == key
    except Exception:  # noqa: BLE001 - any decode/verify failure is "does not verify"
        return False


# --------------------------------------------------------------------------- #
# linking a key: spending rule + registration in one transaction
# --------------------------------------------------------------------------- #

#: Permissions that let a linked key move value; from v3.2.8 each needs an
#: enabled spending rule on the account that bounds every denom.
VALUE_PERMISSIONS = ("send", "evm", "deploy", "svm", "all")


def _rule_field(rule: Any, name: str) -> Any:
    if isinstance(rule, dict):
        return rule.get(name)
    return getattr(rule, name, None)


def _canonical_denom(denom: str) -> str:
    return denom.lower()


def _limit_set(value: Any) -> bool:
    try:
        return int(value or 0) > 0
    except (TypeError, ValueError):
        return False


def spending_rule_bounds_every_denom(rule: Any) -> bool:
    """Whether an (enabled) rule caps the outflow of every denom it admits, as
    the chain requires for a value-permission key from v3.2.8.

    True when ``per_tx_limit > 0`` or ``daily_limit > 0``; otherwise the rule
    needs a non-empty ``allowed_denoms`` list where every denom has a
    ``denom_limits`` entry (denoms compared case-insensitively) with a non-zero
    per-tx or daily amount.
    """
    if rule is None or not _rule_field(rule, "enabled"):
        return False
    if _limit_set(_rule_field(rule, "per_tx_limit")) or _limit_set(
        _rule_field(rule, "daily_limit")
    ):
        return True
    allowed = list(_rule_field(rule, "allowed_denoms") or ())
    if not allowed:
        return False
    limits = {
        _canonical_denom(str(_rule_field(dl, "denom") or "")): dl
        for dl in (_rule_field(rule, "denom_limits") or ())
    }
    for denom in allowed:
        dl = limits.get(_canonical_denom(str(denom)))
        if dl is None or not (
            _limit_set(_rule_field(dl, "per_tx_limit"))
            or _limit_set(_rule_field(dl, "daily_limit"))
        ):
            return False
    return True


def rules_cover_value_permissions(rules: Any) -> bool:
    """Whether an account with ``rules`` may hold a value-permission key: the
    chain applies the FIRST enabled rule, and that rule must bound every denom
    (:func:`spending_rule_bounds_every_denom`)."""
    for rule in rules or ():
        if _rule_field(rule, "enabled"):
            return spending_rule_bounds_every_denom(rule)
    return False


_VALUE_RULE_HELP = (
    "a linked key with the send, evm, deploy, svm or all permission needs an enabled spending "
    "rule on the account that bounds every denom (from chain v3.2.8): the first enabled rule "
    "must set per_tx_limit or daily_limit above 0, or list allowed_denoms with a denom_limits "
    "amount for every listed denom"
)


def link_authenticator_msgs(
    *,
    owner: str,
    chain_id: str,
    scheme: str,
    pubkey: bytes,
    permissions: list[str] | tuple[str, ...],
    expiry_unix: int,
    possession_proof: bytes,
    label: str = "",
    spending_rule: Any = None,
    account_address: str | None = None,
    verify_proof: bool = True,
) -> list[Msg]:
    """Build the messages that link a key to an account (chain v3.2.8).

    Returns ``[MsgUpdateSpendingRules, MsgRegisterAuthenticator]`` to send as
    top-level messages of ONE transaction signed by ``owner`` (not through
    authz). ``MsgUpdateSpendingRules`` may be sent for an account that does not
    exist yet when ``account_address == owner`` (it creates the account), which
    is the default here. Without ``spending_rule`` and with no value permission,
    only the registration is returned.

    ``spending_rule`` is one rule (a mapping with the ``SpendingRule`` fields or
    a protobuf ``SpendingRule``) or a list of them. ``MsgUpdateSpendingRules``
    REPLACES the account's rules wholesale: pass every rule the account should
    keep, not only the new one.

    :param possession_proof: The linked key's signature over
        :func:`authenticator_link_message` (see :func:`link_proof_ed25519`,
        :func:`link_proof_secp256k1`, :func:`link_proof_eth`).
    :param verify_proof: Check the proof locally first (default), so a proof
        for another chain id or account is refused before anything is signed.
    :raises ValueError: On an empty or non-verifying proof, or a value
        permission without a rule that bounds every denom.
    """
    from .messages.qorechain import abstractaccount as aa_msgs

    account = account_address or owner
    key = _link_pubkey(scheme, pubkey)
    if not possession_proof:
        raise ValueError(
            "possession_proof is required from chain v3.2.8: sign "
            "authenticator_link_message(chain_id, account_address, scheme, pubkey) with the key "
            "being linked"
        )
    if verify_proof and not verify_link_proof(
        chain_id=chain_id,
        account_address=account,
        scheme=scheme,
        pubkey=key,
        possession_proof=possession_proof,
    ):
        raise ValueError(
            "possession_proof does not verify: the linked key must sign "
            f"authenticator_link_message for chain {chain_id!r} and account {account!r}"
        )
    if spending_rule is None:
        rules: list[Any] = []
    elif isinstance(spending_rule, (list, tuple)):
        rules = list(spending_rule)
    else:
        rules = [spending_rule]
    if any(p in VALUE_PERMISSIONS for p in permissions) and not rules_cover_value_permissions(
        rules
    ):
        raise ValueError(_VALUE_RULE_HELP)
    out: list[Msg] = []
    if rules:
        out.append(
            aa_msgs.update_spending_rules(owner=owner, account_address=account, rules=rules)
        )
    out.append(
        aa_msgs.register_authenticator(
            owner=owner,
            account_address=account,
            scheme=scheme,
            pubkey=key,
            permissions=list(permissions),
            expiry_unix=int(expiry_unix),
            label=label,
            possession_proof=bytes(possession_proof),
        )
    )
    return out


# --------------------------------------------------------------------------- #
# execution results (chain v3.2.8: failures come back with tx code 0)
# --------------------------------------------------------------------------- #

EXECUTE_EVM_RESPONSE_TYPE_URL = "/qorechain.abstractaccount.v1.MsgExecuteEVMResponse"
EXECUTE_COSMOS_RESPONSE_TYPE_URL = "/qorechain.abstractaccount.v1.MsgExecuteCosmosResponse"
#: The event the chain emits for an authorised execution that failed.
EXECUTION_FAILED_EVENT = "abstractaccount_execution_failed"


@dataclass(frozen=True)
class ExecutionResult:
    """The outcome of one ``MsgExecuteEVM`` / ``MsgExecuteCosmos`` in a delivered tx."""

    #: ``"evm"`` or ``"cosmos"``.
    lane: str
    #: Whether the execution succeeded. ``False`` with tx code 0 means it was
    #: authorised but failed; its nonce is consumed.
    success: bool
    #: EVM return data (empty for the Cosmos lane).
    ret: bytes = b""
    #: EVM gas used (0 for the Cosmos lane).
    gas_used: int = 0
    #: The EVM error text, if any.
    vm_error: str = ""
    #: The ``reason`` of the matching ``abstractaccount_execution_failed`` event.
    reason: str = ""
    #: ``account`` / ``nonce`` of that event, when present.
    account: str = ""
    nonce: int | None = None


class ExecutionFailedError(Exception):
    """An authorised execution failed inside a transaction with code 0."""

    def __init__(self, failures: list[ExecutionResult]) -> None:
        detail = "; ".join(
            f"{f.lane}: {f.reason or f.vm_error or 'execution failed'}" for f in failures
        )
        super().__init__(
            f"{len(failures)} authorised execution(s) failed although the transaction "
            f"succeeded (the nonce is consumed; sign again with the next nonce): {detail}"
        )
        self.failures = failures


def _tx_response(result: Any) -> Any:
    raw = getattr(result, "raw", None)
    if raw is not None and not isinstance(result, dict):
        result = raw
    if isinstance(result, dict) and isinstance(result.get("tx_response"), dict):
        return result["tx_response"]
    return result


def _attr_map(event: Any) -> dict[str, str]:
    out: dict[str, str] = {}
    for a in event.get("attributes") or ():
        if isinstance(a, dict) and isinstance(a.get("key"), str):
            out[a["key"]] = str(a.get("value") or "")
    return out


def _failure_events(tx: Any) -> list[dict[str, str]]:
    if not isinstance(tx, dict):
        return []
    events = list(tx.get("events") or ())
    if not events:
        for log in tx.get("logs") or ():
            events.extend((log or {}).get("events") or ())
    return [
        _attr_map(e)
        for e in events
        if isinstance(e, dict) and e.get("type") == EXECUTION_FAILED_EVENT
    ]


def _results_from_json(responses: list[Any]) -> list[ExecutionResult]:
    import base64

    out: list[ExecutionResult] = []
    for r in responses:
        if not isinstance(r, dict):
            continue
        t = r.get("@type") or r.get("type_url")
        if t == EXECUTE_EVM_RESPONSE_TYPE_URL:
            ret_raw = r.get("ret") or ""
            out.append(
                ExecutionResult(
                    lane="evm",
                    success=r.get("success") is True,
                    ret=base64.b64decode(ret_raw) if isinstance(ret_raw, str) else b"",
                    gas_used=int(r.get("gas_used") or 0),
                    vm_error=str(r.get("vm_error") or ""),
                )
            )
        elif t == EXECUTE_COSMOS_RESPONSE_TYPE_URL:
            out.append(ExecutionResult(lane="cosmos", success=r.get("success") is True))
    return out


def decode_execution_results(result: Any) -> list[ExecutionResult]:
    """Decode every ``MsgExecuteEVM`` / ``MsgExecuteCosmos`` outcome of a
    delivered transaction, in message order.

    Accepts a REST broadcast/tx body (``{"tx_response": {...}}``), a bare
    ``tx_response`` dict, or an :class:`~qorsdk.track.IncludedTx`. The responses
    come from the hex ``data`` (``TxMsgData``) or a JSON ``msg_responses`` list;
    each failed one is paired, per lane and in order, with the ``reason``,
    ``account`` and ``nonce`` of the ``abstractaccount_execution_failed`` events.
    A ``sync``-mode broadcast response carries no result yet and yields ``[]``.
    """
    from dataclasses import replace

    from cosmpy.protos.cosmos.base.abci.v1beta1.abci_pb2 import TxMsgData

    from .cross_vm import _result_data_hex

    tx = _tx_response(result)
    results: list[ExecutionResult] = []
    json_responses = tx.get("msg_responses") if isinstance(tx, dict) else None
    if isinstance(json_responses, list) and json_responses:
        results = _results_from_json(json_responses)
    else:
        data_hex = _result_data_hex(tx)
        if data_hex:
            try:
                raw = bytes.fromhex(data_hex)
            except ValueError as exc:
                raise ValueError("tx result data is not hex-encoded TxMsgData") from exc
            msg_data = TxMsgData()
            msg_data.ParseFromString(raw)
            for any_msg in msg_data.msg_responses:
                if any_msg.type_url == EXECUTE_EVM_RESPONSE_TYPE_URL:
                    evm = abstractaccount_tx.MsgExecuteEVMResponse()
                    evm.ParseFromString(any_msg.value)
                    results.append(
                        ExecutionResult(
                            lane="evm",
                            success=evm.success,
                            ret=bytes(evm.ret),
                            gas_used=evm.gas_used,
                            vm_error=evm.vm_error,
                        )
                    )
                elif any_msg.type_url == EXECUTE_COSMOS_RESPONSE_TYPE_URL:
                    cos = abstractaccount_tx.MsgExecuteCosmosResponse()
                    cos.ParseFromString(any_msg.value)
                    results.append(ExecutionResult(lane="cosmos", success=cos.success))
    events = _failure_events(tx)
    by_lane: dict[str, list[dict[str, str]]] = {}
    for e in events:
        by_lane.setdefault(e.get("lane", ""), []).append(e)
    unlaned = by_lane.pop("", [])
    out: list[ExecutionResult] = []
    for r in results:
        if r.success:
            out.append(r)
            continue
        queue = by_lane.get(r.lane) or unlaned
        if not queue:
            out.append(r)
            continue
        ev = queue.pop(0)
        nonce_text = ev.get("nonce", "")
        out.append(
            replace(
                r,
                reason=ev.get("reason", ""),
                account=ev.get("account", ""),
                nonce=int(nonce_text) if nonce_text.isdigit() else None,
            )
        )
    return out


def require_executions_succeeded(result: Any) -> list[ExecutionResult]:
    """:func:`decode_execution_results`, raising when any execution failed.

    Use it after every relayed ``MsgExecuteEVM`` / ``MsgExecuteCosmos``: from
    chain v3.2.8 a failed execution leaves the transaction at code 0.

    :raises ExecutionFailedError: Listing each failed execution and its reason.
    """
    results = decode_execution_results(result)
    failures = [r for r in results if not r.success]
    if failures:
        raise ExecutionFailedError(failures)
    return results


# --------------------------------------------------------------------------- #
# key rotation (legacy → canonical migration)
# --------------------------------------------------------------------------- #


def derive_pqc_legacy(mnemonic: str) -> PqcKeypair:
    """Deprecated for new keys.

    Not bound to the account, so one mnemonic yields one key for every account.
    Keep using it only to recover, or rotate away from, a key that was
    registered this way (:func:`rotate_pqc_key_msg_from_mnemonic`).

    Derive the LEGACY (chain-bridge) ML-DSA-87 keypair for a ``mnemonic``.

    Legacy derivation = ``mldsa.keygen(shake256(utf8(mnemonic), 32))`` - the
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
    :func:`canonical_account` - so an upper-case bech32 or a ``0x`` form of the
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
    the OLD key - it is still the registered key until the rotation lands.

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
    if new_derivation in (LEGACY_DERIVATION, "mnemonic-only"):
        raise ValueError(
            "the legacy (bridge) derivation is deprecated for new keys: rotate to the "
            f'address-bound derivation ("{CANONICAL_DERIVATION}"). A legacy key can still be '
            "the OLD key of a rotation."
        )
    new_kp = _derive_pqc_by_scheme(new_derivation, account, mnemonic)
    if old_kp.public_key == new_kp.public_key:
        raise ValueError(
            "old and new derivations produce the same key - rotation would be a no-op"
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
    "AuthNonce",
    "auth_nonce_path",
    "parse_auth_nonce",
    "fetch_auth_nonce",
    "fetch_auth_nonce_async",
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
    "AUTHENTICATOR_LINK_DOMAIN",
    "AUTHENTICATOR_SCHEMES",
    "authenticator_link_text",
    "authenticator_link_message",
    "eip191_hash",
    "AuthenticatorLinkProof",
    "link_proof_ed25519",
    "link_proof_secp256k1",
    "link_proof_eth",
    "verify_link_proof",
    "VALUE_PERMISSIONS",
    "spending_rule_bounds_every_denom",
    "rules_cover_value_permissions",
    "link_authenticator_msgs",
    "EXECUTE_EVM_RESPONSE_TYPE_URL",
    "EXECUTE_COSMOS_RESPONSE_TYPE_URL",
    "EXECUTION_FAILED_EVENT",
    "ExecutionResult",
    "ExecutionFailedError",
    "decode_execution_results",
    "require_executions_succeeded",
]
