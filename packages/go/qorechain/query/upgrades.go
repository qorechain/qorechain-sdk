package query

import (
	"encoding/json"
	"fmt"
	"net/url"
	"sync"
	"time"
)

// ChainUpgradeV3_2_2 is the plan that brings EIP-7702 delegation consent, the
// measured EVM spending policy, the ecdsa_pubkey check on PQC registration and
// the new bridge, multilayer and RDK messages. Plan names are the same on every
// network.
const ChainUpgradeV3_2_2 = "v3.2.2"

// ChainUpgradeV3_2_3 is the plan that brings PQC registration integrity and
// proof_of_possession, hybrid-only key maintenance for keyed accounts, the EVM
// window scope (native_only, allowed_targets), the abstract-account v2 digest
// and MsgUpdateAuthority.
const ChainUpgradeV3_2_3 = "v3.2.3"

// A release adds message fields, and a node below it does not know them: the
// transaction decoder refuses a message carrying an unknown field, so setting
// a release's new OPTIONAL field before the upgrade gets the whole transaction
// refused. Set such fields only after the network has applied the release.
// The chain has no query for protocol features, but each release switches them
// on at its plan height, which the upgrade module reports.

// notAppliedTTL is how long a "not applied yet" answer is trusted. An applied
// plan stays applied and is cached for the life of the process.
const notAppliedTTL = time.Minute

var upgradeCache sync.Map // key: restURL|plan -> upgradeAnswer

type upgradeAnswer struct {
	height uint64
	at     time.Time
}

// AppliedPlanPath is the REST route of the applied_plan query.
func AppliedPlanPath(plan string) string {
	return "/cosmos/upgrade/v1beta1/applied_plan/" + url.PathEscape(plan)
}

// UpgradeAppliedHeight returns the height at which plan was applied, or 0 if it
// has not been. An error means the node could not be asked: never read it as
// "not applied", which sends the wrong wire format to the network.
func (c *RestClient) UpgradeAppliedHeight(plan string) (uint64, error) {
	key := c.baseURL + "|" + plan
	if v, ok := upgradeCache.Load(key); ok {
		a := v.(upgradeAnswer)
		if a.height > 0 || time.Since(a.at) < notAppliedTTL {
			return a.height, nil
		}
	}
	raw, err := c.Get(AppliedPlanPath(plan), nil)
	if err != nil {
		return 0, err
	}
	var body struct {
		Height json.RawMessage `json:"height"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return 0, fmt.Errorf("applied_plan: decoding response: %w", err)
	}
	// Mainnet answers {"height":"0"} for a plan it has not applied: parse the
	// number, never test the field for presence.
	h, err := windowUint(body.Height, "height")
	if err != nil {
		return 0, err
	}
	upgradeCache.Store(key, upgradeAnswer{height: h, at: time.Now()})
	return h, nil
}

// IsUpgradeApplied reports whether the network has applied plan.
func (c *RestClient) IsUpgradeApplied(plan string) (bool, error) {
	h, err := c.UpgradeAppliedHeight(plan)
	return h > 0, err
}

// RequireUpgradeApplied refuses to set what (a release's new fields) on a
// network that has not applied plan.
func (c *RestClient) RequireUpgradeApplied(plan, what string) error {
	ok, err := c.IsUpgradeApplied(plan)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("%s needs chain %s, which this network has not applied yet; a node below %s refuses the whole transaction when the field is set, so leave it unset until the upgrade", what, plan, plan)
	}
	return nil
}

// ClearUpgradeCache forgets cached answers (tests, network switches).
func ClearUpgradeCache() {
	upgradeCache.Range(func(k, _ any) bool { upgradeCache.Delete(k); return true })
}
