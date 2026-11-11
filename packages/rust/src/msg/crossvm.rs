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
        // Async CosmWasm gas (v3.2.8): 0 keeps the chain defaults; set them
        // with `cross_vm_call_async`.
        async_gas_limit: 0,
        async_max_factor: 0,
    }
}

/// The CosmWasm gas an async call may use when `async_gas_limit` is 0.
pub const DEFAULT_ASYNC_GAS_LIMIT: u64 = 500_000;
/// The smallest `async_gas_limit` the chain accepts when one is set.
pub const MIN_ASYNC_GAS_LIMIT: u64 = 250_000;
/// The largest `async_gas_limit` the chain accepts.
pub const MAX_ASYNC_GAS_LIMIT: u64 = 10_000_000;
/// `async_max_factor` unit: 1,000,000 = 1x the base wasm price.
pub const ASYNC_FACTOR_ONE: u64 = 1_000_000;
/// How many queued calls one sender may have pending at a time (chain
/// default from v3.2.8).
pub const MAX_PENDING_PER_SENDER: u32 = 100;

/// Whether a target VM string names CosmWasm (`"cosmwasm"`, `"wasm"`,
/// `"VM_TYPE_WASM"`, `"VM_TYPE_COSMWASM"`, any case).
pub fn is_cosmwasm_vm(vm: &str) -> bool {
    matches!(
        vm.trim().to_ascii_lowercase().as_str(),
        "cosmwasm" | "wasm" | "vm_type_wasm" | "vm_type_cosmwasm"
    )
}

/// Checks the async CosmWasm gas fields of a `MsgCrossVMCall` (chain v3.2.8):
/// both are only for a queued (`queue = true`) call into CosmWasm, and a set
/// `async_gas_limit` is in `250,000..=10,000,000`. Zero means the chain
/// default for either.
///
/// # Errors
///
/// [`Error::InvalidInput`](crate::Error::InvalidInput) naming the rule.
pub fn validate_async_gas(
    target_vm: &str,
    queue: bool,
    async_gas_limit: u64,
    async_max_factor: u64,
) -> crate::Result<()> {
    if async_gas_limit == 0 && async_max_factor == 0 {
        return Ok(());
    }
    let bad = |m: String| crate::Error::InvalidInput(format!("cross-VM call: {m}"));
    if !queue {
        return Err(bad(
            "async_gas_limit / async_max_factor apply only to a queued (async) call".into(),
        ));
    }
    if !is_cosmwasm_vm(target_vm) {
        return Err(bad(format!(
            "async_gas_limit / async_max_factor apply only to calls into CosmWasm, not {target_vm:?}"
        )));
    }
    if async_gas_limit != 0
        && !(MIN_ASYNC_GAS_LIMIT..=MAX_ASYNC_GAS_LIMIT).contains(&async_gas_limit)
    {
        return Err(bad(format!(
            "async_gas_limit {async_gas_limit} is outside {MIN_ASYNC_GAS_LIMIT}..={MAX_ASYNC_GAS_LIMIT} \
             (0 means {DEFAULT_ASYNC_GAS_LIMIT})"
        )));
    }
    Ok(())
}

/// Builds a queued (async) `MsgCrossVMCall` into CosmWasm with its gas terms
/// (chain v3.2.8).
///
/// `async_gas_limit` is the contract execution the call may use, in base gas
/// (0 = 500,000; a set value is 250,000..=10,000,000). `async_max_factor` is
/// the highest wasm congestion factor the sender accepts, in millionths
/// (1,000,000 = 1x; 0 = four times the factor at submission). The call holds an
/// escrow of `async_gas_limit x factor x gas price` (about 0.2 QOR with the
/// defaults) that is refunded, less what it used, when it finishes; it also
/// pays a queue-slot fee, and a sender may have at most
/// [`MAX_PENDING_PER_SENDER`] calls pending.
///
/// # Errors
///
/// As [`validate_async_gas`] (the target must be CosmWasm).
#[allow(clippy::too_many_arguments)]
pub fn cross_vm_call_async(
    sender: impl Into<String>,
    source_vm: impl Into<String>,
    target_vm: impl Into<String>,
    target_contract: impl Into<String>,
    payload: Vec<u8>,
    funds: Vec<Coin>,
    async_gas_limit: u64,
    async_max_factor: u64,
) -> crate::Result<pb::MsgCrossVmCall> {
    let target_vm = target_vm.into();
    if !is_cosmwasm_vm(&target_vm) {
        return Err(crate::Error::InvalidInput(format!(
            "cross-VM call: async gas terms apply only to calls into CosmWasm, not {target_vm:?}"
        )));
    }
    validate_async_gas(&target_vm, true, async_gas_limit, async_max_factor)?;
    let mut m = cross_vm_call(
        sender,
        source_vm,
        target_vm,
        target_contract,
        payload,
        funds,
        true,
    );
    m.async_gas_limit = async_gas_limit;
    m.async_max_factor = async_max_factor;
    Ok(m)
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

pub use pb::BridgeTargetPin;

/// Declares a params-update struct whose every field is an `Option`: `None`
/// is "not given", which the composer refuses, naming the field.
macro_rules! params_update {
    ($(#[$meta:meta])* $name:ident { $($(#[$fmeta:meta])* $field:ident : $ty:ty),+ $(,)? }) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Default, PartialEq)]
        pub struct $name {
            $($(#[$fmeta])* pub $field: Option<$ty>,)+
        }

        impl $name {
            /// The names of the fields that are not given (`None`).
            pub fn missing(&self) -> Vec<&'static str> {
                let mut out = Vec::new();
                $(if self.$field.is_none() { out.push(stringify!($field)); })+
                out
            }

            /// Returns `self` with every field `changes` gives (`Some`) replaced.
            pub fn merged(mut self, changes: &Self) -> Self {
                $(if let Some(v) = &changes.$field { self.$field = Some(v.clone()); })+
                self
            }
        }
    };
}
pub(crate) use params_update;

params_update! {
    /// Every field of crossvm `MsgUpdateParams` except `authority` (chain
    /// v3.2.8 shape, fields 2..18). The message replaces the parameters
    /// wholesale, so [`update_params`] requires each one to be given
    /// explicitly (`Some`, zero allowed where the chain allows it): a field
    /// left out would be set to zero, which for example wipes
    /// `bridge_target_pins`. Build it from the chain with
    /// [`fetch_params_update`] / [`update_params_from_current`].
    CrossvmParamsUpdate {
        /// Field 2.
        max_message_size: u64,
        /// Field 3.
        max_queue_size: u32,
        /// Field 4.
        queue_timeout_blocks: i64,
        /// Field 5.
        enabled: bool,
        /// Field 6: `"<vm>:<contract>"` entries; empty keeps the bridge shut.
        bridge_allowed_targets: Vec<String>,
        /// Field 7: pins of allowlist entries to a code id.
        bridge_target_pins: Vec<BridgeTargetPin>,
        /// Field 8 (0 = default).
        max_pending_per_sender: u32,
        /// Field 9 (0 = default 50,000,000).
        max_cosmos_tx_gas: u64,
        /// Field 10 (0 = default).
        record_retention_blocks: u64,
        /// Field 11 (0 = default).
        max_block_wasm_gas: u64,
        /// Field 12 (0 = default).
        max_tx_wasm_share_bps: u32,
        /// Field 13 (0 = default).
        max_block_level_wasm_gas: u64,
        /// Field 14 (0 = default).
        queue_wasm_reserve_bps: u32,
        /// Field 15 (0 = default).
        wasm_congestion_max_factor: u32,
        /// Field 16 (0 = default).
        wasm_congestion_target_bps: u32,
        /// Field 17 (0 = default).
        max_block_upload_bps: u32,
        /// Field 18 (0 = default).
        max_queue_timeouts_per_block: u32,
    }
}

impl CrossvmParamsUpdate {
    /// Every field from a typed `Query/Params` answer (the values in force).
    pub fn from_query(q: &pb::QueryParamsResponse) -> Self {
        Self {
            max_message_size: Some(q.max_message_size),
            max_queue_size: Some(q.max_queue_size),
            queue_timeout_blocks: Some(q.queue_timeout_blocks),
            enabled: Some(q.enabled),
            bridge_allowed_targets: Some(q.bridge_allowed_targets.clone()),
            bridge_target_pins: Some(q.bridge_target_pins.clone()),
            max_pending_per_sender: Some(q.max_pending_per_sender),
            max_cosmos_tx_gas: Some(q.max_cosmos_tx_gas),
            record_retention_blocks: Some(q.record_retention_blocks),
            max_block_wasm_gas: Some(q.max_block_wasm_gas),
            max_tx_wasm_share_bps: Some(q.max_tx_wasm_share_bps),
            max_block_level_wasm_gas: Some(q.max_block_level_wasm_gas),
            queue_wasm_reserve_bps: Some(q.queue_wasm_reserve_bps),
            wasm_congestion_max_factor: Some(q.wasm_congestion_max_factor),
            wasm_congestion_target_bps: Some(q.wasm_congestion_target_bps),
            max_block_upload_bps: Some(q.max_block_upload_bps),
            max_queue_timeouts_per_block: Some(q.max_queue_timeouts_per_block),
        }
    }

    /// Every field from the REST `/qorechain/crossvm/v1/params` JSON. The
    /// answer lists the values in force (defaults substituted for zero), so
    /// copying them is correct. A field the answer lacks stays `None`, which
    /// [`update_params`] then refuses (an older node).
    ///
    /// # Errors
    ///
    /// [`Error::InvalidResponse`](crate::Error::InvalidResponse) when a number
    /// does not parse.
    pub fn from_rest_json(v: &serde_json::Value) -> crate::Result<Self> {
        use crate::msg::json_num as n;
        let pins = match v.get("bridge_target_pins") {
            None | Some(serde_json::Value::Null) => None,
            Some(list) => Some(
                list.as_array()
                    .map(|a| {
                        a.iter()
                            .map(|p| {
                                Ok(BridgeTargetPin {
                                    target: p["target"].as_str().unwrap_or_default().to_string(),
                                    code_id: n::<u64>(p, "code_id")?.unwrap_or(0),
                                    history_len: n::<u64>(p, "history_len")?.unwrap_or(0),
                                })
                            })
                            .collect::<crate::Result<Vec<_>>>()
                    })
                    .transpose()?
                    .unwrap_or_default(),
            ),
        };
        Ok(Self {
            max_message_size: n(v, "max_message_size")?,
            max_queue_size: n(v, "max_queue_size")?,
            queue_timeout_blocks: n(v, "queue_timeout_blocks")?,
            enabled: v.get("enabled").and_then(serde_json::Value::as_bool),
            bridge_allowed_targets: v.get("bridge_allowed_targets").and_then(|a| {
                a.as_array().map(|a| {
                    a.iter()
                        .filter_map(|t| t.as_str().map(str::to_string))
                        .collect()
                })
            }),
            bridge_target_pins: pins,
            max_pending_per_sender: n(v, "max_pending_per_sender")?,
            max_cosmos_tx_gas: n(v, "max_cosmos_tx_gas")?,
            record_retention_blocks: n(v, "record_retention_blocks")?,
            max_block_wasm_gas: n(v, "max_block_wasm_gas")?,
            max_tx_wasm_share_bps: n(v, "max_tx_wasm_share_bps")?,
            max_block_level_wasm_gas: n(v, "max_block_level_wasm_gas")?,
            queue_wasm_reserve_bps: n(v, "queue_wasm_reserve_bps")?,
            wasm_congestion_max_factor: n(v, "wasm_congestion_max_factor")?,
            wasm_congestion_target_bps: n(v, "wasm_congestion_target_bps")?,
            max_block_upload_bps: n(v, "max_block_upload_bps")?,
            max_queue_timeouts_per_block: n(v, "max_queue_timeouts_per_block")?,
        })
    }
}

/// The REST path of the crossvm parameters.
pub const PARAMS_PATH: &str = "/qorechain/crossvm/v1/params";

/// Reads the crossvm parameters in force over REST as a
/// [`CrossvmParamsUpdate`] with every field given.
///
/// # Errors
///
/// Transport / HTTP errors, or
/// [`Error::InvalidResponse`](crate::Error::InvalidResponse).
pub async fn fetch_params_update(
    rest: &crate::query::RestClient,
) -> crate::Result<CrossvmParamsUpdate> {
    CrossvmParamsUpdate::from_rest_json(&rest.get(PARAMS_PATH, &[]).await?)
}

/// The way to build a crossvm params proposal: reads the parameters in force
/// ([`fetch_params_update`]), applies the fields `changes` gives (`Some`) and
/// builds `MsgUpdateParams` with [`update_params`], so nothing is reset by
/// accident.
///
/// # Errors
///
/// As [`fetch_params_update`] and [`update_params`].
pub async fn update_params_from_current(
    rest: &crate::query::RestClient,
    authority: impl Into<String>,
    changes: &CrossvmParamsUpdate,
) -> crate::Result<pb::MsgUpdateParams> {
    let current = fetch_params_update(rest).await?;
    update_params(authority, &current.merged(changes))
}

/// Builds crossvm `MsgUpdateParams` (chain v3.2.5, fields 7..18 from v3.2.8):
/// replace every crossvm parameter at once, among them the allowlist of
/// targets the EVM bridge precompile may call (`bridge_allowed_targets`, each
/// `"<vm>:<contract>"`, e.g. `"cosmwasm:qor1..."`; empty keeps the bridge shut)
/// and the code pins of those targets. Governance only: `authority` is the gov
/// module account.
///
/// Every field of `params` must be given (`Some`): the message replaces the
/// parameters wholesale, and a field left out would be zero (pins wiped).
/// Build a proposal with [`update_params_from_current`].
///
/// # Errors
///
/// [`Error::InvalidInput`](crate::Error::InvalidInput) naming the fields not
/// given, or when `authority` is empty, `max_message_size`, `max_queue_size`
/// or `queue_timeout_blocks` is not positive, a target is not
/// `"<vm>:<contract>"`, or a pin names a target that is not listed.
pub fn update_params(
    authority: impl Into<String>,
    params: &CrossvmParamsUpdate,
) -> crate::Result<pb::MsgUpdateParams> {
    let authority = authority.into();
    let bad = |m: String| crate::Error::InvalidInput(format!("crossvm update_params: {m}"));
    if authority.is_empty() {
        return Err(bad("authority is required".into()));
    }
    let missing = params.missing();
    if !missing.is_empty() {
        return Err(bad(format!(
            "every field must be given (the message replaces all parameters); missing: {}. \
             Copy the current values with update_params_from_current",
            missing.join(", ")
        )));
    }
    let p = params.clone();
    let (max_message_size, max_queue_size, queue_timeout_blocks) = (
        p.max_message_size.unwrap_or_default(),
        p.max_queue_size.unwrap_or_default(),
        p.queue_timeout_blocks.unwrap_or_default(),
    );
    if max_message_size == 0 || max_queue_size == 0 || queue_timeout_blocks <= 0 {
        return Err(bad(
            "max_message_size, max_queue_size and queue_timeout_blocks must be positive".into(),
        ));
    }
    let bridge_allowed_targets = p.bridge_allowed_targets.unwrap_or_default();
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
    let bridge_target_pins = p.bridge_target_pins.unwrap_or_default();
    for pin in &bridge_target_pins {
        if !bridge_allowed_targets.contains(&pin.target) {
            return Err(bad(format!(
                "pin target {:?} is not listed in bridge_allowed_targets",
                pin.target
            )));
        }
        if pin.code_id == 0 {
            return Err(bad(format!("pin {:?} has no code_id", pin.target)));
        }
    }
    Ok(pb::MsgUpdateParams {
        authority,
        max_message_size,
        max_queue_size,
        queue_timeout_blocks,
        enabled: p.enabled.unwrap_or_default(),
        bridge_allowed_targets,
        bridge_target_pins,
        max_pending_per_sender: p.max_pending_per_sender.unwrap_or_default(),
        max_cosmos_tx_gas: p.max_cosmos_tx_gas.unwrap_or_default(),
        record_retention_blocks: p.record_retention_blocks.unwrap_or_default(),
        max_block_wasm_gas: p.max_block_wasm_gas.unwrap_or_default(),
        max_tx_wasm_share_bps: p.max_tx_wasm_share_bps.unwrap_or_default(),
        max_block_level_wasm_gas: p.max_block_level_wasm_gas.unwrap_or_default(),
        queue_wasm_reserve_bps: p.queue_wasm_reserve_bps.unwrap_or_default(),
        wasm_congestion_max_factor: p.wasm_congestion_max_factor.unwrap_or_default(),
        wasm_congestion_target_bps: p.wasm_congestion_target_bps.unwrap_or_default(),
        max_block_upload_bps: p.max_block_upload_bps.unwrap_or_default(),
        max_queue_timeouts_per_block: p.max_queue_timeouts_per_block.unwrap_or_default(),
    })
}

/// Packs a crossvm `MsgUpdateParams` into an `Any`.
pub fn update_params_any(params: &pb::MsgUpdateParams) -> Any {
    to_any(params, UPDATE_PARAMS)
}
