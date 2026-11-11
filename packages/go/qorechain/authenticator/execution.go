package authenticator

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/cosmos/gogoproto/proto"

	abstractaccountv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/abstractaccount/v1"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/tx"
)

// Outcome of relayed executions (MsgExecuteEVM / MsgExecuteCosmos).
//
// From chain v3.2.8 an AUTHORISED execution that then fails (an EVM revert, a
// failed bank send) no longer fails the transaction: the tx is delivered with
// code 0, the message response carries success=false, and the chain emits an
// abstractaccount_execution_failed event (account, lane, nonce, reason). The
// authenticator nonce is consumed, so the same signature cannot be relayed
// again: sign a new one with the next nonce. A code-0 transaction is therefore
// not proof the execution happened; check it with DecodeExecutionResults or
// RequireExecutionsSucceeded.

// Type URLs of the execution responses and the failure event type.
const (
	MsgExecuteEVMResponseTypeURL    = "/qorechain.abstractaccount.v1.MsgExecuteEVMResponse"
	MsgExecuteCosmosResponseTypeURL = "/qorechain.abstractaccount.v1.MsgExecuteCosmosResponse"
	ExecutionFailedEventType        = "abstractaccount_execution_failed"
)

// ExecutionResult is the outcome of one MsgExecuteEVM / MsgExecuteCosmos.
type ExecutionResult struct {
	// Lane is "evm" or "cosmos".
	Lane string
	// Success is false when the authorised execution failed.
	Success bool
	// Ret is the EVM return data (evm lane only).
	Ret []byte
	// GasUsed is the EVM gas the call used (evm lane only).
	GasUsed uint64
	// VMError is the EVM error text (evm lane only, empty on success).
	VMError string
	// Reason, Account and Nonce come from the abstractaccount_execution_failed
	// event of a failed execution (empty when it succeeded).
	Reason  string
	Account string
	Nonce   string
}

// ExecutionFailedError reports executions that failed inside a code-0
// transaction.
type ExecutionFailedError struct {
	TxHash string
	Failed []ExecutionResult
}

func (e *ExecutionFailedError) Error() string {
	parts := make([]string, 0, len(e.Failed))
	for _, f := range e.Failed {
		why := f.Reason
		if why == "" {
			why = f.VMError
		}
		if why == "" {
			why = "no reason given"
		}
		parts = append(parts, fmt.Sprintf("%s execution failed: %s", f.Lane, why))
	}
	return fmt.Sprintf("tx %s was delivered but %s (the authenticator nonce is consumed; sign again with the next nonce)",
		e.TxHash, strings.Join(parts, "; "))
}

// DecodeExecutionResults returns, in message order, the outcome of every
// MsgExecuteEVM / MsgExecuteCosmos in a delivered transaction. Pass the
// *tx.TxResult from tx.BroadcastAndWait / tx.WaitForTx: the responses are read
// from TxResponse.data (msg_responses) and the failure reasons from the
// abstractaccount_execution_failed events (matched by msg_index when the node
// sets it, else in order).
//
// A node that leaves TxResponse.data empty yields one failed result per
// failure event only; successes cannot be seen that way.
func DecodeExecutionResults(res *tx.TxResult) ([]ExecutionResult, error) {
	if res == nil {
		return nil, fmt.Errorf("authenticator: nil tx result")
	}
	var envelope struct {
		TxResponse struct {
			Data   string `json:"data"`
			Events []struct {
				Type       string `json:"type"`
				Attributes []struct {
					Key   string `json:"key"`
					Value string `json:"value"`
				} `json:"attributes"`
			} `json:"events"`
		} `json:"tx_response"`
	}
	if len(res.Raw) == 0 {
		return nil, fmt.Errorf("authenticator: tx result carries no raw response to decode")
	}
	if err := json.Unmarshal(res.Raw, &envelope); err != nil {
		return nil, fmt.Errorf("authenticator: parse tx response: %w", err)
	}

	type failure struct {
		msgIndex int
		result   ExecutionResult
	}
	var failures []failure
	for _, ev := range envelope.TxResponse.Events {
		if ev.Type != ExecutionFailedEventType {
			continue
		}
		f := failure{msgIndex: -1}
		for _, a := range ev.Attributes {
			switch a.Key {
			case "account":
				f.result.Account = a.Value
			case "lane":
				f.result.Lane = a.Value
			case "nonce":
				f.result.Nonce = a.Value
			case "reason":
				f.result.Reason = a.Value
			case "msg_index":
				if n, err := strconv.Atoi(a.Value); err == nil {
					f.msgIndex = n
				}
			}
		}
		failures = append(failures, f)
	}

	type indexed struct {
		msgIndex int
		result   ExecutionResult
	}
	var execs []indexed
	if data := decodeTxData(envelope.TxResponse.Data); len(data) > 0 {
		var msgData sdk.TxMsgData
		if err := proto.Unmarshal(data, &msgData); err == nil {
			for i, a := range msgData.MsgResponses {
				if a == nil {
					continue
				}
				url := a.TypeUrl
				if !strings.HasPrefix(url, "/") {
					url = "/" + url
				}
				switch url {
				case MsgExecuteEVMResponseTypeURL:
					var r abstractaccountv1.MsgExecuteEVMResponse
					if err := proto.Unmarshal(a.Value, &r); err != nil {
						return nil, fmt.Errorf("authenticator: decode %s: %w", url, err)
					}
					execs = append(execs, indexed{i, ExecutionResult{Lane: "evm", Success: r.Success, Ret: r.Ret, GasUsed: r.GasUsed, VMError: r.VmError}})
				case MsgExecuteCosmosResponseTypeURL:
					var r abstractaccountv1.MsgExecuteCosmosResponse
					if err := proto.Unmarshal(a.Value, &r); err != nil {
						return nil, fmt.Errorf("authenticator: decode %s: %w", url, err)
					}
					execs = append(execs, indexed{i, ExecutionResult{Lane: "cosmos", Success: r.Success}})
				}
			}
		}
	}

	if len(execs) == 0 {
		out := make([]ExecutionResult, 0, len(failures))
		for _, f := range failures {
			out = append(out, f.result)
		}
		return out, nil
	}

	used := make([]bool, len(failures))
	attach := func(dst *ExecutionResult, f failure) {
		dst.Reason, dst.Account, dst.Nonce = f.result.Reason, f.result.Account, f.result.Nonce
	}
	// First pass: match by msg_index.
	for i := range execs {
		if execs[i].result.Success {
			continue
		}
		for j, f := range failures {
			if !used[j] && f.msgIndex >= 0 && f.msgIndex == execs[i].msgIndex {
				attach(&execs[i].result, f)
				used[j] = true
				break
			}
		}
	}
	// Second pass: remaining failures in order.
	next := 0
	for i := range execs {
		if execs[i].result.Success || execs[i].result.Reason != "" {
			continue
		}
		for next < len(failures) && (used[next] || failures[next].msgIndex >= 0) {
			next++
		}
		if next < len(failures) {
			attach(&execs[i].result, failures[next])
			used[next] = true
			next++
		}
	}
	out := make([]ExecutionResult, len(execs))
	for i, e := range execs {
		out[i] = e.result
	}
	return out, nil
}

// RequireExecutionsSucceeded returns the decoded results, and an
// *ExecutionFailedError when any execution failed even though the transaction
// code is 0.
func RequireExecutionsSucceeded(res *tx.TxResult) ([]ExecutionResult, error) {
	results, err := DecodeExecutionResults(res)
	if err != nil {
		return nil, err
	}
	var failed []ExecutionResult
	for _, r := range results {
		if !r.Success {
			failed = append(failed, r)
		}
	}
	if len(failed) > 0 {
		return results, &ExecutionFailedError{TxHash: res.TxHash, Failed: failed}
	}
	return results, nil
}

// decodeTxData decodes TxResponse.data, rendered as hex by the LCD and as
// base64 by some gateways.
func decodeTxData(s string) []byte {
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
