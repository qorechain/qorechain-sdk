//! Typed message constructors (composers) for every QoreChain custom-module
//! message and the standard Cosmos message types, plus the [`to_any`] helper
//! that packs any prost message into a `cosmrs::Any` with the correct
//! `type_url`.
//!
//! Each composer is a thin, typed constructor that returns the generated prost
//! message ready to pass to [`to_any`] and then to
//! [`crate::tx::send_messages`] / [`crate::tx::build_hybrid_tx`]. The composers
//! are grouped per module (`msg::amm`, `msg::bridge`, …) so callers write
//! `msg::amm::swap_exact_in(...)` and `msg::to_any(&m, msg::amm::SWAP_EXACT_IN)`,
//! or use the convenience `*_any` wrappers that return a `cosmrs::Any` directly.
//!
//! The custom-module messages all live in package `qorechain.<module>.v1`, so
//! every type URL is `/qorechain.<module>.v1.Msg*`. Type URLs are exposed as
//! public constants so they can be asserted and reused.

use cosmrs::Any;
use prost::Message;

pub mod abstractaccount;
pub mod amm;
pub mod bridge;
pub mod cosmos;
pub mod crossvm;
pub mod license;
pub mod lightnode;
pub mod multilayer;
pub mod pqc;
pub mod rdk;
pub mod rlconsensus;
pub mod svm;

/// Packs a prost message into a `cosmrs::Any` with the given `type_url`.
///
/// `value = msg.encode_to_vec()`, so the resulting `Any` is byte-identical to
/// what the chain produces for the same message — this is what lets a custom Msg
/// ride in a tx body and be decoded back through the chain's interface registry.
pub fn to_any<M: Message>(msg: &M, type_url: &str) -> Any {
    Any {
        type_url: type_url.to_string(),
        value: msg.encode_to_vec(),
    }
}

/// Decodes the `value` of an `Any` back into a concrete prost message of type
/// `M`. The caller is responsible for matching `any.type_url` to `M`.
pub fn from_any<M: Message + Default>(any: &Any) -> Result<M, prost::DecodeError> {
    M::decode(any.value.as_slice())
}
