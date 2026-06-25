//! `qorechain.svm.v1` message composers.
//!
//! Bytes32 fields (program ids, account addresses, owners) are plain 32-byte
//! `Vec<u8>` on the wire; callers pass the raw 32 bytes.

use crate::msg::to_any;
use crate::proto::qorechain::svm::v1 as pb;
use cosmrs::Any;

pub use pb::SvmAccountMeta;

/// `/qorechain.svm.v1.MsgDeployProgram` type URL.
pub const DEPLOY_PROGRAM: &str = "/qorechain.svm.v1.MsgDeployProgram";
/// `/qorechain.svm.v1.MsgCreateAccount` type URL.
pub const CREATE_ACCOUNT: &str = "/qorechain.svm.v1.MsgCreateAccount";
/// `/qorechain.svm.v1.MsgExecuteProgram` type URL.
pub const EXECUTE_PROGRAM: &str = "/qorechain.svm.v1.MsgExecuteProgram";
/// `/qorechain.svm.v1.MsgRegisterSVMPQCKey` type URL.
pub const REGISTER_SVM_PQC_KEY: &str = "/qorechain.svm.v1.MsgRegisterSVMPQCKey";

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

/// Builds `MsgExecuteProgram`.
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
