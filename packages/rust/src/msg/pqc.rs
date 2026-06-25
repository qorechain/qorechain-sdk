//! `qorechain.pqc.v1` message composers.
//!
//! The generated prost type names normalize the proto `PQC` acronym to `Pqc`
//! (e.g. `MsgRegisterPqcKey`), but the on-chain type URLs use the original proto
//! message names (`MsgRegisterPQCKey`), which is what the chain's interface
//! registry resolves — the constants below carry those exact strings.

use crate::msg::to_any;
use crate::proto::qorechain::pqc::v1 as pb;
use cosmrs::Any;

/// `/qorechain.pqc.v1.MsgRegisterPQCKey` type URL (legacy v1).
pub const REGISTER_PQC_KEY: &str = "/qorechain.pqc.v1.MsgRegisterPQCKey";
/// `/qorechain.pqc.v1.MsgRegisterPQCKeyV2` type URL.
pub const REGISTER_PQC_KEY_V2: &str = "/qorechain.pqc.v1.MsgRegisterPQCKeyV2";
/// `/qorechain.pqc.v1.MsgMigratePQCKey` type URL.
pub const MIGRATE_PQC_KEY: &str = "/qorechain.pqc.v1.MsgMigratePQCKey";
/// `/qorechain.pqc.v1.MsgDeprecateAlgorithm` type URL.
pub const DEPRECATE_ALGORITHM: &str = "/qorechain.pqc.v1.MsgDeprecateAlgorithm";
/// `/qorechain.pqc.v1.MsgDisableAlgorithm` type URL.
pub const DISABLE_ALGORITHM: &str = "/qorechain.pqc.v1.MsgDisableAlgorithm";

/// Builds `MsgRegisterPQCKey` (legacy v1, defaults to Dilithium-5).
pub fn register_pqc_key(
    sender: impl Into<String>,
    dilithium_pubkey: Vec<u8>,
    ecdsa_pubkey: Vec<u8>,
    key_type: impl Into<String>,
) -> pb::MsgRegisterPqcKey {
    pb::MsgRegisterPqcKey {
        sender: sender.into(),
        dilithium_pubkey,
        ecdsa_pubkey,
        key_type: key_type.into(),
    }
}

/// Builds `MsgRegisterPQCKey` packed into an `Any`.
pub fn register_pqc_key_any(
    sender: impl Into<String>,
    dilithium_pubkey: Vec<u8>,
    ecdsa_pubkey: Vec<u8>,
    key_type: impl Into<String>,
) -> Any {
    to_any(
        &register_pqc_key(sender, dilithium_pubkey, ecdsa_pubkey, key_type),
        REGISTER_PQC_KEY,
    )
}

/// Builds `MsgRegisterPQCKeyV2` with explicit algorithm selection.
pub fn register_pqc_key_v2(
    sender: impl Into<String>,
    public_key: Vec<u8>,
    algorithm_id: u32,
    ecdsa_pubkey: Vec<u8>,
    key_type: impl Into<String>,
) -> pb::MsgRegisterPqcKeyV2 {
    pb::MsgRegisterPqcKeyV2 {
        sender: sender.into(),
        public_key,
        algorithm_id,
        ecdsa_pubkey,
        key_type: key_type.into(),
    }
}

/// Builds `MsgRegisterPQCKeyV2` packed into an `Any`.
pub fn register_pqc_key_v2_any(
    sender: impl Into<String>,
    public_key: Vec<u8>,
    algorithm_id: u32,
    ecdsa_pubkey: Vec<u8>,
    key_type: impl Into<String>,
) -> Any {
    to_any(
        &register_pqc_key_v2(sender, public_key, algorithm_id, ecdsa_pubkey, key_type),
        REGISTER_PQC_KEY_V2,
    )
}

/// Builds `MsgMigratePQCKey`.
pub fn migrate_pqc_key(
    sender: impl Into<String>,
    old_public_key: Vec<u8>,
    new_public_key: Vec<u8>,
    new_algorithm_id: u32,
    old_signature: Vec<u8>,
    new_signature: Vec<u8>,
) -> pb::MsgMigratePqcKey {
    pb::MsgMigratePqcKey {
        sender: sender.into(),
        old_public_key,
        new_public_key,
        new_algorithm_id,
        old_signature,
        new_signature,
    }
}

/// Builds `MsgMigratePQCKey` packed into an `Any`.
pub fn migrate_pqc_key_any(
    sender: impl Into<String>,
    old_public_key: Vec<u8>,
    new_public_key: Vec<u8>,
    new_algorithm_id: u32,
    old_signature: Vec<u8>,
    new_signature: Vec<u8>,
) -> Any {
    to_any(
        &migrate_pqc_key(
            sender,
            old_public_key,
            new_public_key,
            new_algorithm_id,
            old_signature,
            new_signature,
        ),
        MIGRATE_PQC_KEY,
    )
}

/// Builds `MsgDeprecateAlgorithm`.
pub fn deprecate_algorithm(
    authority: impl Into<String>,
    algorithm_id: u32,
    migration_blocks: i64,
    replacement_algorithm_id: u32,
) -> pb::MsgDeprecateAlgorithm {
    pb::MsgDeprecateAlgorithm {
        authority: authority.into(),
        algorithm_id,
        migration_blocks,
        replacement_algorithm_id,
    }
}

/// Builds `MsgDeprecateAlgorithm` packed into an `Any`.
pub fn deprecate_algorithm_any(
    authority: impl Into<String>,
    algorithm_id: u32,
    migration_blocks: i64,
    replacement_algorithm_id: u32,
) -> Any {
    to_any(
        &deprecate_algorithm(
            authority,
            algorithm_id,
            migration_blocks,
            replacement_algorithm_id,
        ),
        DEPRECATE_ALGORITHM,
    )
}

/// Builds `MsgDisableAlgorithm`.
pub fn disable_algorithm(
    authority: impl Into<String>,
    algorithm_id: u32,
    reason: impl Into<String>,
) -> pb::MsgDisableAlgorithm {
    pb::MsgDisableAlgorithm {
        authority: authority.into(),
        algorithm_id,
        reason: reason.into(),
    }
}

/// Builds `MsgDisableAlgorithm` packed into an `Any`.
pub fn disable_algorithm_any(
    authority: impl Into<String>,
    algorithm_id: u32,
    reason: impl Into<String>,
) -> Any {
    to_any(
        &disable_algorithm(authority, algorithm_id, reason),
        DISABLE_ALGORITHM,
    )
}
