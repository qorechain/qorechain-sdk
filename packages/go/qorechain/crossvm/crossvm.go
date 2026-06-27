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

// DefaultSourceVM is the source VM assumed when CallOptions.SourceVM is empty.
const DefaultSourceVM = VMTypeEVM
