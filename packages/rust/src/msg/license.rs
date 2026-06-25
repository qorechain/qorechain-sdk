//! `qorechain.license.v1` message composers.

use crate::msg::to_any;
use crate::proto::qorechain::license::v1 as pb;
use cosmrs::Any;

/// `/qorechain.license.v1.MsgGrantLicense` type URL.
pub const GRANT_LICENSE: &str = "/qorechain.license.v1.MsgGrantLicense";
/// `/qorechain.license.v1.MsgRevokeLicense` type URL.
pub const REVOKE_LICENSE: &str = "/qorechain.license.v1.MsgRevokeLicense";
/// `/qorechain.license.v1.MsgSuspendLicense` type URL.
pub const SUSPEND_LICENSE: &str = "/qorechain.license.v1.MsgSuspendLicense";
/// `/qorechain.license.v1.MsgResumeLicense` type URL.
pub const RESUME_LICENSE: &str = "/qorechain.license.v1.MsgResumeLicense";

/// Builds `MsgGrantLicense`.
pub fn grant_license(
    authority: impl Into<String>,
    grantee: impl Into<String>,
    feature_id: impl Into<String>,
    expires_at: i64,
    metadata: impl Into<String>,
) -> pb::MsgGrantLicense {
    pb::MsgGrantLicense {
        authority: authority.into(),
        grantee: grantee.into(),
        feature_id: feature_id.into(),
        expires_at,
        metadata: metadata.into(),
    }
}

/// Builds `MsgGrantLicense` packed into an `Any`.
pub fn grant_license_any(
    authority: impl Into<String>,
    grantee: impl Into<String>,
    feature_id: impl Into<String>,
    expires_at: i64,
    metadata: impl Into<String>,
) -> Any {
    to_any(
        &grant_license(authority, grantee, feature_id, expires_at, metadata),
        GRANT_LICENSE,
    )
}

/// Builds `MsgRevokeLicense`.
pub fn revoke_license(
    authority: impl Into<String>,
    grantee: impl Into<String>,
    feature_id: impl Into<String>,
) -> pb::MsgRevokeLicense {
    pb::MsgRevokeLicense {
        authority: authority.into(),
        grantee: grantee.into(),
        feature_id: feature_id.into(),
    }
}

/// Builds `MsgRevokeLicense` packed into an `Any`.
pub fn revoke_license_any(
    authority: impl Into<String>,
    grantee: impl Into<String>,
    feature_id: impl Into<String>,
) -> Any {
    to_any(
        &revoke_license(authority, grantee, feature_id),
        REVOKE_LICENSE,
    )
}

/// Builds `MsgSuspendLicense`.
pub fn suspend_license(
    authority: impl Into<String>,
    grantee: impl Into<String>,
    feature_id: impl Into<String>,
) -> pb::MsgSuspendLicense {
    pb::MsgSuspendLicense {
        authority: authority.into(),
        grantee: grantee.into(),
        feature_id: feature_id.into(),
    }
}

/// Builds `MsgSuspendLicense` packed into an `Any`.
pub fn suspend_license_any(
    authority: impl Into<String>,
    grantee: impl Into<String>,
    feature_id: impl Into<String>,
) -> Any {
    to_any(
        &suspend_license(authority, grantee, feature_id),
        SUSPEND_LICENSE,
    )
}

/// Builds `MsgResumeLicense`.
pub fn resume_license(
    authority: impl Into<String>,
    grantee: impl Into<String>,
    feature_id: impl Into<String>,
) -> pb::MsgResumeLicense {
    pb::MsgResumeLicense {
        authority: authority.into(),
        grantee: grantee.into(),
        feature_id: feature_id.into(),
    }
}

/// Builds `MsgResumeLicense` packed into an `Any`.
pub fn resume_license_any(
    authority: impl Into<String>,
    grantee: impl Into<String>,
    feature_id: impl Into<String>,
) -> Any {
    to_any(
        &resume_license(authority, grantee, feature_id),
        RESUME_LICENSE,
    )
}
