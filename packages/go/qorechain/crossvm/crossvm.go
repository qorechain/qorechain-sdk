// Package crossvm provides a high-level helper for QoreChain's unified cross-VM
// call surface (x/crossvm): one message type, MsgCrossVMCall, lets a contract or
// account on one VM (EVM, CosmWasm, or SVM) invoke a contract on another.
//
// The helper mirrors the SDK's module-helper style: thin option structs feed the
// typed message composer (messages.CrossVM.Call), and the high-level Call /
// CallAtomic methods build, sign, and broadcast a transaction using a caller-
// supplied SignerContext. BuildCall is the build-only variant.
//
// Direction note: the EVM ABI-encoding of high-level cross-VM calls is provided
// in the TypeScript SDK only. In Go, EVM targets accept a raw Payload (the bytes
// the target VM expects); CosmWasm targets accept any JSON-serializable value,
// which is json.Marshal'd to UTF-8 bytes.
package crossvm

import (
	crossvmv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/crossvm/v1"
)

// MsgCrossVMCallTypeURL is the type URL of the unified cross-VM call message.
const MsgCrossVMCallTypeURL = "/qorechain.crossvm.v1.MsgCrossVMCall"

// VMType identifiers accepted by the x/crossvm module.
const (
	// VMTypeEVM is the EVM execution environment.
	VMTypeEVM crossvmv1.VMType = "evm"
	// VMTypeCosmWasm is the CosmWasm execution environment.
	VMTypeCosmWasm crossvmv1.VMType = "cosmwasm"
	// VMTypeSVM is the SVM (Solana VM) execution environment.
	VMTypeSVM crossvmv1.VMType = "svm"
)

// DefaultSourceVM is the source VM assumed when CallOptions.SourceVM is empty
// and the target is not EVM. A call into EVM with an empty SourceVM gets
// VMTypeCosmWasm instead (see SourceVMFor).
//
// The chain does not route by source_vm (chain v3.1.97+ derives the origin
// lane from the execution context), but it does validate it: the source and
// target VM must be different, or the call is refused.
const DefaultSourceVM = VMTypeEVM

// SourceVMFor returns the source VM the helper sends for a call into target
// when the caller names none: DefaultSourceVM ("evm"), or VMTypeCosmWasm
// when the target is EVM, because the chain refuses a call whose source and
// target VM are the same.
func SourceVMFor(target crossvmv1.VMType) crossvmv1.VMType {
	if target == VMTypeEVM {
		return VMTypeCosmWasm
	}
	return DefaultSourceVM
}
