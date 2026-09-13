//! `qorechain.crossvm.v1` message composers.

use crate::msg::to_any;
use crate::proto::qorechain::crossvm::v1 as pb;
use cosmrs::proto::cosmos::base::v1beta1::Coin;
use cosmrs::Any;

/// `/qorechain.crossvm.v1.MsgCrossVMCall` type URL.
pub const CROSS_VM_CALL: &str = "/qorechain.crossvm.v1.MsgCrossVMCall";
/// `/qorechain.crossvm.v1.MsgProcessQueue` type URL.
pub const PROCESS_QUEUE: &str = "/qorechain.crossvm.v1.MsgProcessQueue";

/// `/qorechain.crossvm.v1.MsgCrossVMCallResponse` type URL — the `Msg` service
/// response the chain returns for a [`CROSS_VM_CALL`].
pub const CROSS_VM_CALL_RESPONSE: &str = "/qorechain.crossvm.v1.MsgCrossVMCallResponse";

/// Builds `MsgCrossVMCall`. `source_vm` / `target_vm` are the VM-type strings
/// (e.g. `"VM_TYPE_EVM"`, `"VM_TYPE_SVM"`, `"VM_TYPE_WASM"`).
///
/// `source_vm` is **ignored by the chain** (chain v3.1.97 and later): the origin
/// lane is derived from the execution context, not from what the caller claims to
/// be. The field is still sent so older nodes keep accepting the message.
///
/// `queue` maps to the proto's `async` field (a Rust keyword, emitted by prost as
/// `r#async`). The default, `false`, executes the call inside this transaction
/// and returns the callee's answer in `MsgCrossVMCallResponse`; `true` only
/// enqueues it for a later `MsgProcessQueue` dispatch, so no result is available
/// yet.
pub fn cross_vm_call(
    sender: impl Into<String>,
    source_vm: impl Into<String>,
    target_vm: impl Into<String>,
    target_contract: impl Into<String>,
    payload: Vec<u8>,
    funds: Vec<Coin>,
    queue: bool,
) -> pb::MsgCrossVmCall {
    pb::MsgCrossVmCall {
        sender: sender.into(),
        source_vm: source_vm.into(),
        target_vm: target_vm.into(),
        target_contract: target_contract.into(),
        payload,
        funds,
        r#async: queue,
    }
}

/// Builds `MsgCrossVMCall` packed into an `Any`. See [`cross_vm_call`] for the
/// meaning of `source_vm` (ignored on input) and `queue` (the proto `async`).
#[allow(clippy::too_many_arguments)]
pub fn cross_vm_call_any(
    sender: impl Into<String>,
    source_vm: impl Into<String>,
    target_vm: impl Into<String>,
    target_contract: impl Into<String>,
    payload: Vec<u8>,
    funds: Vec<Coin>,
    queue: bool,
) -> Any {
    to_any(
        &cross_vm_call(
            sender,
            source_vm,
            target_vm,
            target_contract,
            payload,
            funds,
            queue,
        ),
        CROSS_VM_CALL,
    )
}

/// Builds `MsgProcessQueue`.
pub fn process_queue(authority: impl Into<String>) -> pb::MsgProcessQueue {
    pb::MsgProcessQueue {
        authority: authority.into(),
    }
}

/// Builds `MsgProcessQueue` packed into an `Any`.
pub fn process_queue_any(authority: impl Into<String>) -> Any {
    to_any(&process_queue(authority), PROCESS_QUEUE)
}
