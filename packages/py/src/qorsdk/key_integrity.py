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
transaction when it is set. Attach it only once the network has applied v3.2.3
(:func:`qorsdk.upgrades.is_upgrade_applied` with ``CHAIN_UPGRADE_V3_2_3``).
"""

from __future__ import annotations

from .pqc import PqcKeypair, pqc_sign, pqc_verify

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
