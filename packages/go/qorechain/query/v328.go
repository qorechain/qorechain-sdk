package query

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"

	"github.com/cosmos/gogoproto/jsonpb"
	"github.com/cosmos/gogoproto/proto"

	crossvmv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/crossvm/v1"
	pqcv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/pqc/v1"
	rdkv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/rdk/v1"
	svmv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/svm/v1"
)

// Reads used by the chain v3.2.8 client helpers.

// REST routes read here.
const (
	RdkParamsPath        = "/qorechain/rdk/v1/params"
	SvmParamsPath        = "/qorechain/svm/v1/params"
	CrossVMPendingPath   = "/qorechain/crossvm/v1/pending"
	EVMLimitsPath        = "/qorechain/pqc/v1/evm_limits"
	FeemarketParamsPath  = "/cosmos/evm/feemarket/v1/params"
	CrossVMPendingMaxPer = 100
	// CrossVMPendingPayloadListBytes is how much of each payload the pending
	// list carries: payload_hex in a list entry is cut to its first 1,024
	// bytes. Fetch the single message (GetCrossVMMessage) for the full one.
	CrossVMPendingPayloadListBytes = 1024
	// DefaultPendingPageCap bounds GetAllCrossVMPending when maxPages <= 0.
	DefaultPendingPageCap = 1000
)

// CrossVMMessagePath is the REST route of one cross-VM message.
func CrossVMMessagePath(id string) string {
	return "/qorechain/crossvm/v1/message/" + url.PathEscape(id)
}

// GetRdkParams returns the rdk parameters in force.
func (c *RestClient) GetRdkParams() (*rdkv1.QueryParamsResponse, error) {
	out := &rdkv1.QueryParamsResponse{}
	return out, c.getProto(RdkParamsPath, out)
}

// GetSvmParams returns the svm parameters from GET /qorechain/svm/v1/params,
// answered as {"params": {...}} (a bare params object is accepted too).
func (c *RestClient) GetSvmParams() (*svmv1.SVMParams, error) {
	raw, err := c.Get(SvmParamsPath, nil)
	if err != nil {
		return nil, err
	}
	return ParseSvmParams(raw)
}

// ParseSvmParams decodes an svm params response body.
func ParseSvmParams(raw []byte) (*svmv1.SVMParams, error) {
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(raw, &probe); err != nil {
		return nil, fmt.Errorf("%s: decoding response: %w", SvmParamsPath, err)
	}
	body := raw
	if _, wrapped := probe["params"]; !wrapped {
		body, _ = json.Marshal(map[string]json.RawMessage{"params": raw})
	}
	// MsgUpdateParams is {authority, params}: it decodes the params object with
	// the generated JSON names and custom types.
	holder := &svmv1.MsgUpdateParams{}
	u := jsonpb.Unmarshaler{AllowUnknownFields: true}
	if err := u.Unmarshal(bytes.NewReader(body), holder); err != nil {
		return nil, fmt.Errorf("%s: decoding response: %w", SvmParamsPath, err)
	}
	return &holder.Params, nil
}

// GetCrossVMPending returns one page of queued cross-VM messages (chain
// v3.2.8: paginated, at most 100 per page). pageKey is the previous page's
// pagination.next_key (base64, empty for the first page); limit 0 lets the
// node choose. payload_hex in each entry is cut to its first 1,024 bytes; use
// GetCrossVMMessage for the full payload.
func (c *RestClient) GetCrossVMPending(pageKey []byte, limit uint64) (*crossvmv1.QueryPendingMessagesResponse, error) {
	q := map[string]string{}
	if len(pageKey) > 0 {
		q["pagination.key"] = base64.StdEncoding.EncodeToString(pageKey)
	}
	if limit > 0 {
		q["pagination.limit"] = strconv.FormatUint(limit, 10)
	}
	out := &crossvmv1.QueryPendingMessagesResponse{}
	return out, c.getProtoQuery(CrossVMPendingPath, q, out)
}

// GetAllCrossVMPending walks every page of the pending queue, following
// pagination.next_key until it is empty. maxPages caps the walk (<= 0 uses
// DefaultPendingPageCap); reaching the cap is an error, so a node that keeps
// answering a key cannot loop forever. Payloads in the list are truncated to
// 1,024 bytes.
func (c *RestClient) GetAllCrossVMPending(maxPages int) ([]*crossvmv1.CrossVMMessageView, error) {
	if maxPages <= 0 {
		maxPages = DefaultPendingPageCap
	}
	var all []*crossvmv1.CrossVMMessageView
	var key []byte
	for page := 0; page < maxPages; page++ {
		resp, err := c.GetCrossVMPending(key, CrossVMPendingMaxPer)
		if err != nil {
			return all, err
		}
		all = append(all, resp.Messages...)
		if resp.Pagination == nil || len(resp.Pagination.NextKey) == 0 {
			return all, nil
		}
		if bytes.Equal(resp.Pagination.NextKey, key) {
			return all, fmt.Errorf("%s: the node returned the same next_key twice", CrossVMPendingPath)
		}
		key = resp.Pagination.NextKey
	}
	return all, fmt.Errorf("%s: stopped after %d pages with more to read", CrossVMPendingPath, maxPages)
}

// GetCrossVMMessage returns one cross-VM message with its full payload.
func (c *RestClient) GetCrossVMMessage(id string) (*crossvmv1.QueryMessageResponse, error) {
	out := &crossvmv1.QueryMessageResponse{}
	return out, c.getProto(CrossVMMessagePath(id), out)
}

// DefaultEVMTxMaxGas is the EVM transaction gas cap on chain v3.2.8, used when
// the limits are not queried. An EVM transaction asking for more is refused.
const DefaultEVMTxMaxGas uint64 = 30_000_000

// EVMLimits are the EVM execution limits in force.
type EVMLimits struct {
	// TxMaxGas is the most gas one EVM transaction may ask for.
	TxMaxGas uint64
	// PrecompileInputMaxBytes is the largest input a guarded stateful
	// precompile accepts.
	PrecompileInputMaxBytes uint64
}

// GetEVMLimits reads GET /qorechain/pqc/v1/evm_limits (chain v3.2.8). It uses
// the values in force (fields 2 and 3) and falls back to the governance-set
// limits (field 1) when a node leaves those empty; TxMaxGas falls back to
// DefaultEVMTxMaxGas when neither is set.
func (c *RestClient) GetEVMLimits() (EVMLimits, error) {
	resp := &pqcv1.QueryEVMLimitsResponse{}
	if err := c.getProto(EVMLimitsPath, resp); err != nil {
		return EVMLimits{}, err
	}
	out := EVMLimits{TxMaxGas: resp.TxMaxGas, PrecompileInputMaxBytes: resp.PrecompileInputMaxBytes}
	if resp.Limits != nil {
		if out.TxMaxGas == 0 {
			out.TxMaxGas = resp.Limits.TxMaxGas
		}
		if out.PrecompileInputMaxBytes == 0 {
			out.PrecompileInputMaxBytes = resp.Limits.PrecompileInputMaxBytes
		}
	}
	if out.TxMaxGas == 0 {
		out.TxMaxGas = DefaultEVMTxMaxGas
	}
	return out, nil
}

// GetFeemarketMinGasPrice returns params.min_gas_price from GET
// /cosmos/evm/feemarket/v1/params as the decimal string the node sends (in the
// 18-decimal EVM unit per gas).
func (c *RestClient) GetFeemarketMinGasPrice() (string, error) {
	raw, err := c.Get(FeemarketParamsPath, nil)
	if err != nil {
		return "", err
	}
	var body struct {
		Params struct {
			MinGasPrice string `json:"min_gas_price"`
		} `json:"params"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return "", fmt.Errorf("%s: decoding response: %w", FeemarketParamsPath, err)
	}
	if body.Params.MinGasPrice == "" {
		return "", fmt.Errorf("%s: response has no params.min_gas_price", FeemarketParamsPath)
	}
	return body.Params.MinGasPrice, nil
}

// getProtoQuery is getProto with query parameters.
func (c *RestClient) getProtoQuery(path string, q map[string]string, out proto.Message) error {
	raw, err := c.Get(path, q)
	if err != nil {
		return err
	}
	u := jsonpb.Unmarshaler{AllowUnknownFields: true}
	if err := u.Unmarshal(bytes.NewReader(raw), out); err != nil {
		return fmt.Errorf("%s: decoding response: %w", path, err)
	}
	return nil
}
