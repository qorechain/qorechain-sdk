// Package signbytes builds the exact byte strings a QoreChain post-quantum key
// signs, in both forms the chain has used, and decides which form a given
// network verifies.
//
// Chain v3.1.98 introduced a second ("v2") form of three sign-bytes:
//
//   - hybrid tx (the ML-DSA-87 half of a hybrid classical + PQC transaction)
//   - PQC key migration (MsgMigratePQCKey, signed by both the old and new key)
//   - bridge attestation (MsgBridgeAttestation, signed by bridge validators)
//
// v2 adds a domain tag and binds the chain id, so a signature produced in one
// context (or for one network) never verifies in another. Each network accepts
// exactly ONE form at any height, with no overlap window:
//
//   - a network that existed before v3.1.98 ("qorechain-vladi" mainnet,
//     "qorechain-diana" testnet) verifies v1 until the v3.1.98 upgrade plan is
//     applied on it, and v2 from then on;
//   - any other chain id starts on a binary that verifies v2 from block one.
//
// The testnet applied v3.1.98 at height 5,746,000; mainnet stays on v1 until its
// own governance upgrade. Clients therefore must not hardcode a form: use
// VersionFor, or a Resolver that asks the node whether the plan is applied.
//
// Byte layouts (all lengths big-endian, strings UTF-8, no terminators):
//
//	hybrid v1:    BE32(len B0) ‖ B0 ‖ BE32(len A) ‖ A
//	hybrid v2:    "qorechain-pqc-hybrid-v2" ‖ BE64(len chainID) ‖ chainID ‖
//	              BE32(len B0) ‖ B0 ‖ BE32(len A) ‖ A
//	migration v1: "qorechain-key-migration:chain=%s:from=%d:to=%d:account=%s:height=%d"
//	migration v2: "qorechain-key-migration-v2" ‖ BE64(len chainID) ‖ chainID ‖
//	              BE64(len account) ‖ account ‖ BE32(from) ‖ BE32(to) ‖ BE64(height) ‖
//	              BE32(len oldPub) ‖ oldPub ‖ BE32(len newPub) ‖ newPub
//	bridge v1:    chain|eventType|operationID|txHash|amount|asset   (no chain id)
//	bridge v2:    "qorechain-bridge-attestation-v2" then, for each of
//	              [chainID, chain, eventType, operationID, txHash, amount, asset]:
//	              BE64(len f) ‖ f
//
// B0 is the TxBody serialised WITHOUT the PQC extension option and A is the
// AuthInfo bytes verbatim.
//
// This package depends only on the standard library so that every signing
// package (tx, unified, pqcdx) can import it without cycles.
package signbytes

import (
	"encoding/binary"
	"errors"
	"fmt"
	"strings"
)

// Domain tags and the upgrade that switches legacy networks to v2.
const (
	// HybridDomain prefixes the v2 hybrid tx sign-bytes.
	HybridDomain = "qorechain-pqc-hybrid-v2"
	// MigrationDomain prefixes the v2 PQC key-migration sign-bytes.
	MigrationDomain = "qorechain-key-migration-v2"
	// BridgeDomain prefixes the v2 bridge-attestation sign-bytes.
	BridgeDomain = "qorechain-bridge-attestation-v2"
	// V2Upgrade is the upgrade plan whose application switches a legacy network
	// from v1 to v2. Resolvers query /cosmos/upgrade/v1beta1/applied_plan/{V2Upgrade}.
	V2Upgrade = "v3.1.98"
)

// Version selects a sign-bytes form.
//
// V1 and V2 are resolved versions. Auto (or the zero value "") asks the SDK to
// decide: offline builders decide only when the chain id alone is enough (a
// non-legacy chain is always V2) and fail otherwise; a Resolver additionally
// asks the node whether V2Upgrade has been applied.
type Version string

// Sign-bytes versions.
const (
	// Auto resolves the version per network (the default).
	Auto Version = "auto"
	// V1 is the original form, verified by legacy networks before V2Upgrade.
	V1 Version = "v1"
	// V2 is the domain-tagged, chain-bound form.
	V2 Version = "v2"
)

// ErrUnresolvedVersion is returned when the version for a legacy network cannot
// be decided without asking the node (or the node could not be asked). Callers
// must pass a REST URL to a Resolver, or an explicit V1 / V2. The SDK never
// guesses.
var ErrUnresolvedVersion = errors.New("signbytes: cannot decide the hybrid sign-bytes version")

// legacyChains are the networks that ran before v2 existed and switch to it only
// when V2Upgrade is applied on them.
var legacyChains = map[string]bool{
	"qorechain-vladi": true,
	"qorechain-diana": true,
}

// LegacyChains returns the chain ids that start on v1 and switch to v2 only at
// V2Upgrade.
func LegacyChains() []string { return []string{"qorechain-vladi", "qorechain-diana"} }

// IsLegacyChain reports whether chainID is a network that verifies v1 until
// V2Upgrade is applied on it.
func IsLegacyChain(chainID string) bool { return legacyChains[chainID] }

// VersionFor mirrors the chain's own switch: V2 once V2Upgrade has been applied
// (v2AppliedHeight > 0) or for any chain that is not a legacy network; V1
// otherwise.
func VersionFor(chainID string, v2AppliedHeight int64) Version {
	if v2AppliedHeight > 0 || !IsLegacyChain(chainID) {
		return V2
	}
	return V1
}

// ParseVersion accepts "auto", "v1", "v2" (case-insensitive, surrounding space
// ignored) and "" (= Auto).
func ParseVersion(s string) (Version, error) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "", "auto":
		return Auto, nil
	case "v1":
		return V1, nil
	case "v2":
		return V2, nil
	}
	return "", fmt.Errorf("signbytes: version must be auto, v1 or v2, got %q", s)
}

// IsAuto reports whether v asks for per-network resolution ("" or Auto).
func (v Version) IsAuto() bool { return v == "" || v == Auto }

// Validate checks that v is one of "", Auto, V1, V2.
func (v Version) Validate() error {
	switch v {
	case "", Auto, V1, V2:
		return nil
	}
	return fmt.Errorf("signbytes: version must be auto, v1 or v2, got %q", string(v))
}

// ResolveOffline decides the version without any network access. An explicit V1
// or V2 is returned as-is. For Auto (or ""), a non-legacy chain resolves to V2;
// a legacy chain cannot be decided offline and returns an error wrapping
// ErrUnresolvedVersion telling the caller to resolve against a node (Resolver)
// or pass V1 / V2 explicitly. It never defaults silently to V1.
func ResolveOffline(chainID string, requested Version) (Version, error) {
	if err := requested.Validate(); err != nil {
		return "", err
	}
	if !requested.IsAuto() {
		return requested, nil
	}
	if !IsLegacyChain(chainID) {
		return V2, nil
	}
	return "", fmt.Errorf("%w for chain %q: it verifies v1 or v2 depending on whether upgrade %s is applied; "+
		"resolve it with a signbytes.Resolver (REST URL) or pass signbytes.V1 / signbytes.V2 explicitly",
		ErrUnresolvedVersion, chainID, V2Upgrade)
}

// --- hybrid tx ---

// HybridV1 returns the v1 hybrid sign-bytes: BE32(len B0) ‖ B0 ‖ BE32(len A) ‖ A.
func HybridV1(b0, authInfo []byte) []byte {
	out := make([]byte, 0, 8+len(b0)+len(authInfo))
	out = binary.BigEndian.AppendUint32(out, uint32(len(b0)))
	out = append(out, b0...)
	out = binary.BigEndian.AppendUint32(out, uint32(len(authInfo)))
	out = append(out, authInfo...)
	return out
}

// HybridV2 returns the v2 hybrid sign-bytes:
// HybridDomain ‖ BE64(len chainID) ‖ chainID ‖ BE32(len B0) ‖ B0 ‖ BE32(len A) ‖ A.
func HybridV2(chainID string, b0, authInfo []byte) []byte {
	out := make([]byte, 0, len(HybridDomain)+8+len(chainID)+8+len(b0)+len(authInfo))
	out = append(out, HybridDomain...)
	out = binary.BigEndian.AppendUint64(out, uint64(len(chainID)))
	out = append(out, chainID...)
	out = binary.BigEndian.AppendUint32(out, uint32(len(b0)))
	out = append(out, b0...)
	out = binary.BigEndian.AppendUint32(out, uint32(len(authInfo)))
	out = append(out, authInfo...)
	return out
}

// Hybrid dispatches to HybridV1 / HybridV2. version must be resolved (V1 or V2);
// Auto is rejected so a caller cannot sign an undecided form.
func Hybrid(version Version, chainID string, b0, authInfo []byte) ([]byte, error) {
	switch version {
	case V1:
		return HybridV1(b0, authInfo), nil
	case V2:
		return HybridV2(chainID, b0, authInfo), nil
	}
	return nil, unresolvedArg(version)
}

// --- PQC key migration ---

// MigrationV1 returns the v1 (legacy, ASCII) key-migration sign-bytes:
// "qorechain-key-migration:chain=<chainID>:from=<from>:to=<to>:account=<account>:height=<height>".
func MigrationV1(chainID, account string, fromAlgo, toAlgo uint32, height int64) []byte {
	return []byte(fmt.Sprintf(
		"qorechain-key-migration:chain=%s:from=%d:to=%d:account=%s:height=%d",
		chainID, fromAlgo, toAlgo, account, height,
	))
}

// MigrationV2 returns the v2 key-migration sign-bytes, binding both public keys:
// MigrationDomain ‖ BE64(len chainID) ‖ chainID ‖ BE64(len account) ‖ account ‖
// BE32(from) ‖ BE32(to) ‖ BE64(height) ‖ BE32(len oldPub) ‖ oldPub ‖
// BE32(len newPub) ‖ newPub.
func MigrationV2(chainID, account string, fromAlgo, toAlgo uint32, height int64, oldPub, newPub []byte) []byte {
	out := make([]byte, 0, len(MigrationDomain)+8+len(chainID)+8+len(account)+4+4+8+4+len(oldPub)+4+len(newPub))
	out = append(out, MigrationDomain...)
	out = binary.BigEndian.AppendUint64(out, uint64(len(chainID)))
	out = append(out, chainID...)
	out = binary.BigEndian.AppendUint64(out, uint64(len(account)))
	out = append(out, account...)
	out = binary.BigEndian.AppendUint32(out, fromAlgo)
	out = binary.BigEndian.AppendUint32(out, toAlgo)
	out = binary.BigEndian.AppendUint64(out, uint64(height))
	out = binary.BigEndian.AppendUint32(out, uint32(len(oldPub)))
	out = append(out, oldPub...)
	out = binary.BigEndian.AppendUint32(out, uint32(len(newPub)))
	out = append(out, newPub...)
	return out
}

// Migration dispatches to MigrationV1 / MigrationV2 (oldPub/newPub are ignored
// by v1). version must be resolved (V1 or V2).
func Migration(version Version, chainID, account string, fromAlgo, toAlgo uint32, height int64, oldPub, newPub []byte) ([]byte, error) {
	switch version {
	case V1:
		return MigrationV1(chainID, account, fromAlgo, toAlgo, height), nil
	case V2:
		return MigrationV2(chainID, account, fromAlgo, toAlgo, height, oldPub, newPub), nil
	}
	return nil, unresolvedArg(version)
}

// --- bridge attestation ---

// BridgeAttestation carries the MsgBridgeAttestation fields that are signed.
// Amount is the decimal integer string exactly as the chain renders it
// (math.Int.String(), e.g. "1000000"; zero is "0").
type BridgeAttestation struct {
	Chain       string
	EventType   string
	OperationID string
	TxHash      string
	Amount      string
	Asset       string
}

// BridgeV1 returns the v1 (legacy) attestation sign-bytes: the six fields
// pipe-joined, with no chain id.
func BridgeV1(att BridgeAttestation) []byte {
	return []byte(fmt.Sprintf("%s|%s|%s|%s|%s|%s",
		att.Chain, att.EventType, att.OperationID, att.TxHash, att.Amount, att.Asset))
}

// BridgeV2 returns the v2 attestation sign-bytes: BridgeDomain followed by
// BE64(len f) ‖ f for f in [chainID, chain, eventType, operationID, txHash,
// amount, asset].
func BridgeV2(chainID string, att BridgeAttestation) []byte {
	fields := []string{chainID, att.Chain, att.EventType, att.OperationID, att.TxHash, att.Amount, att.Asset}
	n := len(BridgeDomain)
	for _, f := range fields {
		n += 8 + len(f)
	}
	out := make([]byte, 0, n)
	out = append(out, BridgeDomain...)
	for _, f := range fields {
		out = binary.BigEndian.AppendUint64(out, uint64(len(f)))
		out = append(out, f...)
	}
	return out
}

// Bridge dispatches to BridgeV1 / BridgeV2. version must be resolved (V1 or V2).
func Bridge(version Version, chainID string, att BridgeAttestation) ([]byte, error) {
	switch version {
	case V1:
		return BridgeV1(att), nil
	case V2:
		return BridgeV2(chainID, att), nil
	}
	return nil, unresolvedArg(version)
}

func unresolvedArg(v Version) error {
	if v.IsAuto() {
		return fmt.Errorf("%w: a builder needs a resolved version (v1 or v2), got %q; "+
			"resolve it first with ResolveOffline or a Resolver", ErrUnresolvedVersion, string(v))
	}
	return fmt.Errorf("signbytes: version must be v1 or v2, got %q", string(v))
}

// --- rejection detection ---

// HybridRejectionMessage is the chain's message for pqc codespace code 21.
const HybridRejectionMessage = "hybrid PQC signature verification failed"

// HybridRejectionCodespace / HybridRejectionCode identify the chain's refusal of
// a hybrid signature (for example one signed over the wrong sign-bytes form).
const (
	HybridRejectionCodespace = "pqc"
	HybridRejectionCode      = 21
)

// IsHybridRejection reports whether a broadcast result is the chain refusing the
// hybrid PQC signature: codespace "pqc" with code 21, or a log / message that
// contains HybridRejectionMessage. Code 21 in any other codespace (e.g. the root
// "sdk" codespace's "tx too large") is NOT this case.
func IsHybridRejection(codespace string, code uint32, log string) bool {
	if codespace == HybridRejectionCodespace && code == HybridRejectionCode {
		return true
	}
	return strings.Contains(log, HybridRejectionMessage)
}
