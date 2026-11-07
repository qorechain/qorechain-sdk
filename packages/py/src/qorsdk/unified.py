"""Unified eth-native QoreChain wallet.

One eth-native secp256k1 keypair yields the SAME 20-byte account rendered as all
THREE QoreChain address encodings, so a wallet never "has funds on one lane but
not another" again. The 20 bytes are the Ethereum derivation
``keccak256(uncompressed_pubkey[1:])[12:]`` so the key is natively spendable on
the EVM lane; the native (``qor1…``) and SVM (base58) forms are just other
encodings of those same 20 bytes - the chain reads one x/bank balance for the
account, visible under all three.

    UnifiedAccount:
      private_key   (32 bytes),
      public_key    (33 bytes, compressed secp256k1),
      address_bytes (20 bytes),
      cosmos        "qor1…"            (bech32),
      evm           "0x…" (EIP-55),    (hex),
      svm           "<base58>"         (base58(20B ‖ 12 zero bytes) = 32-byte SVM addr),
      pqc           PqcKeypair         (ML-DSA-87, seeded + recoverable)

An eth-native account signs EVM txs (EIP-155) AND, via the Native-lane
``eth_secp256k1`` scheme (see :mod:`qorsdk.sign_eth`), PQC-hybrid Native txs -
one identity, all lanes.

This mirrors ``@qorechain/wallet-adapter`` (``wallet.js``) byte-for-byte but is
reimplemented natively here, with no dependency on the adapter. It is ADDITIVE:
the classical coin-118 native derivation in :mod:`qorsdk.accounts` is unchanged.
"""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass

import base58
from bip_utils import Bip32Slip10Secp256k1, Bip39SeedGenerator
from ecdsa import SECP256k1, SigningKey

from .accounts import validate_mnemonic
from .address import DEFAULT_PREFIX
from .pqc import PqcKeypair
from .recovery import _decode_recovery_code, _pqc_key_from_secret
from .utils.hash import keccak256

try:  # dilithium-py exposes seeded keygen as ML_DSA_87.key_derive(seed32)
    from dilithium_py.ml_dsa import ML_DSA_87
except Exception as exc:  # pragma: no cover - dependency guaranteed by pyproject
    raise ImportError("dilithium-py is required for unified PQC derivation") from exc

#: Ethereum HD path (coin-type 60) - makes the 20-byte address the keccak
#: derivation, so the key is EVM-native (spendable via eth_sendRawTransaction).
_ETH_HD_PATH = "44'/60'/0'/0/{index}"

#: bech32 human-readable prefix for QoreChain account addresses.
HRP = DEFAULT_PREFIX


@dataclass(frozen=True)
class UnifiedAccount:
    """A single eth-native account rendered in every QoreChain encoding.

    ``private_key`` and ``pqc.secret_key`` are secret material - never log them.
    ``public_key`` is the 33-byte compressed secp256k1 key; ``address_bytes`` is
    the 20-byte Ethereum-derivation account address the three encodings share.
    """

    private_key: bytes
    public_key: bytes
    address_bytes: bytes
    cosmos: str
    evm: str
    svm: str
    pqc: PqcKeypair

    @property
    def private_key_hex(self) -> str:
        """The private key as a ``0x``-prefixed hex string."""
        return "0x" + self.private_key.hex()

    @property
    def public_key_hex(self) -> str:
        """The compressed public key as a ``0x``-prefixed hex string."""
        return "0x" + self.public_key.hex()


def _eip55(hex20: str) -> str:
    """EIP-55 mixed-case checksum for a 20-byte hex address (no ``0x``)."""
    lower = hex20.lower()
    digest = keccak256(lower.encode("ascii")).hex()
    out = "0x"
    for i, char in enumerate(lower):
        out += char.upper() if int(digest[i], 16) >= 8 else char
    return out


def _bech32(addr20: bytes, prefix: str = HRP) -> str:
    from bech32 import bech32_encode, convertbits

    words = convertbits(addr20, 8, 5, pad=True)
    if words is None:  # pragma: no cover - 20 bytes always converts
        raise ValueError("failed to convert address to bech32 words")
    encoded = bech32_encode(prefix, words)
    if encoded is None:  # pragma: no cover
        raise ValueError("failed to encode bech32 address")
    return encoded


def addresses_from_20(addr20: bytes) -> dict[str, str]:
    """Render the three QoreChain encodings from a 20-byte account address.

    Exposed so SDKs / backends can render all three from a known account too.

    :returns: ``{"cosmos", "evm", "svm"}`` - the bech32 (``qor``), EIP-55 hex,
        and base58 (32-byte, right-padded with 12 zero bytes) encodings.
    :raises ValueError: If ``addr20`` is not exactly 20 bytes.
    """
    if len(addr20) != 20:
        raise ValueError("address must be 20 bytes")
    svm_bytes = bytes(addr20) + bytes(12)  # right-pad → unified 32-byte SVM address
    return {
        "cosmos": _bech32(addr20),
        "evm": _eip55(addr20.hex()),
        "svm": base58.b58encode(svm_bytes).decode("ascii"),
    }


def _derive_pqc(cosmos_addr: str, secret_material: str) -> PqcKeypair:
    """Deterministic ML-DSA-87 keypair from ``{cosmos_addr, secret_material}``.

    ``secret_material`` is the full trailing segment of the domain-separated PQC
    seed string: the raw mnemonic (for mnemonic-derived accounts) or
    ``"seed:" + hex(privkey)`` (for seed-derived accounts). Seed =
    ``shake256("qorechain:pqc:v1|" + cosmos + "|" + secret_material, 32)``.
    """
    seed = hashlib.shake_256(
        b"qorechain:pqc:v1|" + cosmos_addr.encode("utf-8") + b"|" + secret_material.encode("utf-8")
    ).digest(32)
    public_key, secret_key = ML_DSA_87.key_derive(seed)
    return PqcKeypair(public_key=bytes(public_key), secret_key=bytes(secret_key))


def _account_from_privkey(
    private_key: bytes,
    secret_material: str | None,
    pqc_secret: bytes | bytearray | None = None,
) -> UnifiedAccount:
    """Build a :class:`UnifiedAccount` from a 32-byte secp256k1 private key.

    The PQC key comes from ``secret_material`` (the ``qorechain:pqc:v1`` string
    derivation) or, when ``pqc_secret`` is given instead, from that independent
    32-byte secret (the recovery-code derivation).
    """
    vk = SigningKey.from_string(private_key, curve=SECP256k1).get_verifying_key()
    uncompressed = vk.to_string("raw")  # 64 bytes: X || Y (no 0x04 prefix)
    compressed = vk.to_string("compressed")  # 33 bytes
    addr20 = keccak256(uncompressed)[12:]  # keccak of the 64-byte X||Y
    enc = addresses_from_20(addr20)
    if pqc_secret is not None:
        pqc = _pqc_key_from_secret(pqc_secret, enc["cosmos"].lower())
    else:
        assert secret_material is not None
        pqc = _derive_pqc(enc["cosmos"], secret_material)
    return UnifiedAccount(
        private_key=bytes(private_key),
        public_key=bytes(compressed),
        address_bytes=bytes(addr20),
        cosmos=enc["cosmos"],
        evm=enc["evm"],
        svm=enc["svm"],
        pqc=pqc,
    )


def derive_unified_account(mnemonic: str, index: int = 0) -> UnifiedAccount:
    """Derive a unified eth-native QoreChain account from a BIP-39 mnemonic.

    HD path ``m/44'/60'/0'/0/{index}`` (secp256k1). The 20-byte account address
    is the Ethereum derivation ``keccak256(uncompressed_pubkey[1:])[12:]``,
    rendered as the ``qor1…`` (bech32), ``0x…`` (EIP-55), and base58 (SVM)
    encodings. The PQC key is a deterministic ML-DSA-87 keypair recoverable from
    ``{cosmos_address, mnemonic}``.

    :param mnemonic: A valid BIP-39 mnemonic (validated; a typo'd phrase raises).
    :param index: The account index in the HD path (default ``0``).
    :raises ValueError: On an invalid mnemonic or a negative index.
    """
    if not validate_mnemonic(mnemonic):
        raise ValueError("invalid mnemonic")
    if not isinstance(index, int) or isinstance(index, bool) or index < 0:
        raise ValueError(f"index must be a non-negative integer, got {index}")
    seed = bytes(Bip39SeedGenerator(mnemonic).Generate())
    node = Bip32Slip10Secp256k1.FromSeed(seed).DerivePath(_ETH_HD_PATH.format(index=index))
    private_key = bytes(node.PrivateKey().Raw().ToBytes())
    return _account_from_privkey(private_key, mnemonic)


#: The error raised when :func:`unified_account_from_seed` gets no PQC option.
_SEED_PQC_OPTION_REQUIRED = (
    "unified_account_from_seed needs a second secret for the PQC key, because the "
    "32-byte seed is the classical spend key. Pass exactly one of: "
    "recovery_code=<a QRC1 recovery code, see generate_pqc_recovery_code()>, "
    "pqc_secret=<32 bytes of independent secret entropy>, or "
    "legacy_seed_derivation=True (only to recover the PQC key of an account created "
    "before 0.13.0, so you can rotate it with MsgRotatePQCKey; never for new accounts)"
)


def unified_account_from_seed(
    seed32: bytes,
    *,
    recovery_code: str | None = None,
    pqc_secret: bytes | None = None,
    legacy_seed_derivation: bool = False,
) -> UnifiedAccount:
    """Build a unified account from a 32-byte seed used directly as the privkey.

    ``seed32`` is used verbatim as the secp256k1 private key (no HD derivation).
    The ML-DSA-87 key needs a second, independent secret, given as exactly one
    of these keyword arguments:

    - ``recovery_code``: a ``QRC1-...`` recovery code
      (:func:`~qorsdk.recovery.generate_pqc_recovery_code`). The PQC key is
      :func:`~qorsdk.recovery.pqc_key_from_recovery_code` for the account's
      ``qor1`` address.
    - ``pqc_secret``: 32 bytes of independent secret entropy, the same secret a
      recovery code carries (:func:`~qorsdk.recovery.pqc_recovery_code_from_secret`
      encodes it as one). A code and its secret give the same key.
    - ``legacy_seed_derivation=True``: the derivation used before 0.13.0, where
      the PQC seed's trailing segment is ``"seed:" + seed32.hex()``, so the PQC
      key follows from ``seed32`` alone. Use it only to recover the PQC key of an
      account created before 0.13.0, so you can rotate it (``MsgRotatePQCKey``)
      to a key from a recovery code; never for new accounts.

    The mnemonic path (:func:`derive_unified_account`) is unchanged.

    .. warning::

       ``seed32`` MUST be real secret entropy - a CSPRNG draw
       (``secrets.token_bytes(32)``) or key material the user already keeps
       secret. It becomes the account's spend key verbatim, so anyone who learns
       it controls the account. It must NEVER be derived from a wallet
       signature, nor from any other value a third party can ask the user's
       wallet (or the user) to produce: such a value is a bearer secret handed
       out on request, so the account it derives is only as private as the party
       that asked for it. To spend from an existing external key, link it with
       ``MsgRegisterAuthenticator`` and use the authenticator lanes
       (``MsgExecuteCosmos`` / ``MsgExecuteEVM``) instead of deriving a new key.

    :raises ValueError: If ``seed32`` is not exactly 32 bytes, if none or more
        than one of the PQC options is given, if ``pqc_secret`` is not 32 bytes
        or is identical to ``seed32``, or if ``recovery_code`` is malformed or fails its checksum.
    """
    if len(seed32) != 32:
        raise ValueError("seed must be 32 bytes")
    if not isinstance(legacy_seed_derivation, bool):
        raise ValueError("legacy_seed_derivation must be True or False")
    chosen = sum(
        (recovery_code is not None, pqc_secret is not None, legacy_seed_derivation is True)
    )
    if chosen == 0:
        raise ValueError(_SEED_PQC_OPTION_REQUIRED)
    if chosen > 1:
        raise ValueError(
            "unified_account_from_seed: pass only one of recovery_code, pqc_secret "
            "or legacy_seed_derivation=True"
        )
    if legacy_seed_derivation is True:
        return _account_from_privkey(bytes(seed32), "seed:" + bytes(seed32).hex())
    if pqc_secret is not None:
        if not isinstance(pqc_secret, (bytes, bytearray)) or len(pqc_secret) != 32:
            raise ValueError("pqc_secret must be 32 bytes")
        if hmac.compare_digest(bytes(pqc_secret), bytes(seed32)):
            raise ValueError(
                "pqc_secret must be independent of seed32: the same bytes would make the "
                "PQC key derivable from the classical key"
            )
        return _account_from_privkey(bytes(seed32), None, pqc_secret=pqc_secret)
    assert recovery_code is not None
    secret = _decode_recovery_code(recovery_code)
    try:
        return _account_from_privkey(bytes(seed32), None, pqc_secret=secret)
    finally:
        secret[:] = bytes(len(secret))


#: The error raised by the removed signature-derivation entry point.
_SIGNATURE_DERIVATION_REMOVED = (
    "unified_account_from_phantom_signature was removed in v0.8.0: deriving a "
    "spend key from a wallet signature is unsafe - the signature is a bearer "
    "secret that any page can request from the wallet, so whoever obtains it "
    "controls the account. Use the authenticator lanes instead: register the "
    "external key with MsgRegisterAuthenticator and spend via MsgExecuteCosmos "
    "/ MsgExecuteEVM. Any account previously derived this way must be treated "
    "as exposed - move its funds."
)


def unified_account_from_phantom_signature(sig_bytes: bytes) -> UnifiedAccount:
    """REMOVED in v0.8.0 - always raises :class:`NotImplementedError`.

    This used to derive a unified account's spend key from a wallet signature.
    That is unsafe: the signature is a bearer secret the wallet will hand to any
    page that asks for it, so anyone who obtains it controls the derived
    account. The symbol is retained only so existing callers fail loudly instead
    of silently keeping an exposed account.

    Use the authenticator lanes instead - register the external key with
    ``MsgRegisterAuthenticator`` (see :mod:`qorsdk.authenticator`) and spend from
    the canonical account via ``MsgExecuteCosmos`` / ``MsgExecuteEVM``. Any
    account previously derived this way must be treated as exposed: move its
    funds.

    :raises NotImplementedError: Always.
    """
    raise NotImplementedError(_SIGNATURE_DERIVATION_REMOVED)


def qore_addresses(
    *, cosmos: str | None = None, evm: str | None = None, hex: str | None = None
) -> dict[str, str]:
    """Render the three encodings of an existing account from any one form.

    Provide exactly one of ``cosmos`` (a ``qor1…`` bech32), ``evm`` (a ``0x`` hex
    address), or ``hex`` (a bare/``0x`` 20-byte hex). Returns
    ``{"cosmos", "evm", "svm"}``.

    :raises ValueError: If none (or more than the payload of one) is provided, or
        the input does not decode to 20 bytes.
    """
    if evm is not None:
        addr20 = bytes.fromhex(evm[2:] if evm[:2].lower() == "0x" else evm)
    elif hex is not None:
        addr20 = bytes.fromhex(hex[2:] if hex[:2].lower() == "0x" else hex)
    elif cosmos is not None:
        from bech32 import bech32_decode, convertbits

        _hrp, words = bech32_decode(cosmos)
        if words is None:
            raise ValueError(f"invalid bech32 address: {cosmos}")
        data = convertbits(words, 5, 8, pad=False)
        if data is None:
            raise ValueError(f"invalid bech32 payload: {cosmos}")
        addr20 = bytes(data)
    else:
        raise ValueError("provide one of {cosmos, evm, hex}")
    return addresses_from_20(addr20)
