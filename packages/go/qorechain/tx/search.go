package tx

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// GetTx fetches a single transaction by hash from the REST endpoint and parses
// it into a TxResult. It returns an error if the tx is not found.
func GetTx(restURL, hash string, httpClient *http.Client) (*TxResult, error) {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	u := fmt.Sprintf("%s/cosmos/tx/v1beta1/txs/%s", trimRightSlash(restURL), hash)
	result, found, err := fetchTxResult(u, httpClient)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, fmt.Errorf("tx %s not found", hash)
	}
	return result, nil
}

// GetBlock fetches a block by height from the REST endpoint, returning the raw
// JSON body.
func GetBlock(restURL string, height int64, httpClient *http.Client) (json.RawMessage, error) {
	u := fmt.Sprintf("%s/cosmos/base/tendermint/v1beta1/blocks/%d", trimRightSlash(restURL), height)
	return getJSON(u, httpClient)
}

// GetLatestBlock fetches the latest block from the REST endpoint, returning the
// raw JSON body.
func GetLatestBlock(restURL string, httpClient *http.Client) (json.RawMessage, error) {
	u := trimRightSlash(restURL) + "/cosmos/base/tendermint/v1beta1/blocks/latest"
	return getJSON(u, httpClient)
}

// TxSearchResult is a page of transactions matching a SearchTxs query.
type TxSearchResult struct {
	// Txs are the matched transactions (raw_log/code parsed into TxResult).
	Txs []*TxResult
	// Total is the total number of matches across all pages, when reported.
	Total uint64
	// Raw is the full /cosmos/tx/v1beta1/txs JSON response.
	Raw json.RawMessage
}

// SearchTxs queries the REST tx-search endpoint by event predicates, returning a
// page of results.
//
// events is a list of "key=value" predicates (e.g.
// "message.sender=qor1...", "transfer.recipient=qor1..."). They are combined as
// the chain's `query` parameter joined by " AND ". page is 1-based; limit caps
// the page size.
func SearchTxs(restURL string, events []string, page, limit uint64, httpClient *http.Client) (*TxSearchResult, error) {
	if page == 0 {
		page = 1
	}
	if limit == 0 {
		limit = 100
	}
	query := BuildEventQuery(events)
	if query == "" {
		return nil, fmt.Errorf("at least one event predicate is required")
	}
	q := url.Values{}
	q.Set("query", query)
	q.Set("page", strconv.FormatUint(page, 10))
	q.Set("limit", strconv.FormatUint(limit, 10))
	u := trimRightSlash(restURL) + "/cosmos/tx/v1beta1/txs?" + q.Encode()
	body, err := getJSON(u, httpClient)
	if err != nil {
		return nil, err
	}
	return parseTxSearch(body)
}

// BuildEventQuery joins event predicates into the chain's tx-search query
// string. Each predicate of the form "key=value" gets its value quoted; values
// already quoted are left as-is. Predicates without "=" are passed through
// verbatim (allowing pre-built expressions).
func BuildEventQuery(events []string) string {
	parts := make([]string, 0, len(events))
	for _, e := range events {
		e = strings.TrimSpace(e)
		if e == "" {
			continue
		}
		key, value, ok := strings.Cut(e, "=")
		if !ok {
			parts = append(parts, e)
			continue
		}
		value = strings.TrimSpace(value)
		if !strings.HasPrefix(value, "'") && !strings.HasPrefix(value, "\"") {
			value = "'" + value + "'"
		}
		parts = append(parts, strings.TrimSpace(key)+"="+value)
	}
	return strings.Join(parts, " AND ")
}

func parseTxSearch(body []byte) (*TxSearchResult, error) {
	var resp struct {
		TxResponses []json.RawMessage `json:"tx_responses"`
		Total       string            `json:"total"`
		Pagination  struct {
			Total string `json:"total"`
		} `json:"pagination"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("parse tx search: %w", err)
	}
	out := &TxSearchResult{Raw: json.RawMessage(body)}
	for _, raw := range resp.TxResponses {
		// Each entry is a TxResponse object; wrap it so parseTxResponse can read
		// the "tx_response" envelope it expects.
		wrapped := append(append([]byte(`{"tx_response":`), raw...), '}')
		result, err := parseTxResponse(wrapped)
		if err != nil {
			return nil, err
		}
		out.Txs = append(out.Txs, result)
	}
	total := resp.Total
	if total == "" {
		total = resp.Pagination.Total
	}
	if total != "" {
		out.Total, _ = strconv.ParseUint(total, 10, 64)
	}
	return out, nil
}

// --- small shared HTTP helpers ---

func getJSON(u string, httpClient *http.Client) (json.RawMessage, error) {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	resp, err := httpClient.Get(u)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := readAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("GET HTTP %d for %s: %s", resp.StatusCode, u, string(body))
	}
	return json.RawMessage(body), nil
}

func trimRightSlash(s string) string { return strings.TrimRight(s, "/") }

func readAll(r io.Reader) ([]byte, error) { return io.ReadAll(r) }

func containsNotFound(body []byte) bool {
	return strings.Contains(strings.ToLower(string(body)), "not found")
}
