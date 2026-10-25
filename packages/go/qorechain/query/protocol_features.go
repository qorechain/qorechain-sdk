package query

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
// IsUpgradeApplied there.
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
