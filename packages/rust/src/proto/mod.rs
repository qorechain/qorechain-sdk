//! Generated prost types for the QoreChain custom modules.
//!
//! Produced by `scripts/codegen-rust.sh` (buf + protoc-gen-prost) from
//! `proto/qorechain/**`. Each module's messages implement `prost::Message`
//! and pack into a `cosmrs::Any` via `encode_to_vec()`. Do not edit by hand.
#![allow(missing_docs, clippy::all)]
/// Generated QoreChain protobuf modules.
pub mod qorechain {
    /// `qorechain.abstractaccount.v1` generated types.
    pub mod abstractaccount {
        /// `qorechain.abstractaccount.v1` generated types.
        pub mod v1 {
            include!("qorechain.abstractaccount.v1.rs");
        }
    }
    /// `qorechain.amm.v1` generated types.
    pub mod amm {
        /// `qorechain.amm.v1` generated types.
        pub mod v1 {
            include!("qorechain.amm.v1.rs");
        }
    }
    /// `qorechain.bridge.v1` generated types.
    pub mod bridge {
        /// `qorechain.bridge.v1` generated types.
        pub mod v1 {
            include!("qorechain.bridge.v1.rs");
        }
    }
    /// `qorechain.crossvm.v1` generated types.
    pub mod crossvm {
        /// `qorechain.crossvm.v1` generated types.
        pub mod v1 {
            include!("qorechain.crossvm.v1.rs");
        }
    }
    /// `qorechain.license.v1` generated types.
    pub mod license {
        /// `qorechain.license.v1` generated types.
        pub mod v1 {
            include!("qorechain.license.v1.rs");
        }
    }
    /// `qorechain.lightnode.v1` generated types.
    pub mod lightnode {
        /// `qorechain.lightnode.v1` generated types.
        pub mod v1 {
            include!("qorechain.lightnode.v1.rs");
        }
    }
    /// `qorechain.multilayer.v1` generated types.
    pub mod multilayer {
        /// `qorechain.multilayer.v1` generated types.
        pub mod v1 {
            include!("qorechain.multilayer.v1.rs");
        }
    }
    /// `qorechain.pqc.v1` generated types.
    pub mod pqc {
        /// `qorechain.pqc.v1` generated types.
        pub mod v1 {
            include!("qorechain.pqc.v1.rs");
        }
    }
    /// `qorechain.qca.v1` generated types.
    pub mod qca {
        /// `qorechain.qca.v1` generated types.
        pub mod v1 {
            include!("qorechain.qca.v1.rs");
        }
    }
    /// `qorechain.rdk.v1` generated types.
    pub mod rdk {
        /// `qorechain.rdk.v1` generated types.
        pub mod v1 {
            include!("qorechain.rdk.v1.rs");
        }
    }
    /// `qorechain.reputation.v1` generated types.
    pub mod reputation {
        /// `qorechain.reputation.v1` generated types.
        pub mod v1 {
            include!("qorechain.reputation.v1.rs");
        }
    }
    /// `qorechain.rlconsensus.v1` generated types.
    pub mod rlconsensus {
        /// `qorechain.rlconsensus.v1` generated types.
        pub mod v1 {
            include!("qorechain.rlconsensus.v1.rs");
        }
    }
    /// `qorechain.svm.v1` generated types.
    pub mod svm {
        /// `qorechain.svm.v1` generated types.
        pub mod v1 {
            include!("qorechain.svm.v1.rs");
        }
    }
}
