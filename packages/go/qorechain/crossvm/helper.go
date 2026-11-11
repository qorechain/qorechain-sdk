package crossvm

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	sdk "github.com/cosmos/cosmos-sdk/types"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/accounts"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/messages"
	crossvmv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/crossvm/v1"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/tx"
)

// Signer carries the signing context the high-level Call / CallAtomic methods
// need to build, sign, and broadcast a transaction. It mirrors the TS SDK's
// `tx` object, which already carries the sender address and signing material; in
// the Go SDK the account number / sequence are supplied explicitly (as
// everywhere else in tx.*).
//
// The sender address is taken from Account.Address, so callers never repeat it.
type Signer struct {
	// Account is the native secp256k1 signer.
	Account accounts.Secp256k1Account
	// ChainID is the chain id (e.g. "qorechain-vladi").
	ChainID string
	// RestURL is the REST (LCD) base URL used to broadcast.
	RestURL string
	// AccountNumber is the signer's on-chain account number.
	AccountNumber uint64
	// Sequence is the signer's current account sequence (nonce).
	Sequence uint64
	// Fee is the fee to pay. Set Fee.Gas to tx.GasAuto ("auto") to simulate
	// the transaction and price ceil(simulated * max(GasMultiplier, 1.3)) at
	// GasPrice, or give an explicit gas limit. An empty Fee.Gas is refused:
	// cross-VM gas varies widely (the first call of a contract code in a block
	// costs much more), so there is no fixed fallback. Use auto / simulation
	// for wasm and cross-VM gas.
	Fee tx.Fee
	// GasPrice prices an automatic fee (Fee.Gas == tx.GasAuto). Empty uses
	// tx.DefaultGasPrice.
	GasPrice string
	// GasMultiplier scales the simulated gas of an automatic fee; values below
	// tx.WasmGasMultiplier (1.3) are raised to it.
	GasMultiplier float64
	// HTTPClient is used for simulation and broadcast (nil = the SDK default).
	HTTPClient *http.Client
	// Mode is the broadcast mode (defaults to tx.BroadcastSync).
	Mode tx.BroadcastMode
	// Wait configures post-broadcast polling (zero values use sensible defaults).
	Wait tx.WaitOptions
}

// QorRPC is the subset of query.QorClient used by GetMessage as a fallback when
// no gRPC query client is supplied.
type QorRPC interface {
	GetCrossVMMessage(messageID string) (json.RawMessage, error)
}

// Client is the high-level cross-VM helper.
//
// Construct one with New, passing a Signer (for writes) and, optionally, a typed
// gRPC query client and/or a qor_* RPC client (for GetMessage).
type Client struct {
	signer Signer
	query  crossvmv1.QueryClient
	qor    QorRPC
}

// Options configures New.
type Options struct {
	// Query is the typed crossvm gRPC query client (e.g. grpcClient.CrossVM()).
	// When set, GetMessage uses it; otherwise GetMessage falls back to Qor.
	Query crossvmv1.QueryClient
	// Qor is the qor_* JSON-RPC client used by GetMessage as a fallback
	// (qor_getCrossVMMessage). Optional.
	Qor QorRPC
}

// New creates a cross-VM helper bound to a Signer.
func New(signer Signer, opts Options) *Client {
	return &Client{signer: signer, query: opts.Query, qor: opts.Qor}
}

// CallOptions are the inputs to Call / BuildCall / CallAtomic.
//
// Exactly one of Payload or Cosmwasm must be supplied:
//   - Payload: raw bytes passed verbatim as the message payload (use for EVM and
//     SVM targets, or any pre-encoded payload).
//   - Cosmwasm: any JSON-serializable value, json.Marshal'd to UTF-8 bytes (use
//     for CosmWasm execute messages).
type CallOptions struct {
	// SourceVM is the calling VM. Empty defaults to DefaultSourceVM ("evm").
	//
	// The chain IGNORES this field (chain v3.1.97+): it derives the origin lane
	// from the execution context, because a caller naming its own lane is not
	// evidence of what it is. It is still sent - and still defaulted - so older
	// nodes that read it keep working; setting it changes nothing on a current
	// chain, and it can never be used to claim a lane the caller is not on.
	SourceVM crossvmv1.VMType
	// TargetVM is the VM hosting the target contract (required).
	TargetVM crossvmv1.VMType
	// TargetContract is the target contract address/identifier (required).
	TargetContract string
	// Funds are coins to send along with the call.
	Funds sdk.Coins
	// Payload is the raw payload bytes. Mutually exclusive with Cosmwasm.
	Payload []byte
	// Cosmwasm is a JSON-serializable CosmWasm message. Mutually exclusive with
	// Payload; it is json.Marshal'd to UTF-8 payload bytes.
	Cosmwasm any
	// Async queues the call instead of executing it, leaving it for a later
	// ProcessQueue dispatch.
	//
	// The default (false) executes the call inside this transaction and returns
	// the callee's answer in CallResult.Data - which is what a caller that needs
	// the result requires. With Async=true the response carries only the message
	// id: Executed is false, Data is empty, and the outcome must be polled with
	// GetMessage.
	Async bool
	// AsyncGasLimit is the gas a queued call into CosmWasm may use (chain
	// v3.2.8): 0 = 500,000, otherwise 250,000..10,000,000. Async calls into
	// CosmWasm only.
	//
	// An async call holds an escrow of AsyncGasLimit x factor x gas price
	// (about 0.2 QOR with the defaults), refunded when the call finishes, and
	// pays a queue-slot fee. A sender may have at most 100 pending calls.
	AsyncGasLimit uint64
	// AsyncMaxFactor caps the congestion factor the queued call accepts, in
	// millionths (1,000,000 = 1x; 0 = four times the factor at submission).
	// Async calls into CosmWasm only.
	AsyncMaxFactor uint64
}

// resolvePayload returns the payload bytes implied by the options, enforcing the
// "exactly one of Payload / Cosmwasm" rule.
func (o CallOptions) resolvePayload() ([]byte, error) {
	hasPayload := o.Payload != nil
	hasCosmwasm := o.Cosmwasm != nil
	switch {
	case hasPayload && hasCosmwasm:
		return nil, fmt.Errorf("crossvm: set exactly one of Payload or Cosmwasm, not both")
	case hasCosmwasm:
		b, err := json.Marshal(o.Cosmwasm)
		if err != nil {
			return nil, fmt.Errorf("crossvm: marshal cosmwasm payload: %w", err)
		}
		return b, nil
	case hasPayload:
		return o.Payload, nil
	default:
		return nil, fmt.Errorf("crossvm: set exactly one of Payload or Cosmwasm")
	}
}

// message builds the typed MsgCrossVMCall for these options using the sender
// from the helper's Signer.
func (c *Client) message(o CallOptions) (*crossvmv1.MsgCrossVMCall, error) {
	if o.TargetVM == "" {
		return nil, fmt.Errorf("crossvm: TargetVM is required")
	}
	if o.TargetContract == "" {
		return nil, fmt.Errorf("crossvm: TargetContract is required")
	}
	payload, err := o.resolvePayload()
	if err != nil {
		return nil, err
	}
	sourceVM := o.SourceVM
	if sourceVM == "" {
		sourceVM = DefaultSourceVM
	}
	msg := messages.CrossVM.Call(
		c.signer.Account.Address,
		sourceVM,
		o.TargetVM,
		o.TargetContract,
		payload,
		o.Funds,
		o.Async,
	)
	msg.AsyncGasLimit = o.AsyncGasLimit
	msg.AsyncMaxFactor = o.AsyncMaxFactor
	if err := messages.ValidateCrossVMCall(msg); err != nil {
		return nil, err
	}
	return msg, nil
}

// BuildCall builds and signs a single MsgCrossVMCall WITHOUT broadcasting,
// returning the built tx ready to pass to tx.Broadcast / tx.BroadcastAndWait.
func (c *Client) BuildCall(o CallOptions) (*tx.BuiltTx, error) {
	msg, err := c.message(o)
	if err != nil {
		return nil, err
	}
	return c.build([]sdk.Msg{msg})
}

// Call builds, signs, and broadcasts a single MsgCrossVMCall, waiting for
// inclusion, and returns the confirmed TxResult.
func (c *Client) Call(o CallOptions) (*tx.TxResult, error) {
	msg, err := c.message(o)
	if err != nil {
		return nil, err
	}
	return c.broadcast([]sdk.Msg{msg})
}

// CallAtomic builds, signs, and broadcasts ONE transaction carrying N
// MsgCrossVMCall messages - they succeed or fail atomically as a single tx.
func (c *Client) CallAtomic(opts []CallOptions) (*tx.TxResult, error) {
	if len(opts) == 0 {
		return nil, fmt.Errorf("crossvm: CallAtomic requires at least one call")
	}
	msgs := make([]sdk.Msg, 0, len(opts))
	for i, o := range opts {
		msg, err := c.message(o)
		if err != nil {
			return nil, fmt.Errorf("crossvm: call %d: %w", i, err)
		}
		msgs = append(msgs, msg)
	}
	return c.broadcast(msgs)
}

// BuildCallAtomic builds and signs ONE transaction with N MsgCrossVMCall
// messages WITHOUT broadcasting.
func (c *Client) BuildCallAtomic(opts []CallOptions) (*tx.BuiltTx, error) {
	if len(opts) == 0 {
		return nil, fmt.Errorf("crossvm: BuildCallAtomic requires at least one call")
	}
	msgs := make([]sdk.Msg, 0, len(opts))
	for i, o := range opts {
		msg, err := c.message(o)
		if err != nil {
			return nil, fmt.Errorf("crossvm: call %d: %w", i, err)
		}
		msgs = append(msgs, msg)
	}
	return c.build(msgs)
}

// GetMessage fetches a cross-VM message by id. It prefers the typed gRPC query
// client (when supplied to New); otherwise it falls back to the qor_* RPC client
// (qor_getCrossVMMessage). An error is returned if neither is configured.
func (c *Client) GetMessage(id string) (*crossvmv1.QueryMessageResponse, error) {
	if c.query != nil {
		return c.query.Message(context.Background(), &crossvmv1.QueryMessageRequest{Id: id})
	}
	if c.qor != nil {
		raw, err := c.qor.GetCrossVMMessage(id)
		if err != nil {
			return nil, err
		}
		var resp crossvmv1.QueryMessageResponse
		if err := json.Unmarshal(raw, &resp); err != nil {
			return nil, fmt.Errorf("crossvm: decode qor_getCrossVMMessage: %w", err)
		}
		return &resp, nil
	}
	return nil, fmt.Errorf("crossvm: GetMessage requires a query client - pass Query or Qor to New")
}

// build signs the given messages into a BuiltTx using the helper's Signer.
// With Fee.Gas == tx.GasAuto the tx is simulated first and its gas scaled by
// at least tx.WasmGasMultiplier; an empty Fee.Gas is refused.
func (c *Client) build(msgs []sdk.Msg) (*tx.BuiltTx, error) {
	fee := c.signer.Fee
	switch fee.Gas {
	case "":
		return nil, fmt.Errorf("crossvm: %w", tx.ErrFixedGasForWasm)
	case tx.GasAuto:
		var err error
		if fee, err = c.autoFee(msgs); err != nil {
			return nil, err
		}
	}
	return c.sign(msgs, fee)
}

func (c *Client) sign(msgs []sdk.Msg, fee tx.Fee) (*tx.BuiltTx, error) {
	return tx.SendMessages(tx.SendMessagesParams{
		Account:       c.signer.Account,
		Messages:      msgs,
		Fee:           fee,
		ChainID:       c.signer.ChainID,
		AccountNumber: c.signer.AccountNumber,
		Sequence:      c.signer.Sequence,
	})
}

// autoFee simulates the tx and prices ceil(simulated * max(GasMultiplier,
// 1.3)) at GasPrice.
func (c *Client) autoFee(msgs []sdk.Msg) (tx.Fee, error) {
	if c.signer.RestURL == "" {
		return tx.Fee{}, fmt.Errorf("crossvm: automatic gas needs Signer.RestURL to simulate")
	}
	probe, err := c.sign(msgs, tx.Fee{Granter: c.signer.Fee.Granter, Payer: c.signer.Fee.Payer})
	if err != nil {
		return tx.Fee{}, err
	}
	simulated, err := tx.EstimateGas(c.signer.RestURL, probe.TxRawBytes, c.signer.HTTPClient)
	if err != nil {
		return tx.Fee{}, fmt.Errorf("crossvm: simulate: %w", err)
	}
	priceStr := c.signer.GasPrice
	if priceStr == "" {
		priceStr = tx.DefaultGasPrice
	}
	price, err := tx.ParseGasPrice(priceStr)
	if err != nil {
		return tx.Fee{}, err
	}
	fee, err := tx.CalculateFee(tx.WasmGasWanted(simulated, c.signer.GasMultiplier), 1, price)
	if err != nil {
		return tx.Fee{}, err
	}
	fee.Granter, fee.Payer = c.signer.Fee.Granter, c.signer.Fee.Payer
	return fee, nil
}

// broadcast builds, signs, and broadcasts the given messages, waiting for
// inclusion.
func (c *Client) broadcast(msgs []sdk.Msg) (*tx.TxResult, error) {
	built, err := c.build(msgs)
	if err != nil {
		return nil, err
	}
	mode := c.signer.Mode
	if mode == "" {
		mode = tx.BroadcastSync
	}
	return tx.BroadcastAndWait(tx.BroadcastAndWaitParams{
		RestURL:    c.signer.RestURL,
		TxBytes:    built.TxRawBytes,
		Mode:       mode,
		Wait:       c.signer.Wait,
		HTTPClient: c.signer.HTTPClient,
	})
}
