//! PQC key registration integrity (chain v3.2.3).
//!
//! From v3.2.3 the chain refuses a registration that protects nothing, and
//! accepts proof that the registrant holds the key's secret:
//!
//! - `key_type = "classical_only"` registers no post-quantum key, and the
//!   account could then never sign a transaction again;
//! - an empty public key;
//! - a degenerate ML-DSA-87 key, whose `t1` part (every byte after the 32-byte
//!   `rho`) is zero: anyone can forge signatures for it;
//! - `proof_of_possession` (optional now, to become mandatory): the key's own
//!   ML-DSA signature over
//!   `"qorechain-pqc-pop-v1|<chain-id>|<algorithm>|<account>|<hex(public key)>"`,
//!   lower-case hex, deterministic, empty context.
//!
//! Also from v3.2.3 an account that already has a key must send register /
//! migrate with the hybrid signature (send `MsgMigratePQCKey` through
//! [`crate::pqc_dx::PqcDx::build_hybrid`] with the CURRENT key), a rotation or
//! migration to a key the account used before is refused, and none of the
//! key-management messages may travel inside authz `MsgExec`.
//!
//! `proof_of_possession` is a new field: a node below v3.2.3 refuses the whole
//! transaction when it is set. Set it only once the network has applied v3.2.3
//! ([`crate::upgrades::is_upgrade_applied`] with
//! [`crate::upgrades::CHAIN_UPGRADE_V3_2_3`]).

use crate::pqc::{pqc_sign, pqc_verify, ALGORITHM_DILITHIUM5};
use crate::{Error, Result};

/// Size of an ML-DSA-87 public key.
pub const ML_DSA_87_PUBLIC_KEY_LENGTH: usize = 2592;
/// The key type the chain refuses from v3.2.3.
pub const KEY_TYPE_CLASSICAL_ONLY: &str = "classical_only";
/// Domain of the proof-of-possession sign-bytes.
pub const PROOF_OF_POSSESSION_DOMAIN: &str = "qorechain-pqc-pop-v1";

const RHO_LENGTH: usize = 32;

/// Whether `public_key` is an ML-DSA-87 key nobody needs a secret for: right
/// length, every byte after `rho` zero. Keys of another length are not judged.
pub fn is_degenerate_pqc_public_key(public_key: &[u8]) -> bool {
    public_key.len() == ML_DSA_87_PUBLIC_KEY_LENGTH
        && public_key[RHO_LENGTH..].iter().all(|b| *b == 0)
}

/// Refuses a registration the chain refuses from v3.2.3. Not network-gated:
/// such a registration protects nothing, or locks the account, on any network.
///
/// # Errors
///
/// [`Error::Pqc`] naming the reason.
pub fn validate_registered_pqc_key(key_type: &str, public_key: &[u8]) -> Result<()> {
    if key_type == KEY_TYPE_CLASSICAL_ONLY {
        return Err(Error::Pqc(
            "key_type \"classical_only\" registers no post-quantum key; the account would be \
             unable to sign any transaction afterwards"
                .into(),
        ));
    }
    if public_key.is_empty() {
        return Err(Error::Pqc("a post-quantum public key is required".into()));
    }
    if is_degenerate_pqc_public_key(public_key) {
        return Err(Error::Pqc(
            "the key's t1 part is all zero, so anyone can forge its signatures".into(),
        ));
    }
    Ok(())
}

/// The bytes the key being registered signs to prove its owner holds the
/// secret. They name the chain, the algorithm, the account and the key.
///
/// # Errors
///
/// [`Error::Pqc`] when `chain_id` or `account` is empty.
pub fn proof_of_possession_sign_bytes(
    chain_id: &str,
    algorithm_id: u32,
    account: &str,
    public_key: &[u8],
) -> Result<Vec<u8>> {
    if chain_id.is_empty() || account.is_empty() {
        return Err(Error::Pqc(
            "proof of possession: chain id and account are required".into(),
        ));
    }
    Ok(format!(
        "{PROOF_OF_POSSESSION_DOMAIN}|{chain_id}|{algorithm_id}|{account}|{}",
        hex::encode(public_key)
    )
    .into_bytes())
}

/// Signs the proof of possession with the key being registered (deterministic
/// ML-DSA-87). Set the result as `MsgRegisterPqcKeyV2::proof_of_possession` -
/// only on a network that has applied v3.2.3.
///
/// # Errors
///
/// As [`proof_of_possession_sign_bytes`] and [`pqc_sign`].
pub fn sign_proof_of_possession(
    chain_id: &str,
    account: &str,
    public_key: &[u8],
    secret_key: &[u8],
) -> Result<Vec<u8>> {
    let bytes =
        proof_of_possession_sign_bytes(chain_id, ALGORITHM_DILITHIUM5, account, public_key)?;
    pqc_sign(secret_key, &bytes)
}

/// Verifies a proof of possession locally, as the chain will.
pub fn verify_proof_of_possession(
    chain_id: &str,
    account: &str,
    public_key: &[u8],
    proof: &[u8],
) -> bool {
    match proof_of_possession_sign_bytes(chain_id, ALGORITHM_DILITHIUM5, account, public_key) {
        Ok(bytes) => pqc_verify(public_key, &bytes, proof),
        Err(_) => false,
    }
}
