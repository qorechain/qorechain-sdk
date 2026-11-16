package pqcdx

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/query"
)

// PossessionTTL is how long a network's "attach a proof of possession or not"
// answer is trusted, per (REST URL, chain id). Short on purpose: a network can
// switch the feature on while a wallet or service is running. Only answers
// are cached, never errors.
const PossessionTTL = 60 * time.Second

type possessionKey struct{ restURL, chainID string }

type possessionEntry struct {
	attach  bool
	expires time.Time
}

var (
	possessionMu    sync.Mutex
	possessionCache = map[possessionKey]possessionEntry{}
	// possessionNow is the clock of the cache (tests).
	possessionNow = time.Now
	// possessionHTTP is the client of the features and applied_plan queries;
	// nil uses the query package's default client.
	possessionHTTP *http.Client
)

// ClearProofOfPossessionCache forgets every cached "attach a proof" answer
// (tests, network switches).
func ClearProofOfPossessionCache() {
	possessionMu.Lock()
	possessionCache = map[possessionKey]possessionEntry{}
	possessionMu.Unlock()
}

// ProofOfPossessionWanted reports whether a MsgRegisterPQCKeyV2 sent to the
// network at restURL should carry a proof of possession.
//
//   - The chain's protocol feature switch query.FeaturePossessionFlag decides
//     first: listed and enabled, attach the proof; listed and disabled, do not.
//   - When the node answers definitively that the switches cannot say (HTTP
//     404, HTTP 501 / gateway code 12, an empty list, or the switch not
//     listed), the answer is whether the network applied
//     query.ChainUpgradeV3_2_3, as before chain v3.2.4.
//   - Any other failure (transport error, timeout, HTTP 429 or 5xx other than
//     501, a body that is not the expected JSON) is an error: the network
//     could not be asked, and neither answer is guessed, because a node that
//     does not know the field refuses the whole transaction when it is set.
//
// A successful answer is cached per (restURL, chainID) for PossessionTTL.
func ProofOfPossessionWanted(ctx context.Context, restURL, chainID string) (bool, error) {
	base := strings.TrimRight(strings.TrimSpace(restURL), "/")
	if base == "" {
		return false, fmt.Errorf("pqcdx: no REST URL to ask whether the network reads a proof of possession; " +
			"pass RegisterOptions.ProofOfPossession or set RegisterOptions.SkipProofOfPossession")
	}
	key := possessionKey{restURL: base, chainID: chainID}
	possessionMu.Lock()
	e, ok := possessionCache[key]
	possessionMu.Unlock()
	if ok && possessionNow().Before(e.expires) {
		return e.attach, nil
	}
	st, err := query.FetchProtocolFeatureStatus(ctx, possessionHTTP, base, query.FeaturePossessionFlag)
	var attach bool
	switch st {
	case query.FeatureStatusEnabled:
		attach = true
	case query.FeatureStatusDisabled:
		attach = false
	case query.FeatureStatusNotServed:
		applied, err := query.NewRestClient(base, possessionHTTP).IsUpgradeApplied(query.ChainUpgradeV3_2_3)
		if err != nil {
			return false, fmt.Errorf("pqcdx: cannot tell whether the network at %s applied %s: %w; "+
				"pass RegisterOptions.ProofOfPossession or set RegisterOptions.SkipProofOfPossession",
				base, query.ChainUpgradeV3_2_3, err)
		}
		attach = applied
	default:
		if err == nil {
			err = fmt.Errorf("protocol_features: no answer")
		}
		return false, fmt.Errorf("pqcdx: the network at %s could not be asked whether it reads a proof of "+
			"possession (%v); nothing is guessed: retry, or pass RegisterOptions.ProofOfPossession or set "+
			"RegisterOptions.SkipProofOfPossession", base, err)
	}
	possessionMu.Lock()
	possessionCache[key] = possessionEntry{attach: attach, expires: possessionNow().Add(PossessionTTL)}
	possessionMu.Unlock()
	return attach, nil
}
