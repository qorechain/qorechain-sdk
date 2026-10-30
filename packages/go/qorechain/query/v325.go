package query

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"net/url"

	"github.com/cosmos/gogoproto/jsonpb"
	"github.com/cosmos/gogoproto/proto"

	abstractaccountv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/abstractaccount/v1"
	crossvmv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/crossvm/v1"
)

// Reads added by chain v3.2.5 (ChainUpgradeV3_2_5). A node below v3.2.5 does
// not serve these routes.

// KEMKeyPath is the REST route of an address's published KEM key. address is
// bech32 (qor1...) or 0x hex.
func KEMKeyPath(address string) string {
	return "/qorechain/pqc/v1/kem/" + url.PathEscape(address)
}

// KEMKey is a published key-encapsulation public key.
type KEMKey struct {
	// Address is the bech32 account that published the key.
	Address string
	// AlgorithmID is the registry id (2 = ML-KEM-1024).
	AlgorithmID uint32
	// AlgorithmName is the registry name (for example "mlkem1024").
	AlgorithmName string
	// PublicKey is the raw encapsulation key (1568 bytes for ML-KEM-1024).
	PublicKey []byte
	// RegisteredHeight is the height of the registration that published this
	// key (a replacement resets it).
	RegisteredHeight int64
}

// KEMKeyResult is the decoded answer of GET /qorechain/pqc/v1/kem/{address}.
type KEMKeyResult struct {
	// Found reports whether the address has published a KEM key.
	Found bool
	// Key is nil when Found is false.
	Key *KEMKey
}

// GetKEMKey returns the KEM key address published, if any.
func (c *RestClient) GetKEMKey(address string) (*KEMKeyResult, error) {
	raw, err := c.Get(KEMKeyPath(address), nil)
	if err != nil {
		return nil, err
	}
	return ParseKEMKey(raw)
}

// ParseKEMKey decodes a KEM key response body.
func ParseKEMKey(raw []byte) (*KEMKeyResult, error) {
	const route = "pqc kem key"
	f, err := decodeFields(raw, route)
	if err != nil {
		return nil, err
	}
	r := &fieldReader{f: f, route: route}
	out := &KEMKeyResult{Found: r.boolean("found")}
	if r.err != nil {
		return nil, r.err
	}
	key := f["key"]
	if !out.Found || len(key) == 0 || string(key) == "null" {
		return out, nil
	}
	kf, err := decodeFields(key, route)
	if err != nil {
		return nil, err
	}
	kr := &fieldReader{f: kf, route: route}
	k := &KEMKey{
		Address:          kr.str("address"),
		AlgorithmID:      kr.u32("algorithm_id"),
		AlgorithmName:    kr.str("algorithm_name"),
		RegisteredHeight: kr.i64("registered_height"),
	}
	pub := kr.str("public_key")
	if kr.err != nil {
		return nil, kr.err
	}
	if k.PublicKey, err = base64.StdEncoding.DecodeString(pub); err != nil {
		return nil, fmt.Errorf("%s: field public_key is not base64: %w", route, err)
	}
	out.Key = k
	return out, nil
}

// SpendingRulesPath and AuthenticatorsPath are the abstractaccount REST
// routes for one account's stored spending rules and linked keys.
func SpendingRulesPath(address string) string {
	return "/qorechain/abstractaccount/v1/accounts/" + url.PathEscape(address) + "/spending_rules"
}

// AuthenticatorsPath is the REST route for an account's linked keys.
func AuthenticatorsPath(address string) string {
	return "/qorechain/abstractaccount/v1/accounts/" + url.PathEscape(address) + "/authenticators"
}

// CrossVMParamsPath is the crossvm parameters route (served over REST from
// v3.2.5; /pending and /message/{id} too).
const CrossVMParamsPath = "/qorechain/crossvm/v1/params"

// GetSpendingRules returns the spending rules stored for an abstract account:
// the account-wide rules and the rule of every linked key that carries its
// own. An account that does not exist is an *HTTPError (code 5).
func (c *RestClient) GetSpendingRules(address string) (*abstractaccountv1.QuerySpendingRulesResponse, error) {
	out := &abstractaccountv1.QuerySpendingRulesResponse{}
	return out, c.getProto(SpendingRulesPath(address), out)
}

// GetAuthenticators returns the keys linked to an abstract account, revoked
// ones included, with their permissions and expiry.
func (c *RestClient) GetAuthenticators(address string) (*abstractaccountv1.QueryAuthenticatorsResponse, error) {
	out := &abstractaccountv1.QueryAuthenticatorsResponse{}
	return out, c.getProto(AuthenticatorsPath(address), out)
}

// GetCrossVMParams returns the crossvm parameters, among them the EVM bridge
// precompile's allowlist (BridgeAllowedTargets, from v3.2.5).
func (c *RestClient) GetCrossVMParams() (*crossvmv1.QueryParamsResponse, error) {
	out := &crossvmv1.QueryParamsResponse{}
	return out, c.getProto(CrossVMParamsPath, out)
}

// getProto GETs path and decodes the JSON answer into a generated message
// (field names as the chain spells them; unknown fields are ignored so a
// newer node does not break an older client).
func (c *RestClient) getProto(path string, out proto.Message) error {
	raw, err := c.Get(path, nil)
	if err != nil {
		return err
	}
	u := jsonpb.Unmarshaler{AllowUnknownFields: true}
	if err := u.Unmarshal(bytes.NewReader(raw), out); err != nil {
		return fmt.Errorf("%s: decoding response: %w", path, err)
	}
	return nil
}
