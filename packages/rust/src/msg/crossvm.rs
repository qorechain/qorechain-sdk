//! `qorechain.crossvm.v1` message composers.

use crate::msg::to_any;
use crate::proto::qorechain::crossvm::v1 as pb;
use cosmrs::proto::cosmos::base::v1beta1::Coin;
use cosmrs::Any;

/// `/qorechain.crossvm.v1.MsgCrossVMCall` type URL.
pub const CROSS_VM_CALL: &str = "/qorechain.crossvm.v1.MsgCrossVMCall";
/// `/qorechain.crossvm.v1.MsgProcessQueue` type URL.
pub const PROCESS_QUEUE: &str = "/qorechain.crossvm.v1.MsgProcessQueue";

/// `/qorechain.crossvm.v1.MsgUpdateParams` type URL (chain v3.2.5, governance
/// only).
pub const UPDATE_PARAMS: &str = "/qorechain.crossvm.v1.MsgUpdateParams";

/// `/qorechain.crossvm.v1.MsgCrossVMCallResponse` type URL - the `Msg` service
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

/// Builds `MsgUpdateParams` (chain v3.2.5): replace every crossvm parameter at
/// once, among them the allowlist of targets the EVM bridge precompile may call
/// (`bridge_allowed_targets`, each `"<vm>:<contract>"`, e.g.
/// `"cosmwasm:qor1..."`; empty keeps the bridge shut). Governance only:
/// `authority` is the gov module account. A field left at zero is set to zero,
/// which the chain refuses for the numeric limits, so copy the current values
/// from `/qorechain/crossvm/v1/params`.
///
/// # Errors
///
/// [`Error::InvalidInput`](crate::Error::InvalidInput) when `authority` is
/// empty, a limit is zero, or a target is not `"<vm>:<contract>"`.
pub fn update_params(
    authority: impl Into<String>,
    max_message_size: u64,
    max_queue_size: u32,
    queue_timeout_blocks: i64,
    enabled: bool,
    bridge_allowed_targets: Vec<String>,
) -> crate::Result<pb::MsgUpdateParams> {
    let authority = authority.into();
    let bad = |m: String| crate::Error::InvalidInput(format!("crossvm update_params: {m}"));
    if authority.is_empty() {
        return Err(bad("authority is required".into()));
    }
    if max_message_size == 0 || max_queue_size == 0 || queue_timeout_blocks <= 0 {
        return Err(bad(
            "max_message_size, max_queue_size and queue_timeout_blocks must be positive".into(),
        ));
    }
    for t in &bridge_allowed_targets {
        match t.split_once(':') {
            Some((vm, contract)) if !vm.is_empty() && !contract.is_empty() => {}
            _ => {
                return Err(bad(format!(
                    "bridge target {t:?} is not \"<vm>:<contract>\""
                )))
            }
        }
    }
    Ok(pb::MsgUpdateParams {
        authority,
        max_message_size,
        max_queue_size,
        queue_timeout_blocks,
        enabled,
        bridge_allowed_targets,
    })
}

/// Packs a crossvm `MsgUpdateParams` into an `Any`.
pub fn update_params_any(params: &pb::MsgUpdateParams) -> Any {
    to_any(params, UPDATE_PARAMS)
}
