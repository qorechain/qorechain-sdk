package query

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
)

// JSONRPCError is returned when a JSON-RPC response carries an error member.
type JSONRPCError struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func (e *JSONRPCError) Error() string {
	return e.Message
}

type jsonrpcRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID      int    `json:"id"`
	Method  string `json:"method"`
	Params  []any  `json:"params"`
}

type jsonrpcResponse struct {
	Result json.RawMessage `json:"result"`
	Error  *JSONRPCError   `json:"error"`
}

// JSONRPCClient is a minimal JSON-RPC 2.0 client over HTTP POST. Request ids
// auto-increment per client.
type JSONRPCClient struct {
	url    string
	http   *http.Client
	mu     sync.Mutex
	nextID int
}

// NewJSONRPCClient creates a JSON-RPC client targeting the given URL. If
// httpClient is nil, http.DefaultClient is used.
func NewJSONRPCClient(rpcURL string, httpClient *http.Client) *JSONRPCClient {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &JSONRPCClient{url: rpcURL, http: httpClient, nextID: 1}
}

// Call invokes a JSON-RPC method and returns its result. It returns a
// *JSONRPCError when the response contains an error member, or an *HTTPError on
// a non-2xx transport response.
func (c *JSONRPCClient) Call(method string, params []any) (json.RawMessage, error) {
	c.mu.Lock()
	id := c.nextID
	c.nextID++
	c.mu.Unlock()

	if params == nil {
		params = []any{}
	}
	reqBody, err := json.Marshal(jsonrpcRequest{JSONRPC: "2.0", ID: id, Method: method, Params: params})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodPost, c.url, bytes.NewReader(reqBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", defaultUserAgent)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, &HTTPError{Status: resp.StatusCode, URL: c.url, Body: string(body)}
	}
	var parsed jsonrpcResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("invalid JSON-RPC response: %w", err)
	}
	if parsed.Error != nil {
		return nil, parsed.Error
	}
	return parsed.Result, nil
}
