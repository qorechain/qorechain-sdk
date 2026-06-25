package tx

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"
)

// Default polling parameters for WaitForTx.
const (
	defaultWaitTimeout = 60 * time.Second
	defaultWaitPoll    = 2 * time.Second
)

// WaitOptions configures WaitForTx polling. Zero values fall back to defaults
// (60s timeout, 2s poll).
type WaitOptions struct {
	Timeout time.Duration
	Poll    time.Duration
}

// TxResult is the confirmed on-chain result of a transaction.
type TxResult struct {
	TxHash    string
	Height    int64
	Code      uint32
	Codespace string
	GasWanted int64
	GasUsed   int64
	RawLog    string
	// Raw is the full /cosmos/tx/v1beta1/txs/{hash} JSON response.
	Raw json.RawMessage
}

// WaitForTx polls the REST tx-by-hash endpoint until the tx is found in a block
// or the timeout elapses. A "not found yet" (HTTP 404 / NotFound) is treated as
// pending and retried; a confirmed tx with a non-zero delivery code is returned
// as a *QoreTxError.
func WaitForTx(restURL, hash string, opts WaitOptions, httpClient *http.Client) (*TxResult, error) {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = defaultWaitTimeout
	}
	poll := opts.Poll
	if poll <= 0 {
		poll = defaultWaitPoll
	}
	deadline := time.Now().Add(timeout)
	u := fmt.Sprintf("%s/cosmos/tx/v1beta1/txs/%s", trimRightSlash(restURL), hash)
	for {
		result, found, err := fetchTxResult(u, httpClient)
		if err != nil {
			return nil, err
		}
		if found {
			if result.Code != 0 {
				txErr := DecodeTxError(result.Code, result.Codespace, result.RawLog)
				txErr.TxHash = result.TxHash
				return result, txErr
			}
			return result, nil
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("timed out after %s waiting for tx %s", timeout, hash)
		}
		time.Sleep(poll)
	}
}

// fetchTxResult fetches a single tx by hash; found is false for a pending
// (not-yet-included) tx.
func fetchTxResult(url string, httpClient *http.Client) (*TxResult, bool, error) {
	resp, err := httpClient.Get(url)
	if err != nil {
		return nil, false, err
	}
	defer resp.Body.Close()
	body, err := readAll(resp.Body)
	if err != nil {
		return nil, false, err
	}
	if resp.StatusCode == http.StatusNotFound {
		return nil, false, nil
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// A NotFound may also be surfaced as a 5xx with a code; treat an explicit
		// "tx not found" body as pending.
		if containsNotFound(body) {
			return nil, false, nil
		}
		return nil, false, fmt.Errorf("get tx HTTP %d for %s: %s", resp.StatusCode, url, string(body))
	}
	result, err := parseTxResponse(body)
	if err != nil {
		return nil, false, err
	}
	if result.TxHash == "" {
		return nil, false, nil
	}
	return result, true, nil
}

// parseTxResponse parses a /cosmos/tx/v1beta1/txs/{hash} JSON body into a
// TxResult.
func parseTxResponse(body []byte) (*TxResult, error) {
	var resp struct {
		TxResponse struct {
			TxHash    string `json:"txhash"`
			Height    string `json:"height"`
			Code      uint32 `json:"code"`
			Codespace string `json:"codespace"`
			GasWanted string `json:"gas_wanted"`
			GasUsed   string `json:"gas_used"`
			RawLog    string `json:"raw_log"`
		} `json:"tx_response"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("parse tx response: %w", err)
	}
	tr := resp.TxResponse
	height, _ := strconv.ParseInt(tr.Height, 10, 64)
	gasWanted, _ := strconv.ParseInt(tr.GasWanted, 10, 64)
	gasUsed, _ := strconv.ParseInt(tr.GasUsed, 10, 64)
	return &TxResult{
		TxHash:    tr.TxHash,
		Height:    height,
		Code:      tr.Code,
		Codespace: tr.Codespace,
		GasWanted: gasWanted,
		GasUsed:   gasUsed,
		RawLog:    tr.RawLog,
		Raw:       json.RawMessage(body),
	}, nil
}

// WithRetry runs fn up to attempts times, sleeping delay between tries, and
// returns the first success or the last error. attempts <= 0 is treated as 1.
func WithRetry(attempts int, delay time.Duration, fn func() error) error {
	if attempts <= 0 {
		attempts = 1
	}
	var lastErr error
	for i := 0; i < attempts; i++ {
		if lastErr = fn(); lastErr == nil {
			return nil
		}
		if i < attempts-1 {
			time.Sleep(delay)
		}
	}
	return lastErr
}
