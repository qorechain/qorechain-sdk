//! `qorechain.crossvm.v1` message composers.

use crate::msg::to_any;
use crate::proto::qorechain::crossvm::v1 as pb;
use cosmrs::proto::cosmos::base::v1beta1::Coin;
use cosmrs::Any;

/// `/qorechain.crossvm.v1.MsgCrossVMCall` type URL.
pub const CROSS_VM_CALL: &str = "/qorechain.crossvm.v1.MsgCrossVMCall";
/// `/qorechain.crossvm.v1.MsgProcessQueue` type URL.
pub const PROCESS_QUEUE: &str = "/qorechain.crossvm.v1.MsgProcessQueue";

/// Builds `MsgCrossVMCall`. `source_vm` / `target_vm` are the VM-type strings
/// (e.g. `"VM_TYPE_EVM"`, `"VM_TYPE_SVM"`, `"VM_TYPE_WASM"`).
pub fn cross_vm_call(
    sender: impl Into<String>,
    source_vm: impl Into<String>,
    target_vm: impl Into<String>,
    target_contract: impl Into<String>,
    payload: Vec<u8>,
    funds: Vec<Coin>,
) -> pb::MsgCrossVmCall {
    pb::MsgCrossVmCall {
        sender: sender.into(),
        source_vm: source_vm.into(),
        target_vm: target_vm.into(),
        target_contract: target_contract.into(),
        payload,
        funds,
    }
}

/// Builds `MsgCrossVMCall` packed into an `Any`.
pub fn cross_vm_call_any(
    sender: impl Into<String>,
    source_vm: impl Into<String>,
    target_vm: impl Into<String>,
    target_contract: impl Into<String>,
    payload: Vec<u8>,
    funds: Vec<Coin>,
) -> Any {
    to_any(
        &cross_vm_call(
            sender,
            source_vm,
            target_vm,
            target_contract,
            payload,
            funds,
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
