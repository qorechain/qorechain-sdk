//! High-level unified cross-VM call helper for QoreChain's `x/crossvm` module.
//!
//! QoreChain runs multiple VMs (EVM, CosmWasm, SVM) over one state machine. The
//! `x/crossvm` module routes a single `MsgCrossVMCall` from a source VM to a
//! target VM — e.g. an EVM dApp triggering a CosmWasm contract, or an SVM
//! program calling into the EVM. This helper mirrors the canonical TypeScript
//! SDK's `crossVm` surface: it builds, signs, and broadcasts one (or many)
//! `MsgCrossVMCall` without the caller hand-assembling protobuf or remembering
//! the type URL.
//!
//! Construct a [`CrossVm`] with the signer's key material and account context
//! (chain id, account number, sequence), then:
//!
//! - [`CrossVm::call`] — build + sign + broadcast one cross-VM call.
//! - [`CrossVm::build_call`] — build + sign only (returns the
//!   [`BuiltTx`](crate::tx::BuiltTx) for inspection or deferred broadcast).
//! - [`CrossVm::call_atomic`] — pack N calls into **one** tx so they settle
//!   atomically (all-or-nothing in a single block).
//! - [`CrossVm::get_message`] — read a routed message's status via
//!   `qor_getCrossVMMessage`.
//! - [`CrossVm::call_with_responses`] / [`CrossVm::call_atomic_with_responses`] —
//!   the same writes, with the chain's [`CrossVmCallResponse`] decoded.
//!
//! ## Immediate vs queued (chain v3.1.97)
//!
//! A call executes **inside the transaction** by default and the chain returns
//! the callee's answer: [`CrossVmCallResponse::data`] carries the return value,
//! with `executed = true` and the `gas_used` it cost. Set
//! [`CallOptions::queue`] (the proto's `async` field) to only enqueue the message
//! for a later `MsgProcessQueue` dispatch; the response then carries just the
//! message id, and the outcome is read afterwards with [`CrossVm::get_message`].
//!
//! ## Payload
//!
//! [`Payload`] is either:
//! - [`Payload::Raw`] — opaque bytes, used as-is. This is the form for EVM
//!   targets: the SDK does not ABI-encode high-level EVM calls in Rust (that is
//!   TypeScript-only); pass already-encoded calldata.
//! - [`Payload::CosmWasm`] — a `serde_json::Value`, serialized to its compact
//!   UTF-8 JSON bytes (the execute-msg form a CosmWasm contract expects).
//!
//! ## VM types
//!
//! [`CallOptions::source_vm`] defaults to [`VM_TYPE_EVM`]. The accepted target
//! VM strings are [`VM_TYPE_EVM`], [`VM_TYPE_COSMWASM`], and [`VM_TYPE_SVM`].
//!
//! From chain v3.1.97 the **source** VM is ignored on input: the chain derives
//! the origin lane from the execution context instead of trusting the caller's
//! self-description. The field is still sent so older nodes keep accepting the
//! message, but setting it changes nothing on a current chain.

use crate::error::{Error, Result};
use crate::msg::crossvm::{cross_vm_call_any, CROSS_VM_CALL_RESPONSE};
use crate::proto::qorechain::crossvm::v1 as pb;
use crate::query::QorClient;
use crate::tx::{
    broadcast, send_messages, BroadcastMode, BuiltTx, Coin as TxCoin, Fee, SendMessagesParams,
};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use cosmrs::proto::cosmos::base::v1beta1::Coin as ProtoCoin;
use prost::Message;
use serde_json::Value;

/// The EVM VM-type string.
pub const VM_TYPE_EVM: &str = "evm";
/// The CosmWasm VM-type string.
pub const VM_TYPE_COSMWASM: &str = "cosmwasm";
/// The SVM (Solana VM) VM-type string.
pub const VM_TYPE_SVM: &str = "svm";

/// The set of valid VM-type strings.
pub const VM_TYPES: &[&str] = &[VM_TYPE_EVM, VM_TYPE_COSMWASM, VM_TYPE_SVM];

/// The payload of a cross-VM call.
#[derive(Debug, Clone)]
pub enum Payload {
    /// Opaque bytes, used as-is (the form for EVM targets: pass ABI-encoded
    /// calldata).
    Raw(Vec<u8>),
    /// A JSON value serialized to compact UTF-8 bytes (the CosmWasm execute-msg
    /// form).
    CosmWasm(Value),
}

impl Payload {
    /// Resolves the payload to its on-wire bytes.
    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        match self {
            Payload::Raw(b) => Ok(b.clone()),
            Payload::CosmWasm(v) => serde_json::to_vec(v)
                .map_err(|e| Error::InvalidResponse(format!("serialize cosmwasm payload: {e}"))),
        }
    }
}

impl From<Vec<u8>> for Payload {
    fn from(b: Vec<u8>) -> Self {
        Payload::Raw(b)
    }
}

impl From<Value> for Payload {
    fn from(v: Value) -> Self {
        Payload::CosmWasm(v)
    }
}

/// Options for a single cross-VM call.
#[derive(Debug, Clone)]
pub struct CallOptions {
    /// Source VM type. Defaults to [`VM_TYPE_EVM`] when empty.
    ///
    /// **The chain ignores this field** (chain v3.1.97 and later): it derives the
    /// origin lane from the execution context rather than from the caller's own
    /// description of itself. It is still sent, so a node running an older build
    /// accepts the message; setting it cannot change where the call is credited
    /// from.
    pub source_vm: String,
    /// Target VM type (e.g. [`VM_TYPE_COSMWASM`]).
    pub target_vm: String,
    /// The target contract address/identifier in the target VM's address space.
    pub target_contract: String,
    /// The call payload (raw bytes or a CosmWasm JSON value).
    pub payload: Payload,
    /// Funds to send with the call.
    pub funds: Vec<TxCoin>,
    /// Queue the call instead of executing it now (the proto's `async` field).
    ///
    /// `false` (the default) executes the call within this transaction and returns
    /// the callee's answer in [`CrossVmCallResponse::data`]. `true` only enqueues
    /// the message for a later `MsgProcessQueue` dispatch, so the response carries
    /// `executed == false` and no data — read the outcome later with
    /// [`CrossVm::get_message`].
    pub queue: bool,
}

impl CallOptions {
    /// Creates options with the given target VM, contract, and payload, defaulting
    /// `source_vm` to [`VM_TYPE_EVM`], no funds, and immediate (non-queued)
    /// execution.
    pub fn new(
        target_vm: impl Into<String>,
        target_contract: impl Into<String>,
        payload: impl Into<Payload>,
    ) -> Self {
        Self {
            source_vm: VM_TYPE_EVM.to_string(),
            target_vm: target_vm.into(),
            target_contract: target_contract.into(),
            payload: payload.into(),
            funds: Vec::new(),
            queue: false,
        }
    }

    /// Overrides the source VM.
    ///
    /// Kept for compatibility with older nodes; see [`CallOptions::source_vm`] —
    /// the chain ignores the value.
    pub fn source_vm(mut self, vm: impl Into<String>) -> Self {
        self.source_vm = vm.into();
        self
    }

    /// Sets the funds carried with the call.
    pub fn funds(mut self, funds: Vec<TxCoin>) -> Self {
        self.funds = funds;
        self
    }

    /// Queues the call for later `MsgProcessQueue` dispatch instead of executing
    /// it now (the proto's `async` field).
    pub fn queue(mut self, queue: bool) -> Self {
        self.queue = queue;
        self
    }
}

/// A decoded `MsgCrossVMCallResponse` — what the chain answers for one
/// `MsgCrossVMCall` in the transaction.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CrossVmCallResponse {
    /// The cross-VM message id assigned by the chain.
    pub message_id: String,
    /// Whether the call already ran. `false` for a queued
    /// ([`CallOptions::queue`]) call, whose result is not known yet.
    pub executed: bool,
    /// The callee's return value. Empty for a queued call.
    pub data: Vec<u8>,
    /// Gas consumed by the callee. `0` for a queued call.
    pub gas_used: u64,
}

impl CrossVmCallResponse {
    /// Decodes one `MsgCrossVMCallResponse` from its protobuf bytes.
    pub fn decode(bytes: &[u8]) -> Result<Self> {
        let pb = pb::MsgCrossVmCallResponse::decode(bytes)
            .map_err(|e| Error::InvalidResponse(format!("decode MsgCrossVMCallResponse: {e}")))?;
        Ok(Self {
            message_id: pb.message_id,
            executed: pb.executed,
            data: pb.data,
            gas_used: pb.gas_used,
        })
    }

    /// Extracts every `MsgCrossVMCallResponse` from a REST broadcast response
    /// (the JSON returned by [`crate::tx::broadcast`] / [`CrossVm::call`]).
    ///
    /// Reads `tx_response.msg_responses[]`, keeping the entries whose `type_url`
    /// is [`CROSS_VM_CALL_RESPONSE`] and base64-decoding their `value`. Returns an
    /// empty vector when the node did not include `msg_responses` — a `sync`
    /// broadcast answers before execution, so the results are only present once
    /// the tx is confirmed (see [`crate::tx::broadcast_and_wait`]).
    pub fn list_from_broadcast(resp: &Value) -> Result<Vec<Self>> {
        let responses = resp
            .get("tx_response")
            .and_then(|r| r.get("msg_responses"))
            .or_else(|| resp.get("msg_responses"))
            .and_then(|m| m.as_array());
        let Some(responses) = responses else {
            return Ok(Vec::new());
        };
        let mut out = Vec::new();
        for entry in responses {
            let type_url = entry
                .get("type_url")
                .or_else(|| entry.get("@type"))
                .and_then(|t| t.as_str())
                .unwrap_or_default();
            if type_url != CROSS_VM_CALL_RESPONSE {
                continue;
            }
            let value = entry.get("value").and_then(|v| v.as_str()).unwrap_or("");
            let bytes = BASE64.decode(value).map_err(|e| {
                Error::InvalidResponse(format!("decode MsgCrossVMCallResponse base64: {e}"))
            })?;
            out.push(Self::decode(&bytes)?);
        }
        Ok(out)
    }
}

/// The signer/account context plus broadcast target for cross-VM calls.
///
/// Mirrors [`SendMessagesParams`] minus the messages: it carries the secp256k1
/// key pair, the chain id, the on-chain account number / sequence, the fee, and
/// the REST URL used to broadcast. An optional [`QorClient`] enables
/// [`CrossVm::get_message`].
#[derive(Debug, Clone)]
pub struct CrossVm {
    /// The signer's bech32 sender address.
    pub sender: String,
    /// The signer's 32-byte secp256k1 private key.
    pub private_key: Vec<u8>,
    /// The signer's 33-byte compressed secp256k1 public key.
    pub public_key: Vec<u8>,
    /// The chain id (e.g. `"qorechain-diana"`).
    pub chain_id: String,
    /// The signer's on-chain account number.
    pub account_number: u64,
    /// The signer's current account sequence (nonce).
    pub sequence: u64,
    /// The fee to pay.
    pub fee: Fee,
    /// The REST (LCD) URL used to broadcast (`/cosmos/tx/v1beta1/txs`).
    pub rest_url: String,
    /// Broadcast mode. Defaults to [`BroadcastMode::Sync`].
    pub mode: BroadcastMode,
    /// Optional `qor_*` client for [`CrossVm::get_message`].
    pub qor: Option<QorClient>,
}

impl CrossVm {
    /// Builds + signs a single `MsgCrossVMCall` into a broadcast-ready [`BuiltTx`]
    /// (does not broadcast).
    pub fn build_call(&self, opts: &CallOptions) -> Result<BuiltTx> {
        self.build_atomic(std::slice::from_ref(opts))
    }

    /// Builds + signs a single `MsgCrossVMCall` and broadcasts it, returning the
    /// REST broadcast response JSON.
    pub async fn call(&self, opts: &CallOptions) -> Result<Value> {
        let built = self.build_call(opts)?;
        broadcast(&self.rest_url, &built.tx_raw_bytes, self.mode).await
    }

    /// Builds + signs **one** tx containing N `MsgCrossVMCall` messages (atomic)
    /// and broadcasts it, returning the REST broadcast response JSON.
    pub async fn call_atomic(&self, opts: &[CallOptions]) -> Result<Value> {
        let built = self.build_atomic(opts)?;
        broadcast(&self.rest_url, &built.tx_raw_bytes, self.mode).await
    }

    /// Like [`CrossVm::call`], but also decodes the chain's
    /// `MsgCrossVMCallResponse`s — the message id plus, for a call that executed
    /// inline, the callee's `data`, the `executed` flag, and `gas_used`.
    ///
    /// The decoded vector is empty when the node's answer carried no
    /// `msg_responses` (a [`BroadcastMode::Sync`] broadcast returns before
    /// execution); the raw JSON is always returned so the caller can still read
    /// the tx hash and poll.
    pub async fn call_with_responses(
        &self,
        opts: &CallOptions,
    ) -> Result<(Value, Vec<CrossVmCallResponse>)> {
        let raw = self.call(opts).await?;
        let decoded = CrossVmCallResponse::list_from_broadcast(&raw)?;
        Ok((raw, decoded))
    }

    /// Like [`CrossVm::call_atomic`], but also decodes one
    /// [`CrossVmCallResponse`] per packed `MsgCrossVMCall`, in message order.
    pub async fn call_atomic_with_responses(
        &self,
        opts: &[CallOptions],
    ) -> Result<(Value, Vec<CrossVmCallResponse>)> {
        let raw = self.call_atomic(opts).await?;
        let decoded = CrossVmCallResponse::list_from_broadcast(&raw)?;
        Ok((raw, decoded))
    }

    /// Builds + signs one tx containing N `MsgCrossVMCall` messages (does not
    /// broadcast). Returns an error if `opts` is empty.
    pub fn build_atomic(&self, opts: &[CallOptions]) -> Result<BuiltTx> {
        if opts.is_empty() {
            return Err(Error::InvalidResponse(
                "cross_vm: at least one call is required".into(),
            ));
        }
        let mut messages = Vec::with_capacity(opts.len());
        for o in opts {
            let source_vm = if o.source_vm.is_empty() {
                VM_TYPE_EVM
            } else {
                o.source_vm.as_str()
            };
            let payload = o.payload.to_bytes()?;
            messages.push(cross_vm_call_any(
                self.sender.clone(),
                source_vm,
                o.target_vm.clone(),
                o.target_contract.clone(),
                payload,
                to_proto_coins(&o.funds),
                o.queue,
            ));
        }

        send_messages(SendMessagesParams {
            private_key: self.private_key.clone(),
            public_key: self.public_key.clone(),
            messages,
            chain_id: self.chain_id.clone(),
            account_number: self.account_number,
            sequence: self.sequence,
            fee: self.fee.clone(),
            memo: String::new(),
            timeout_height: 0,
        })
    }

    /// Reads a routed cross-VM message's status by id via `qor_getCrossVMMessage`.
    ///
    /// Returns an error if no [`QorClient`] was configured.
    pub async fn get_message(&self, id: &str) -> Result<Value> {
        let qor = self.qor.as_ref().ok_or_else(|| {
            Error::MissingEndpoint("qor (cross_vm.get_message requires a QorClient)".into())
        })?;
        qor.get_cross_vm_message(id).await
    }
}

fn to_proto_coins(coins: &[TxCoin]) -> Vec<ProtoCoin> {
    coins
        .iter()
        .map(|c| ProtoCoin {
            denom: c.denom.clone(),
            amount: c.amount.clone(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn payload_raw_passthrough() {
        let p = Payload::Raw(vec![1, 2, 3]);
        assert_eq!(p.to_bytes().unwrap(), vec![1, 2, 3]);
    }

    #[test]
    fn payload_cosmwasm_is_compact_json() {
        let p = Payload::CosmWasm(json!({ "increment": {} }));
        assert_eq!(p.to_bytes().unwrap(), br#"{"increment":{}}"#.to_vec());
    }

    #[test]
    fn call_options_defaults_source_to_evm() {
        let o = CallOptions::new(VM_TYPE_COSMWASM, "qor1contract", vec![0u8]);
        assert_eq!(o.source_vm, VM_TYPE_EVM);
        assert_eq!(o.target_vm, "cosmwasm");
    }

    #[test]
    fn vm_type_constants() {
        assert_eq!(VM_TYPES, &["evm", "cosmwasm", "svm"]);
    }
}
