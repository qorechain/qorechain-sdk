package tx

import (
	"encoding/json"
	"fmt"
	"net/http"

	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/cosmos/gogoproto/proto"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/accounts"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/pqc"
)

// MessagesFromSDK converts a slice of sdk.Msg into the tx package's
// {TypeURL, Value} Message form, deriving each type URL from the gogo proto
// message name (e.g. "/qorechain.amm.v1.MsgSwapExactIn"). This is the bridge
// between the typed composers (messages.Amm.SwapExactIn, …) and the builders
// below.
func MessagesFromSDK(msgs []sdk.Msg) []Message {
	out := make([]Message, 0, len(msgs))
	for _, m := range msgs {
		out = append(out, Message{TypeURL: "/" + proto.MessageName(m), Value: m})
	}
	return out
}

// SendMessagesParams are the inputs to SendMessages.
type SendMessagesParams struct {
	// Account is the native secp256k1 signer.
	Account accounts.Secp256k1Account
	// Messages are the messages to include in the tx, in order.
	Messages []sdk.Msg
	// Fee is the explicit fee. When using auto-gas, build the fee with
	// EstimateGasAndFee/CalculateFee first; SendMessages itself does not simulate.
	Fee Fee
	// ChainID is the chain id.
	ChainID string
	// AccountNumber is the signer's on-chain account number.
	AccountNumber uint64
	// Sequence is the signer's current account sequence.
	Sequence uint64
	// Memo is an optional tx memo.
	Memo string
	// TimeoutHeight is an optional tx timeout height (0 = none).
	TimeoutHeight uint64
}

// SendMessages builds and signs a classical (secp256k1-only) transaction
// carrying any messages. It does not broadcast — pass BuiltTx.TxRawBytes to
// Broadcast (or use BroadcastAndWait).
//
// For a quantum-safe transaction over the same messages use BuildHybridMessages,
// which preserves the B0 exclude-extension contract.
func SendMessages(params SendMessagesParams) (*BuiltTx, error) {
	encoded, err := encodeMessages(MessagesFromSDK(params.Messages))
	if err != nil {
		return nil, err
	}
	body, err := newTxBody(encoded, params.Memo, params.TimeoutHeight, nil)
	if err != nil {
		return nil, err
	}
	bodyBytes, err := proto.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshal TxBody: %w", err)
	}
	authInfoBytes, err := buildAuthInfoBytes(params.Account.PublicKey, params.Sequence, params.Fee)
	if err != nil {
		return nil, err
	}
	sig, err := signDirect(params.Account.PrivateKey, bodyBytes, authInfoBytes, params.ChainID, params.AccountNumber)
	if err != nil {
		return nil, err
	}
	return assembleTxRaw(bodyBytes, authInfoBytes, sig, nil, nil)
}

// BuildHybridMessagesParams are the inputs to BuildHybridMessages.
type BuildHybridMessagesParams struct {
	Account             accounts.Secp256k1Account
	PQCKeypair          pqc.Keypair
	Messages            []sdk.Msg
	Fee                 Fee
	ChainID             string
	AccountNumber       uint64
	Sequence            uint64
	Memo                string
	TimeoutHeight       uint64
	IncludePQCPublicKey bool
}

// BuildHybridMessages is the sdk.Msg-typed entry point to BuildHybridTx: it
// accepts any messages (e.g. from the composers) and produces a hybrid
// (classical + ML-DSA-87) transaction, preserving the B0 exclude-extension
// contract documented on BuildHybridTx.
func BuildHybridMessages(params BuildHybridMessagesParams) (*BuiltTx, error) {
	return BuildHybridTx(BuildHybridTxParams{
		Account:             params.Account,
		PQCKeypair:          params.PQCKeypair,
		Messages:            MessagesFromSDK(params.Messages),
		Fee:                 params.Fee,
		ChainID:             params.ChainID,
		AccountNumber:       params.AccountNumber,
		Sequence:            params.Sequence,
		Memo:                params.Memo,
		TimeoutHeight:       params.TimeoutHeight,
		IncludePQCPublicKey: params.IncludePQCPublicKey,
	})
}

// BroadcastAndWaitParams are the inputs to BroadcastAndWait.
type BroadcastAndWaitParams struct {
	// RestURL is the REST (LCD) base URL.
	RestURL string
	// TxBytes is the encoded TxRaw to broadcast.
	TxBytes []byte
	// Mode is the broadcast mode (BroadcastSync recommended with WaitForTx).
	Mode BroadcastMode
	// Wait configures the post-broadcast polling. If zero values, sensible
	// defaults are applied (see WaitForTx).
	Wait WaitOptions
	// HTTPClient is an optional injected client.
	HTTPClient *http.Client
}

// BroadcastAndWait broadcasts a signed tx and then polls until it is included in
// a block (or the wait deadline elapses). It returns the confirmed TxResult.
//
// A non-zero broadcast (CheckTx) code is returned as a *QoreTxError immediately;
// a non-zero delivery (DeliverTx) code surfaces on the returned TxResult and as
// a *QoreTxError from WaitForTx.
func BroadcastAndWait(params BroadcastAndWaitParams) (*TxResult, error) {
	raw, err := Broadcast(params.RestURL, params.TxBytes, params.Mode, params.HTTPClient)
	if err != nil {
		return nil, err
	}
	hash, txErr, err := parseBroadcastResponse(raw)
	if err != nil {
		return nil, err
	}
	if txErr != nil {
		return nil, txErr
	}
	return WaitForTx(params.RestURL, hash, params.Wait, params.HTTPClient)
}

// parseBroadcastResponse extracts the tx hash from a /cosmos/tx/v1beta1/txs
// broadcast response and converts a non-zero CheckTx code into a *QoreTxError.
func parseBroadcastResponse(raw json.RawMessage) (hash string, txErr error, err error) {
	var resp struct {
		TxResponse struct {
			TxHash    string `json:"txhash"`
			Code      uint32 `json:"code"`
			Codespace string `json:"codespace"`
			RawLog    string `json:"raw_log"`
		} `json:"tx_response"`
	}
	if err := json.Unmarshal(raw, &resp); err != nil {
		return "", nil, fmt.Errorf("parse broadcast response: %w", err)
	}
	tr := resp.TxResponse
	if tr.TxHash == "" {
		return "", nil, fmt.Errorf("broadcast response missing txhash: %s", string(raw))
	}
	if tr.Code != 0 {
		return tr.TxHash, DecodeTxError(tr.Code, tr.Codespace, tr.RawLog), nil
	}
	return tr.TxHash, nil, nil
}
