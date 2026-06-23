"""Mnemonic generation/validation and hierarchical-deterministic (HD) derivation
of QoreChain accounts in all three supported schemes:

1. native — Cosmos-style secp256k1, BIP-44 path ``m/44'/118'/0'/0/{index}``,
   address = bech32(``qor``, ripemd160(sha256(compressed_pubkey))).
2. evm    — secp256k1, BIP-44 path ``m/44'/60'/0'/0/{index}``,
   address = ``0x`` + last 20 bytes of keccak256(uncompressed_pubkey[1:]),
   rendered with an EIP-55 mixed-case checksum.
3. svm    — ed25519, SLIP-0010 path ``m/44'/501'/{index}'/0'`` (all hardened,
   the Solana standard), address = base58(32-byte ed25519 public key).

Derivation uses the audited ``bip-utils`` library (BIP-39 mnemonic + seed,
BIP-44/SLIP-0010 HD for secp256k1 and ed25519, and the address schemes). Secret
material is returned explicitly from the derive functions and is never logged.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

import base58
from bip_utils import (
    Bip32Slip10Ed25519,
    Bip32Slip10Secp256k1,
    Bip39MnemonicGenerator,
    Bip39MnemonicValidator,
    Bip39SeedGenerator,
    Bip39WordsNum,
    EthAddrEncoder,
)
from bip_utils.bech32 import Bech32Encoder

#: Bech32 human-readable prefix for native QoreChain account addresses.
NATIVE_PREFIX = "qor"

# Coin types per SLIP-0044.
_COIN_TYPE_NATIVE = 118  # Cosmos
_COIN_TYPE_EVM = 60  # Ethereum
_COIN_TYPE_SVM = 501  # Solana

_STRENGTH_TO_WORDS = {
    128: Bip39WordsNum.WORDS_NUM_12,
    256: Bip39WordsNum.WORDS_NUM_24,
}


@dataclass(frozen=True)
class Secp256k1Account:
    """A secp256k1-based account (native or EVM). Treat ``private_key`` secret."""

    type: str
    address: str
    public_key: bytes
    private_key: bytes


@dataclass(frozen=True)
class Ed25519Account:
    """An ed25519-based (SVM/Solana) account. Treat ``secret_key`` as secret."""

    type: str
    address: str
    public_key: bytes
    #: 64-byte Solana-style secret key (``private_seed32 || public_key32``).
    secret_key: bytes


def generate_mnemonic(strength: int = 128) -> str:
    """Generate a fresh BIP-39 mnemonic.

    :param strength: Entropy in bits: ``128`` -> 12 words (default),
        ``256`` -> 24 words.
    :returns: A space-separated English mnemonic phrase.
    """
    words_num = _STRENGTH_TO_WORDS.get(strength)
    if words_num is None:
        raise ValueError(f"unsupported strength: {strength} (use 128 or 256)")
    return str(Bip39MnemonicGenerator().FromWordsNumber(words_num).ToStr())


def validate_mnemonic(mnemonic: str) -> bool:
    """Validate a BIP-39 mnemonic against the English wordlist and checksum.

    :returns: ``True`` if valid; ``False`` otherwise. Never raises.
    """
    return bool(Bip39MnemonicValidator().IsValid(mnemonic))


def _resolve_index(account_index: int) -> int:
    if not isinstance(account_index, int) or isinstance(account_index, bool) or account_index < 0:
        raise ValueError(
            f"account_index must be a non-negative integer, got {account_index}"
        )
    return account_index


def _seed_from_mnemonic(mnemonic: str) -> bytes:
    """Validate a mnemonic and derive its BIP-39 seed.

    Centralizing this here guards against the fund-loss footgun where a typo'd
    phrase (valid words, wrong checksum) would silently derive a valid-looking
    but WRONG account. The error deliberately omits the mnemonic text.
    """
    if not validate_mnemonic(mnemonic):
        raise ValueError("invalid mnemonic")
    return bytes(Bip39SeedGenerator(mnemonic).Generate())


def derive_native_account(mnemonic: str, account_index: int = 0) -> Secp256k1Account:
    """Derive a native QoreChain account (Cosmos-style secp256k1).

    Path: ``m/44'/118'/0'/0/{account_index}``. The address is the bech32
    (``qor``) encoding of ``ripemd160(sha256(compressed_public_key))``.
    """
    index = _resolve_index(account_index)
    seed = _seed_from_mnemonic(mnemonic)
    node = Bip32Slip10Secp256k1.FromSeed(seed).DerivePath(
        f"44'/{_COIN_TYPE_NATIVE}'/0'/0/{index}"
    )
    compressed = bytes(node.PublicKey().RawCompressed().ToBytes())
    digest = hashlib.new("ripemd160", hashlib.sha256(compressed).digest()).digest()
    address = str(Bech32Encoder.Encode(NATIVE_PREFIX, digest))
    private_key = bytes(node.PrivateKey().Raw().ToBytes())
    return Secp256k1Account(
        type="native", address=address, public_key=compressed, private_key=private_key
    )


def derive_evm_account(mnemonic: str, account_index: int = 0) -> Secp256k1Account:
    """Derive an EVM account from a mnemonic.

    Path: ``m/44'/60'/0'/0/{account_index}``. The address is the last 20 bytes
    of ``keccak256(uncompressed_public_key[1:])``, EIP-55 checksummed.
    """
    index = _resolve_index(account_index)
    seed = _seed_from_mnemonic(mnemonic)
    node = Bip32Slip10Secp256k1.FromSeed(seed).DerivePath(
        f"44'/{_COIN_TYPE_EVM}'/0'/0/{index}"
    )
    pub = node.PublicKey()
    compressed = bytes(pub.RawCompressed().ToBytes())
    # EthAddrEncoder applies keccak256(uncompressed[1:])[-20:] with EIP-55.
    address = str(EthAddrEncoder.EncodeKey(pub.KeyObject()))
    private_key = bytes(node.PrivateKey().Raw().ToBytes())
    return Secp256k1Account(
        type="evm", address=address, public_key=compressed, private_key=private_key
    )


def derive_svm_account(mnemonic: str, account_index: int = 0) -> Ed25519Account:
    """Derive an SVM (Solana-style ed25519) account from a mnemonic.

    Path: ``m/44'/501'/{account_index}'/0'`` — the conventional Solana
    derivation, all segments hardened (SLIP-0010 for ed25519 supports hardened
    keys only). The address is the base58 encoding of the 32-byte public key.
    The returned ``secret_key`` is the 64-byte Solana form
    (``private_seed32 || public_key32``).
    """
    index = _resolve_index(account_index)
    seed = _seed_from_mnemonic(mnemonic)
    node = Bip32Slip10Ed25519.FromSeed(seed).DerivePath(
        f"44'/{_COIN_TYPE_SVM}'/{index}'/0'"
    )
    # bip-utils prepends a 0x00 prefix byte to raw ed25519 public keys.
    raw_pub = bytes(node.PublicKey().RawCompressed().ToBytes())
    public_key = raw_pub[1:] if len(raw_pub) == 33 else raw_pub
    private_seed = bytes(node.PrivateKey().Raw().ToBytes())
    secret_key = private_seed + public_key
    address = base58.b58encode(public_key).decode("ascii")
    return Ed25519Account(
        type="svm", address=address, public_key=public_key, secret_key=secret_key
    )
