package tx

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	sdk "github.com/cosmos/cosmos-sdk/types"

	crossvmv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/crossvm/v1"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/query"
)

// ErrCrossVMAsyncFieldUnsupported is wrapped by RequireCrossVMAsyncSupport when
// a MsgCrossVMCall sets async_gas_limit or async_max_factor and the network
// does not read the field yet.
var ErrCrossVMAsyncFieldUnsupported = errors.New("MsgCrossVMCall async field not supported by this network")

// CrossVMAsyncFeatureTTL is how long an "on" answer for a cross-VM async
// switch is trusted, per (REST URL, switch). Only "on" answers are cached.
const CrossVMAsyncFeatureTTL = 60 * time.Second

type crossVMFeatureKey struct{ restURL, feature string }

var (
	crossVMFeatureMu    sync.Mutex
	crossVMFeatureCache = map[crossVMFeatureKey]time.Time{} // value: expiry
	// crossVMFeatureNow is the clock of the cache (tests).
	crossVMFeatureNow = time.Now
)

// ClearCrossVMAsyncFeatureCache forgets every cached switch answer (tests,
// network switches).
func ClearCrossVMAsyncFeatureCache() {
	crossVMFeatureMu.Lock()
	crossVMFeatureCache = map[crossVMFeatureKey]time.Time{}
	crossVMFeatureMu.Unlock()
}

// crossVMAsyncFieldError carries the exact refusal text and matches
// ErrCrossVMAsyncFieldUnsupported with errors.Is.
type crossVMAsyncFieldError struct{ msg string }

func (e *crossVMAsyncFieldError) Error() string { return e.msg }

func (e *crossVMAsyncFieldError) Is(target error) bool {
	return target == ErrCrossVMAsyncFieldUnsupported
}

type crossVMAsyncField struct {
	name    string
	number  int
	feature string
}

var (
	crossVMAsyncGasLimitField  = crossVMAsyncField{"async_gas_limit", 8, query.FeatureCrossVMAsyncGasPriced}
	crossVMAsyncMaxFactorField = crossVMAsyncField{"async_max_factor", 9, query.FeatureCrossVMAsyncEscrow}
)

// RequireCrossVMAsyncSupport refuses, before anything is signed, a
// MsgCrossVMCall field the network at restURL does not read yet. MsgCrossVMCall
// async_gas_limit (field 8) and async_max_factor (field 9) exist from chain
// v3.2.8; an older node refuses the whole transaction with a proto parse
// error that does not name the field.
//
//   - No MsgCrossVMCall in msgs sets either field: nil, with no request.
//   - async_gas_limit != 0 needs the protocol feature switch
//     query.FeatureCrossVMAsyncGasPriced on; async_max_factor != 0 needs
//     query.FeatureCrossVMAsyncEscrow on.
//   - A switch that is listed but off, not listed, or not served (HTTP 404 /
//     501, an empty list) is an error wrapping ErrCrossVMAsyncFieldUnsupported.
//     There is no applied_plan fallback: a node that does not serve the
//     switches is older than v3.2.8.
//   - Any other failure (transport error, timeout, HTTP 429 or 5xx other than
//     501, a body that is not the expected JSON) is a "cannot ask" error.
//   - An empty restURL with either field set is an error: pass a REST URL, or
//     skip the check explicitly (SkipFeatureCheck on the callers).
//
// Only top-level messages are inspected. An "on" answer is cached per
// (restURL, switch) for CrossVMAsyncFeatureTTL. A nil httpClient uses the
// query package's default client.
func RequireCrossVMAsyncSupport(ctx context.Context, restURL string, msgs []sdk.Msg, httpClient *http.Client) error {
	var needed []crossVMAsyncField
	var gas, factor bool
	for _, m := range msgs {
		call, ok := m.(*crossvmv1.MsgCrossVMCall)
		if !ok || call == nil {
			continue
		}
		gas = gas || call.AsyncGasLimit != 0
		factor = factor || call.AsyncMaxFactor != 0
	}
	if gas {
		needed = append(needed, crossVMAsyncGasLimitField)
	}
	if factor {
		needed = append(needed, crossVMAsyncMaxFactorField)
	}
	if len(needed) == 0 {
		return nil
	}
	base := strings.TrimRight(strings.TrimSpace(restURL), "/")
	if base == "" {
		f := needed[0]
		return fmt.Errorf("MsgCrossVMCall %s (field %d) requires chain v3.2.8 and there is no REST URL to check "+
			"switch %s; pass a REST URL, or set SkipFeatureCheck to send it unchecked", f.name, f.number, f.feature)
	}
	for _, f := range needed {
		if err := requireCrossVMSwitch(ctx, base, f, httpClient); err != nil {
			return err
		}
	}
	return nil
}

func requireCrossVMSwitch(ctx context.Context, base string, f crossVMAsyncField, httpClient *http.Client) error {
	key := crossVMFeatureKey{restURL: base, feature: f.feature}
	crossVMFeatureMu.Lock()
	exp, ok := crossVMFeatureCache[key]
	crossVMFeatureMu.Unlock()
	if ok && crossVMFeatureNow().Before(exp) {
		return nil
	}
	st, err := query.FetchProtocolFeatureStatus(ctx, httpClient, base, f.feature)
	switch st {
	case query.FeatureStatusEnabled:
		crossVMFeatureMu.Lock()
		crossVMFeatureCache[key] = crossVMFeatureNow().Add(CrossVMAsyncFeatureTTL)
		crossVMFeatureMu.Unlock()
		return nil
	case query.FeatureStatusDisabled, query.FeatureStatusNotServed:
		return &crossVMAsyncFieldError{msg: fmt.Sprintf("MsgCrossVMCall %s (field %d) requires chain v3.2.8 "+
			"(switch %s is not on at %s); leave it 0 on this network", f.name, f.number, f.feature, base)}
	default:
		if err == nil {
			err = errors.New("protocol_features: no answer")
		}
		return fmt.Errorf("cannot ask %s whether it reads MsgCrossVMCall %s (field %d, switch %s): %v; "+
			"nothing is guessed: retry, leave the field 0, or set SkipFeatureCheck", base, f.name, f.number, f.feature, err)
	}
}
