package query

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// ProtocolFeaturesPath is the REST route of the chain's protocol feature
// switches (chain v3.2.4).
const ProtocolFeaturesPath = "/qorechain/pqc/v1/protocol_features"

// ProtocolFeature is one protocol feature switch.
type ProtocolFeature struct {
	Name string
	// Enabled reports whether the switch is on at the current height.
	Enabled bool
	// Known is false for a switch a newer release enabled and this node does
	// not know.
	Known bool
	// Staged reports a switch the node's binary carries but no release has
	// enabled yet.
	Staged bool
}

// ProtocolFeatures is the decoded answer of
// GET {rest}/qorechain/pqc/v1/protocol_features: every switch the node knows,
// at Height.
//
// Each consensus change ships behind a named switch that a governance upgrade
// turns on at its height. Reading the switch tells a client whether the
// network enforces a rule today, without inferring it from upgrade plan names.
// Networks below v3.2.4 do not serve the route (an *HTTPError): use
// IsUpgradeApplied there. FetchProtocolFeatureStatus / ClassifyProtocolFeature
// tell "the node says it cannot say" (fall back to IsUpgradeApplied) apart
// from "the node could not be asked" (an error; do not fall back).
type ProtocolFeatures struct {
	Features []ProtocolFeature
	Height   int64
}

// Enabled reports whether the switch name is on. A switch the answer does not
// list is off.
func (p *ProtocolFeatures) Enabled(name string) bool {
	if p == nil {
		return false
	}
	for _, f := range p.Features {
		if f.Name == name && f.Enabled {
			return true
		}
	}
	return false
}

// GetProtocolFeatures returns the network's protocol feature switches.
func (c *RestClient) GetProtocolFeatures() (*ProtocolFeatures, error) {
	raw, err := c.Get(ProtocolFeaturesPath, nil)
	if err != nil {
		return nil, err
	}
	return ParseProtocolFeatures(raw)
}

// IsProtocolFeatureEnabled reports whether the switch name is on. A switch the
// node does not list is off; an error means the node could not be asked.
func (c *RestClient) IsProtocolFeatureEnabled(name string) (bool, error) {
	p, err := c.GetProtocolFeatures()
	if err != nil {
		return false, err
	}
	return p.Enabled(name), nil
}

// ParseProtocolFeatures decodes a protocol_features response body.
func ParseProtocolFeatures(raw []byte) (*ProtocolFeatures, error) {
	const route = "protocol_features"
	f, err := decodeFields(raw, route)
	if err != nil {
		return nil, err
	}
	list, err := decodeFieldList(f["features"], route, "features")
	if err != nil {
		return nil, err
	}
	r := &fieldReader{f: f, route: route}
	out := &ProtocolFeatures{Height: r.i64("height"), Features: []ProtocolFeature{}}
	for _, x := range list {
		xr := &fieldReader{f: x, route: route}
		out.Features = append(out.Features, ProtocolFeature{
			Name:    xr.str("name"),
			Enabled: xr.boolean("enabled"),
			Known:   xr.boolean("known"),
			Staged:  xr.boolean("staged"),
		})
		r.keep(xr.err)
	}
	if r.err != nil {
		return nil, r.err
	}
	return out, nil
}

// Protocol feature switches the SDK reads to make its automatic choices.
const (
	// FeatureSignBytesV2 moves the hybrid signature to the v2 sign-bytes.
	FeatureSignBytesV2 = "pqc-sign-bytes-v2"
	// FeaturePossessionFlag makes the chain read the proof_of_possession field
	// of MsgRegisterPQCKeyV2.
	FeaturePossessionFlag = "pqc-possession-flag"
)

// FeatureStatus is what a node's protocol_features answer says about one
// switch. The zero value is FeatureStatusUnknown.
type FeatureStatus int

const (
	// FeatureStatusUnknown means the node could not be asked: a transport
	// error, a timeout, a 429, a 5xx other than 501, or a body that is not the
	// expected JSON. It always comes with an error. Never read it as "off" and
	// never fall back to the applied_plan query on it: the answer is unknown.
	FeatureStatusUnknown FeatureStatus = iota
	// FeatureStatusEnabled means the node lists the switch, on.
	FeatureStatusEnabled
	// FeatureStatusDisabled means the node lists the switch, off.
	FeatureStatusDisabled
	// FeatureStatusNotServed means the node answered definitively that it
	// cannot say: the route is not served (HTTP 404, or 501 / body code 12,
	// "Not Implemented"), the list is empty, or the switch is not in it. The
	// caller then decides from the applied_plan query, as before chain v3.2.4.
	FeatureStatusNotServed
)

// String names the status.
func (s FeatureStatus) String() string {
	switch s {
	case FeatureStatusEnabled:
		return "enabled"
	case FeatureStatusDisabled:
		return "disabled"
	case FeatureStatusNotServed:
		return "not-served"
	default:
		return "unknown"
	}
}

// grpcUnimplemented is the gRPC status code a gateway puts in the body of a
// route it does not serve.
const grpcUnimplemented = 12

// ClassifyProtocolFeature reads one switch from a protocol_features HTTP
// answer (status code and body). See FeatureStatus for the cases. An error is
// returned only with FeatureStatusUnknown.
func ClassifyProtocolFeature(status int, body []byte, name string) (FeatureStatus, error) {
	if status < 200 || status >= 300 {
		if status == http.StatusNotFound || status == http.StatusNotImplemented || bodyCode(body) == grpcUnimplemented {
			return FeatureStatusNotServed, nil
		}
		snippet := strings.TrimSpace(string(body))
		if len(snippet) > 200 {
			snippet = snippet[:200]
		}
		return FeatureStatusUnknown, fmt.Errorf("protocol_features: HTTP %d: %s", status, snippet)
	}
	p, err := ParseProtocolFeatures(body)
	if err != nil {
		return FeatureStatusUnknown, err
	}
	for _, f := range p.Features {
		if f.Name == name {
			if f.Enabled {
				return FeatureStatusEnabled, nil
			}
			return FeatureStatusDisabled, nil
		}
	}
	// An empty list, or a list without this switch: the node does not say.
	return FeatureStatusNotServed, nil
}

// bodyCode returns the "code" of a gateway error body, or -1.
func bodyCode(body []byte) int {
	var e struct {
		Code *int `json:"code"`
	}
	if json.Unmarshal(body, &e) != nil || e.Code == nil {
		return -1
	}
	return *e.Code
}

// FetchProtocolFeatureStatus asks the node at restURL about one switch and
// classifies the answer (ClassifyProtocolFeature). A transport error is
// FeatureStatusUnknown with that error. A nil httpClient uses the package's
// default client (30 s timeout).
func FetchProtocolFeatureStatus(ctx context.Context, httpClient *http.Client, restURL, name string) (FeatureStatus, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if httpClient == nil {
		httpClient = defaultHTTPClient
	}
	u := joinURL(strings.TrimRight(strings.TrimSpace(restURL), "/"), ProtocolFeaturesPath)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return FeatureStatusUnknown, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", defaultUserAgent)
	resp, err := httpClient.Do(req)
	if err != nil {
		return FeatureStatusUnknown, fmt.Errorf("protocol_features: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return FeatureStatusUnknown, fmt.Errorf("protocol_features: reading response: %w", err)
	}
	return ClassifyProtocolFeature(resp.StatusCode, body, name)
}

// ProtocolFeatureStatus is FetchProtocolFeatureStatus against this client's
// node.
func (c *RestClient) ProtocolFeatureStatus(name string) (FeatureStatus, error) {
	return FetchProtocolFeatureStatus(context.Background(), c.http, c.baseURL, name)
}
