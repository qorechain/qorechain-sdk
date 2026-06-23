// Package query provides REST (LCD) and JSON-RPC read clients for QoreChain.
//
// RestClient wraps the standard Cosmos SDK bank endpoints plus QoreChain's
// custom module read routes under /qorechain/<module>/v1/.... JSONRPCClient is
// a generic JSON-RPC 2.0 transport, and QorClient layers the typed qor_*
// namespace on top of it. All HTTP is performed through an injectable
// *http.Client so tests can use httptest without real network access.
package query

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

const defaultUserAgent = "qorechain-go-sdk"

// HTTPError is returned when an HTTP response has a non-2xx status.
type HTTPError struct {
	Status int
	URL    string
	Body   string
}

func (e *HTTPError) Error() string {
	return fmt.Sprintf("HTTP %d for %s", e.Status, e.URL)
}

// RestClient is a Cosmos + QoreChain REST read client. The zero value is not
// usable; construct it with NewRestClient.
type RestClient struct {
	baseURL string
	http    *http.Client
}

// NewRestClient creates a RestClient for the given base URL. If httpClient is
// nil, http.DefaultClient is used.
func NewRestClient(baseURL string, httpClient *http.Client) *RestClient {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &RestClient{baseURL: strings.TrimRight(baseURL, "/"), http: httpClient}
}

func joinURL(base, path string) string {
	return base + "/" + strings.TrimLeft(path, "/")
}

// Get is the generic GET escape hatch for any documented REST route. The
// parsed JSON body is unmarshalled into a json.RawMessage.
func (c *RestClient) Get(path string, query map[string]string) (json.RawMessage, error) {
	u := joinURL(c.baseURL, path)
	if len(query) > 0 {
		vals := url.Values{}
		for k, v := range query {
			if v != "" {
				vals.Set(k, v)
			}
		}
		if enc := vals.Encode(); enc != "" {
			u += "?" + enc
		}
	}
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
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
		return nil, &HTTPError{Status: resp.StatusCode, URL: u, Body: string(body)}
	}
	return json.RawMessage(body), nil
}

// GetAllBalances returns all balances for a Cosmos account.
func (c *RestClient) GetAllBalances(address string) (json.RawMessage, error) {
	return c.Get("/cosmos/bank/v1beta1/balances/"+url.PathEscape(address), nil)
}

// GetAIStats returns the AI engine statistics.
func (c *RestClient) GetAIStats() (json.RawMessage, error) {
	return c.Get("/qorechain/ai/v1/stats", nil)
}

// GetFeeEstimate returns an AI-assisted fee estimate for the given urgency
// ("fast", "normal", "slow").
func (c *RestClient) GetFeeEstimate(urgency string) (json.RawMessage, error) {
	return c.Get("/qorechain/ai/v1/fee-estimate", map[string]string{"urgency": urgency})
}

// GetBridgeChains returns the supported bridge chains.
func (c *RestClient) GetBridgeChains() (json.RawMessage, error) {
	return c.Get("/qorechain/bridge/v1/chains", nil)
}

// GetPQCAccount returns the PQC account record for an address.
func (c *RestClient) GetPQCAccount(address string) (json.RawMessage, error) {
	return c.Get("/qorechain/pqc/v1/accounts/"+url.PathEscape(address), nil)
}

// GetReputation returns the reputation record for a validator address.
func (c *RestClient) GetReputation(validatorAddress string) (json.RawMessage, error) {
	return c.Get("/qorechain/reputation/v1/validators/"+url.PathEscape(validatorAddress), nil)
}

// GetBurnStats returns the token burn statistics.
func (c *RestClient) GetBurnStats() (json.RawMessage, error) {
	return c.Get("/qorechain/burn/v1/stats", nil)
}

// GetXQOREPosition returns the xQORE position for an address.
func (c *RestClient) GetXQOREPosition(address string) (json.RawMessage, error) {
	return c.Get("/qorechain/xqore/v1/position/"+url.PathEscape(address), nil)
}

// GetInflationRate returns the current inflation rate.
func (c *RestClient) GetInflationRate() (json.RawMessage, error) {
	return c.Get("/qorechain/inflation/v1/rate", nil)
}
