package crossvm

// Decoding of MsgCrossVMCallResponse out of a confirmed transaction.
//
// A synchronous cross-VM call (the default, CallOptions.Async == false) executes
// inside the transaction and the callee's answer comes back in the Msg response,
// not in an event — so a caller that needs the result has to decode it. Since
// chain v3.1.97 the response carries, besides the message id:
//
//	Executed — false for a queued (async) call, whose result is not known yet
//	Data     — the callee's return value
//	GasUsed  — gas the callee's execution consumed
//
// The response bytes travel in TxResponse.data: the hex-encoded protobuf
// sdk.TxMsgData, whose MsgResponses are one Any per Msg in the tx, in order.

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"

	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/cosmos/gogoproto/proto"

	crossvmv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/crossvm/v1"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/tx"
)

// MsgCrossVMCallResponseTypeURL is the type URL of the cross-VM call response.
const MsgCrossVMCallResponseTypeURL = "/qorechain.crossvm.v1.MsgCrossVMCallResponse"

// CallResult is one decoded MsgCrossVMCallResponse — the outcome of a single
// MsgCrossVMCall in a transaction.
type CallResult struct {
	// MessageID is the chain's id for the cross-VM message. Pass it to
	// Client.GetMessage to follow a queued call.
	MessageID string
	// Executed reports whether the call ran inside this transaction. It is false
	// for an async (queued) call, whose result is not known yet — poll
	// GetMessage for the outcome.
	Executed bool
	// Data is the callee's return value, carried back to the caller. Empty for a
	// queued call and for a callee that returns nothing.
	Data []byte
	// GasUsed is the gas the callee's execution consumed (0 for a queued call).
	GasUsed uint64
}

// DecodeCallResults decodes every MsgCrossVMCallResponse carried by a confirmed
// transaction, in message order — so for a CallAtomic of N calls, result[i]
// belongs to option[i].
//
// Pass the *tx.TxResult returned by Call / CallAtomic (or by
// tx.BroadcastAndWait / tx.WaitForTx): the responses are read from its Raw JSON.
//
// FALLBACK: a node that does not populate TxResponse.data leaves only the
// emitted events. In that case the ids are recovered from the `message_id`
// event attribute and the remaining fields are ZERO — Executed is false and Data
// is empty because the event does not carry them, NOT because the call was
// queued. Use Client.GetMessage to establish the real status when Data matters.
func DecodeCallResults(res *tx.TxResult) ([]CallResult, error) {
	if res == nil {
		return nil, fmt.Errorf("crossvm: nil tx result")
	}
	raw, err := parseTxResponseRaw(res.Raw)
	if err != nil {
		return nil, err
	}
	if responseBytes := decodeBinaryField(raw.Data); len(responseBytes) > 0 {
		out, err := decodeMsgResponses(responseBytes)
		if err != nil {
			return nil, err
		}
		if len(out) > 0 {
			return out, nil
		}
	}
	return messageIDsFromEvents(raw.Events), nil
}

// DecodeCallResult decodes the FIRST MsgCrossVMCallResponse in a confirmed
// transaction — the common case of a single Call. It returns an error when the
// transaction carries no cross-VM response at all.
func DecodeCallResult(res *tx.TxResult) (CallResult, error) {
	all, err := DecodeCallResults(res)
	if err != nil {
		return CallResult{}, err
	}
	if len(all) == 0 {
		return CallResult{}, fmt.Errorf("crossvm: transaction carries no %s", MsgCrossVMCallResponseTypeURL)
	}
	return all[0], nil
}

// --- internal helpers ---

// txResponseRaw is the slice of the REST tx-by-hash body the decoder needs.
type txResponseRaw struct {
	Data   string       `json:"data"`
	Events []txRawEvent `json:"events"`
}

type txRawEvent struct {
	Type       string           `json:"type"`
	Attributes []txRawAttribute `json:"attributes"`
}

type txRawAttribute struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

func parseTxResponseRaw(body json.RawMessage) (txResponseRaw, error) {
	if len(body) == 0 {
		return txResponseRaw{}, fmt.Errorf("crossvm: tx result carries no raw response to decode")
	}
	var envelope struct {
		TxResponse txResponseRaw `json:"tx_response"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return txResponseRaw{}, fmt.Errorf("crossvm: parse tx response: %w", err)
	}
	return envelope.TxResponse, nil
}

// decodeBinaryField decodes TxResponse.data, which the LCD renders as hex
// (uppercase) but some gateways render as base64. An undecodable value yields
// nil, which sends the caller to the event fallback rather than to an error.
func decodeBinaryField(s string) []byte {
	if s == "" {
		return nil
	}
	if b, err := hex.DecodeString(s); err == nil {
		return b
	}
	if b, err := base64.StdEncoding.DecodeString(s); err == nil {
		return b
	}
	return nil
}

// decodeMsgResponses pulls the cross-VM responses out of an encoded
// sdk.TxMsgData.
func decodeMsgResponses(encoded []byte) ([]CallResult, error) {
	var msgData sdk.TxMsgData
	if err := proto.Unmarshal(encoded, &msgData); err != nil {
		// Not a TxMsgData (an older/foreign encoding): fall back to events.
		return nil, nil
	}
	out := make([]CallResult, 0, len(msgData.MsgResponses))
	for _, anyResp := range msgData.MsgResponses {
		if anyResp == nil || normalizeTypeURL(anyResp.TypeUrl) != MsgCrossVMCallResponseTypeURL {
			continue
		}
		result, err := unmarshalCallResponse(anyResp.Value)
		if err != nil {
			return nil, err
		}
		out = append(out, result)
	}
	if len(out) > 0 {
		return out, nil
	}
	// Pre-0.46 shape: TxMsgData.Data holds {msg_type, data} pairs keyed by the
	// REQUEST type URL.
	for _, d := range msgData.Data { //nolint:staticcheck // legacy shape, read-only
		if d == nil || normalizeTypeURL(d.MsgType) != MsgCrossVMCallTypeURL {
			continue
		}
		result, err := unmarshalCallResponse(d.Data)
		if err != nil {
			return nil, err
		}
		out = append(out, result)
	}
	return out, nil
}

func unmarshalCallResponse(value []byte) (CallResult, error) {
	var resp crossvmv1.MsgCrossVMCallResponse
	if err := proto.Unmarshal(value, &resp); err != nil {
		return CallResult{}, fmt.Errorf("crossvm: decode %s: %w", MsgCrossVMCallResponseTypeURL, err)
	}
	return CallResult{
		MessageID: resp.MessageID,
		Executed:  resp.Executed,
		Data:      resp.Data,
		GasUsed:   resp.GasUsed,
	}, nil
}

// messageIDsFromEvents recovers ids from the emitted events when the node did
// not populate TxResponse.data. Only MessageID can be filled this way.
func messageIDsFromEvents(events []txRawEvent) []CallResult {
	var out []CallResult
	for _, ev := range events {
		for _, attr := range ev.Attributes {
			if attr.Key == "message_id" || attr.Key == "messageId" {
				out = append(out, CallResult{MessageID: attr.Value})
			}
		}
	}
	return out
}

// normalizeTypeURL makes a type URL comparable whether or not it carries the
// leading slash.
func normalizeTypeURL(url string) string {
	if url == "" || strings.HasPrefix(url, "/") {
		return url
	}
	return "/" + url
}
