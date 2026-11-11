//! `qorechain.svm.v1` message composers.
//!
//! Bytes32 fields (program ids, account addresses, owners) are plain 32-byte
//! `Vec<u8>` on the wire; callers pass the raw 32 bytes.

use crate::msg::to_any;
use crate::proto::qorechain::svm::v1 as pb;
use cosmrs::Any;

pub use pb::{SvmAccountMeta, SvmAuth, SvmParams};

/// `/qorechain.svm.v1.MsgDeployProgram` type URL.
pub const DEPLOY_PROGRAM: &str = "/qorechain.svm.v1.MsgDeployProgram";
/// `/qorechain.svm.v1.MsgCreateAccount` type URL.
pub const CREATE_ACCOUNT: &str = "/qorechain.svm.v1.MsgCreateAccount";
/// `/qorechain.svm.v1.MsgExecuteProgram` type URL.
pub const EXECUTE_PROGRAM: &str = "/qorechain.svm.v1.MsgExecuteProgram";
/// `/qorechain.svm.v1.MsgRegisterSVMPQCKey` type URL.
pub const REGISTER_SVM_PQC_KEY: &str = "/qorechain.svm.v1.MsgRegisterSVMPQCKey";
/// `/qorechain.svm.v1.MsgUpdateParams` type URL (governance).
pub const UPDATE_PARAMS: &str = "/qorechain.svm.v1.MsgUpdateParams";

/// Builds `MsgDeployProgram`.
pub fn deploy_program(sender: impl Into<String>, bytecode: Vec<u8>) -> pb::MsgDeployProgram {
    pb::MsgDeployProgram {
        sender: sender.into(),
        bytecode,
    }
}

/// Builds `MsgDeployProgram` packed into an `Any`.
pub fn deploy_program_any(sender: impl Into<String>, bytecode: Vec<u8>) -> Any {
    to_any(&deploy_program(sender, bytecode), DEPLOY_PROGRAM)
}

/// Builds `MsgCreateAccount`.
pub fn create_account(
    sender: impl Into<String>,
    owner: Vec<u8>,
    space: u64,
    lamports: u64,
    salt: Vec<u8>,
) -> pb::MsgCreateAccount {
    pb::MsgCreateAccount {
        sender: sender.into(),
        owner,
        space,
        lamports,
        salt,
    }
}

/// Builds `MsgCreateAccount` packed into an `Any`.
pub fn create_account_any(
    sender: impl Into<String>,
    owner: Vec<u8>,
    space: u64,
    lamports: u64,
    salt: Vec<u8>,
) -> Any {
    to_any(
        &create_account(sender, owner, space, lamports, salt),
        CREATE_ACCOUNT,
    )
}

/// Builds `MsgExecuteProgram` with no foreign-scheme authorization (`auth` is
/// `None`).
pub fn execute_program(
    sender: impl Into<String>,
    program_id: Vec<u8>,
    accounts: Vec<SvmAccountMeta>,
    data: Vec<u8>,
) -> pb::MsgExecuteProgram {
    pb::MsgExecuteProgram {
        sender: sender.into(),
        program_id,
        accounts,
        data,
        auth: None,
    }
}

/// Builds `MsgExecuteProgram` carrying a foreign-scheme (e.g. Phantom ed25519)
/// authorization, so any funded `sender` may relay the action while the linked
/// key remains the effective SVM signer.
pub fn execute_program_with_auth(
    sender: impl Into<String>,
    program_id: Vec<u8>,
    accounts: Vec<SvmAccountMeta>,
    data: Vec<u8>,
    auth: SvmAuth,
) -> pb::MsgExecuteProgram {
    pb::MsgExecuteProgram {
        sender: sender.into(),
        program_id,
        accounts,
        data,
        auth: Some(auth),
    }
}

/// Builds `MsgExecuteProgram` packed into an `Any`.
pub fn execute_program_any(
    sender: impl Into<String>,
    program_id: Vec<u8>,
    accounts: Vec<SvmAccountMeta>,
    data: Vec<u8>,
) -> Any {
    to_any(
        &execute_program(sender, program_id, accounts, data),
        EXECUTE_PROGRAM,
    )
}

/// Builds `MsgExecuteProgram` (with foreign-scheme `auth`) packed into an `Any`.
pub fn execute_program_with_auth_any(
    sender: impl Into<String>,
    program_id: Vec<u8>,
    accounts: Vec<SvmAccountMeta>,
    data: Vec<u8>,
    auth: SvmAuth,
) -> Any {
    to_any(
        &execute_program_with_auth(sender, program_id, accounts, data, auth),
        EXECUTE_PROGRAM,
    )
}

/// Builds an [`SvmAuth`] foreign-scheme authorization for [`execute_program_with_auth`].
pub fn svm_auth(
    scheme: impl Into<String>,
    pubkey: Vec<u8>,
    signature: Vec<u8>,
    recent_blockhash: Vec<u8>,
) -> SvmAuth {
    SvmAuth {
        scheme: scheme.into(),
        pubkey,
        signature,
        recent_blockhash,
    }
}

/// Builds `MsgRegisterSVMPQCKey`.
pub fn register_svm_pqc_key(
    sender: impl Into<String>,
    svm_addr: Vec<u8>,
    pqc_pub_key: Vec<u8>,
) -> pb::MsgRegisterSvmpqcKey {
    pb::MsgRegisterSvmpqcKey {
        sender: sender.into(),
        svm_addr,
        pqc_pub_key,
    }
}

/// Builds `MsgRegisterSVMPQCKey` packed into an `Any`.
pub fn register_svm_pqc_key_any(
    sender: impl Into<String>,
    svm_addr: Vec<u8>,
    pqc_pub_key: Vec<u8>,
) -> Any {
    to_any(
        &register_svm_pqc_key(sender, svm_addr, pqc_pub_key),
        REGISTER_SVM_PQC_KEY,
    )
}

crate::msg::crossvm::params_update! {
    /// Every field of the SVM runtime parameters (`SVMParams`, chain v3.2.8
    /// shape, fields 1..12). `MsgUpdateParams` replaces them wholesale, so
    /// [`update_params`] requires each one to be given explicitly (`Some`): a
    /// field left out would be zero, which for example removes the custody
    /// ceilings. Build it from the chain with [`fetch_params_update`] /
    /// [`update_params_from_current`].
    SvmParamsUpdate {
        /// Field 1.
        max_program_size: u64,
        /// Field 2.
        max_account_data_size: u64,
        /// Field 3.
        compute_budget_max: u64,
        /// Field 4.
        lamports_per_byte: u64,
        /// Field 5 (a decimal string).
        rent_exemption_multi: String,
        /// Field 6: turns the SVM lane on or off.
        enabled: bool,
        /// Field 7.
        svm_slot_offset: i64,
        /// Field 8.
        default_sig_scheme: u32,
        /// Field 9.
        max_cpi: u32,
        /// Field 10: cap on the svm module account's custody (0 = no cap).
        max_custody_uqor: u64,
        /// Field 11: absolute custody ceiling (0 = none); required before the
        /// lane is opened.
        max_custody_hard_uqor: u64,
        /// Field 12: per-account cap above the rent-exempt minimum (0 = none).
        max_account_excess_uqor: u64,
    }
}

impl SvmParamsUpdate {
    /// Every field from a params value read from the chain.
    pub fn from_params(p: &SvmParams) -> Self {
        Self {
            max_program_size: Some(p.max_program_size),
            max_account_data_size: Some(p.max_account_data_size),
            compute_budget_max: Some(p.compute_budget_max),
            lamports_per_byte: Some(p.lamports_per_byte),
            rent_exemption_multi: Some(p.rent_exemption_multi.clone()),
            enabled: Some(p.enabled),
            svm_slot_offset: Some(p.svm_slot_offset),
            default_sig_scheme: Some(p.default_sig_scheme),
            max_cpi: Some(p.max_cpi),
            max_custody_uqor: Some(p.max_custody_uqor),
            max_custody_hard_uqor: Some(p.max_custody_hard_uqor),
            max_account_excess_uqor: Some(p.max_account_excess_uqor),
        }
    }

    /// The fields of the REST `/qorechain/svm/v1/params` JSON (the `params`
    /// object, or the top level). A field the answer lacks stays `None`, which
    /// [`update_params`] then refuses (an older node).
    ///
    /// # Errors
    ///
    /// [`Error::InvalidResponse`](crate::Error::InvalidResponse) when a number
    /// does not parse.
    pub fn from_rest_json(body: &serde_json::Value) -> crate::Result<Self> {
        use crate::msg::json_num as n;
        let v = body.get("params").filter(|p| p.is_object()).unwrap_or(body);
        Ok(Self {
            max_program_size: n(v, "max_program_size")?,
            max_account_data_size: n(v, "max_account_data_size")?,
            compute_budget_max: n(v, "compute_budget_max")?,
            lamports_per_byte: n(v, "lamports_per_byte")?,
            rent_exemption_multi: v
                .get("rent_exemption_multi")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string),
            enabled: v.get("enabled").and_then(serde_json::Value::as_bool),
            svm_slot_offset: n(v, "svm_slot_offset")?,
            default_sig_scheme: n(v, "default_sig_scheme")?,
            max_cpi: n(v, "max_cpi")?,
            max_custody_uqor: n(v, "max_custody_uqor")?,
            max_custody_hard_uqor: n(v, "max_custody_hard_uqor")?,
            max_account_excess_uqor: n(v, "max_account_excess_uqor")?,
        })
    }
}

/// The REST path of the SVM parameters.
pub const PARAMS_PATH: &str = "/qorechain/svm/v1/params";

/// Reads the SVM parameters over REST as a [`SvmParamsUpdate`].
///
/// # Errors
///
/// Transport / HTTP errors, or
/// [`Error::InvalidResponse`](crate::Error::InvalidResponse).
pub async fn fetch_params_update(
    rest: &crate::query::RestClient,
) -> crate::Result<SvmParamsUpdate> {
    SvmParamsUpdate::from_rest_json(&rest.get(PARAMS_PATH, &[]).await?)
}

/// The way to build an SVM params proposal: reads the current parameters
/// ([`fetch_params_update`]), applies the fields `changes` gives (`Some`) and
/// builds `MsgUpdateParams` with [`update_params`].
///
/// # Errors
///
/// As [`fetch_params_update`] and [`update_params`].
pub async fn update_params_from_current(
    rest: &crate::query::RestClient,
    authority: impl Into<String>,
    changes: &SvmParamsUpdate,
) -> crate::Result<pb::MsgUpdateParams> {
    let current = fetch_params_update(rest).await?;
    update_params(authority, &current.merged(changes))
}

/// Builds `MsgUpdateParams` - the **governance** message that replaces the SVM
/// module's runtime parameters wholesale (chain v3.1.97; custody fields 10..12
/// from v3.2.8).
///
/// `authority` must be the governance module account; a transaction signed by
/// anyone else is rejected by the chain. Because the replacement is wholesale,
/// every field of `params` must be given (`Some`); build a proposal with
/// [`update_params_from_current`].
///
/// `enabled` is what turns the SVM lane on or off, so disabling the lane is an
/// ordinary governance proposal rather than a binary release. Opening it
/// requires a hard custody ceiling (`max_custody_hard_uqor > 0`).
///
/// # Errors
///
/// [`Error::InvalidInput`](crate::Error::InvalidInput) when `authority` is
/// empty, fields are not given (named), or `enabled` is true with
/// `max_custody_hard_uqor == 0`.
pub fn update_params(
    authority: impl Into<String>,
    params: &SvmParamsUpdate,
) -> crate::Result<pb::MsgUpdateParams> {
    let authority = authority.into();
    let bad = |m: String| crate::Error::InvalidInput(format!("svm update_params: {m}"));
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
    let params = SvmParams {
        max_program_size: p.max_program_size.unwrap_or_default(),
        max_account_data_size: p.max_account_data_size.unwrap_or_default(),
        compute_budget_max: p.compute_budget_max.unwrap_or_default(),
        lamports_per_byte: p.lamports_per_byte.unwrap_or_default(),
        rent_exemption_multi: p.rent_exemption_multi.unwrap_or_default(),
        enabled: p.enabled.unwrap_or_default(),
        svm_slot_offset: p.svm_slot_offset.unwrap_or_default(),
        default_sig_scheme: p.default_sig_scheme.unwrap_or_default(),
        max_cpi: p.max_cpi.unwrap_or_default(),
        max_custody_uqor: p.max_custody_uqor.unwrap_or_default(),
        max_custody_hard_uqor: p.max_custody_hard_uqor.unwrap_or_default(),
        max_account_excess_uqor: p.max_account_excess_uqor.unwrap_or_default(),
    };
    if params.enabled && params.max_custody_hard_uqor == 0 {
        return Err(bad(
            "governance must set a hard custody ceiling before opening the lane \
             (max_custody_hard_uqor > 0 with enabled = true)"
                .into(),
        ));
    }
    Ok(pb::MsgUpdateParams {
        authority,
        params: Some(params),
    })
}

/// Builds `MsgUpdateParams` packed into an `Any`.
///
/// # Errors
///
/// As [`update_params`].
pub fn update_params_any(
    authority: impl Into<String>,
    params: &SvmParamsUpdate,
) -> crate::Result<Any> {
    Ok(to_any(&update_params(authority, params)?, UPDATE_PARAMS))
}
