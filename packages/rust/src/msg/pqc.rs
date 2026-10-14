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
/// `/qorechain.pqc.v1.MsgRotatePQCKey` type URL.
pub const ROTATE_PQC_KEY: &str = "/qorechain.pqc.v1.MsgRotatePQCKey";

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
        // Optional from chain v3.2.3. Left empty it stays off the wire, so a
        // node below v3.2.3 accepts the message; see `pqc_dx` for attaching it.
        proof_of_possession: Vec::new(),
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

/// Builds `MsgMigratePQCKey`. `old_signature` / `new_signature` cover the
/// per-network migration sign-bytes ([`crate::signbytes::migration_sign_bytes`],
/// v1 or v2 as the chain verifies).
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

/// Builds `MsgRotatePQCKey` (v3.1.85): rotates an account's PQC key to a NEW key
/// of the SAME algorithm. Both `old_signature` and `new_signature` are ML-DSA-87
/// signatures over the domain-separated rotation string (see
/// [`crate::authenticator::rotation_sign_bytes`]). The message is `sender`-signed
/// and must be broadcast hybrid-cosigned with the OLD key (still the registered
/// key until the rotation lands).
pub fn rotate_pqc_key(
    sender: impl Into<String>,
    old_public_key: Vec<u8>,
    new_public_key: Vec<u8>,
    old_signature: Vec<u8>,
    new_signature: Vec<u8>,
) -> pb::MsgRotatePqcKey {
    pb::MsgRotatePqcKey {
        sender: sender.into(),
        old_public_key,
        new_public_key,
        old_signature,
        new_signature,
    }
}

/// Builds `MsgRotatePQCKey` packed into an `Any`.
pub fn rotate_pqc_key_any(
    sender: impl Into<String>,
    old_public_key: Vec<u8>,
    new_public_key: Vec<u8>,
    old_signature: Vec<u8>,
    new_signature: Vec<u8>,
) -> Any {
    to_any(
        &rotate_pqc_key(
            sender,
            old_public_key,
            new_public_key,
            old_signature,
            new_signature,
        ),
        ROTATE_PQC_KEY,
    )
}

// --------------------------------------------------------------------------- //
// v3.2.0: the EVM authorisation window
// --------------------------------------------------------------------------- //

/// `/qorechain.pqc.v1.MsgOpenEVMWindow` type URL (chain v3.2.0).
pub const OPEN_EVM_WINDOW: &str = "/qorechain.pqc.v1.MsgOpenEVMWindow";
/// `/qorechain.pqc.v1.MsgCloseEVMWindow` type URL (chain v3.2.0).
pub const CLOSE_EVM_WINDOW: &str = "/qorechain.pqc.v1.MsgCloseEVMWindow";

/// Builds `MsgOpenEVMWindow`, validating the bounds the chain enforces in
/// `ValidateBasic` so a caller fails fast instead of paying for a refused
/// transaction.
///
/// From chain v3.2.0 an EVM-lane transaction is admitted only from an account
/// that has a registered post-quantum key AND an open, unexhausted window. This
/// message travels the **Cosmos lane**, so it carries the account's hybrid
/// signature — the classical key alone can never open a window. Opening
/// **replaces** any existing window rather than adding to it.
///
/// Every field is required: the chain refuses an omitted field rather than
/// defaulting it. `blocks` must be in `1..=17280`
/// ([`MAX_EVM_WINDOW_BLOCKS`](crate::evm_window::MAX_EVM_WINDOW_BLOCKS)),
/// `max_txs` in `1..=1000`
/// ([`MAX_EVM_WINDOW_TXS`](crate::evm_window::MAX_EVM_WINDOW_TXS)), and
/// `max_value` a positive integer uqor amount (`cosmos.Int`).
///
/// Three traps, in full in [`crate::evm_window`]: opening **advances** the
/// account's sequence, which is also the EVM nonce (open, then read the nonce,
/// then sign the EVM transaction); `max_value` bounds the transferred value
/// **plus** the maximum fee (gas limit × gas fee cap); and 17280 blocks is NOT
/// "about 24 hours" on any live QoreChain network.
///
/// # Errors
///
/// Returns [`Error::EvmWindow`](crate::Error::EvmWindow) naming the bound that
/// was violated.
pub fn open_evm_window(
    sender: impl Into<String>,
    blocks: u64,
    max_txs: u64,
    max_value: &str,
) -> crate::Result<pb::MsgOpenEvmWindow> {
    let params = crate::evm_window::validate_evm_window_params(blocks, max_txs, max_value)?;
    Ok(pb::MsgOpenEvmWindow {
        sender: sender.into(),
        blocks: params.blocks,
        max_txs: params.max_txs,
        max_value: params.max_value,
        // The optional scope (chain v3.2.3) stays off the wire unless set with
        // `open_evm_window_scoped`, so a node below v3.2.3 accepts the message.
        native_only: false,
        allowed_targets: Vec::new(),
    })
}

/// Builds `MsgOpenEVMWindow` packed into an `Any`.
///
/// # Errors
///
/// Returns [`Error::EvmWindow`](crate::Error::EvmWindow) naming the violated
/// bound, exactly as [`open_evm_window`].
pub fn open_evm_window_any(
    sender: impl Into<String>,
    blocks: u64,
    max_txs: u64,
    max_value: &str,
) -> crate::Result<Any> {
    Ok(to_any(
        &open_evm_window(sender, blocks, max_txs, max_value)?,
        OPEN_EVM_WINDOW,
    ))
}

/// Builds `MsgCloseEVMWindow`: closes the sender's window, effective in the same
/// block.
pub fn close_evm_window(sender: impl Into<String>) -> pb::MsgCloseEvmWindow {
    pb::MsgCloseEvmWindow {
        sender: sender.into(),
    }
}

/// Builds `MsgCloseEVMWindow` packed into an `Any`.
pub fn close_evm_window_any(sender: impl Into<String>) -> Any {
    to_any(&close_evm_window(sender), CLOSE_EVM_WINDOW)
}

// --------------------------------------------------------------------------- //
// v3.2.2: EIP-7702 delegation consent
// --------------------------------------------------------------------------- //

/// `/qorechain.pqc.v1.MsgAuthorizeEVMDelegation` type URL (chain v3.2.2).
pub const AUTHORIZE_EVM_DELEGATION: &str = "/qorechain.pqc.v1.MsgAuthorizeEVMDelegation";
/// `/qorechain.pqc.v1.MsgClearEVMDelegation` type URL (chain v3.2.2).
pub const CLEAR_EVM_DELEGATION: &str = "/qorechain.pqc.v1.MsgClearEVMDelegation";

/// Builds `MsgAuthorizeEVMDelegation`: the sender's post-quantum consent to one
/// EIP-7702 delegation of its own account (chain v3.2.2). Single use, bounded in
/// blocks (`1..=17280`), replaces any earlier consent, revoked by
/// `MsgCloseEVMWindow`. Broadcasting it ADVANCES the account's nonce; see
/// [`crate::evm_delegation`] for the ordering.
///
/// # Errors
///
/// [`Error::Pqc`](crate::Error::Pqc) when the delegate or the bound is invalid.
pub fn authorize_evm_delegation(
    sender: impl Into<String>,
    delegate: &str,
    blocks: u64,
) -> crate::Result<pb::MsgAuthorizeEvmDelegation> {
    let delegate = crate::evm_delegation::validate_evm_delegation_consent(delegate, blocks)?;
    Ok(pb::MsgAuthorizeEvmDelegation {
        sender: sender.into(),
        delegate,
        blocks,
    })
}

/// Builds `MsgAuthorizeEVMDelegation` packed into an `Any`.
///
/// # Errors
///
/// As [`authorize_evm_delegation`].
pub fn authorize_evm_delegation_any(
    sender: impl Into<String>,
    delegate: &str,
    blocks: u64,
) -> crate::Result<Any> {
    Ok(to_any(
        &authorize_evm_delegation(sender, delegate, blocks)?,
        AUTHORIZE_EVM_DELEGATION,
    ))
}

/// Builds `MsgClearEVMDelegation`: removes the sender's installed delegation on
/// the Cosmos lane, with no EVM transaction (chain v3.2.2).
pub fn clear_evm_delegation(sender: impl Into<String>) -> pb::MsgClearEvmDelegation {
    pb::MsgClearEvmDelegation {
        sender: sender.into(),
    }
}

/// Builds `MsgClearEVMDelegation` packed into an `Any`.
pub fn clear_evm_delegation_any(sender: impl Into<String>) -> Any {
    to_any(&clear_evm_delegation(sender), CLEAR_EVM_DELEGATION)
}
