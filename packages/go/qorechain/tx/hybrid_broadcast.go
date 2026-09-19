package tx

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/signbytes"
)

// BroadcastHybridParams are the inputs to BroadcastHybridAndWait.
type BroadcastHybridParams struct {
	// Build describes the hybrid tx. Build.SignBytesVersion may be empty /
	// signbytes.Auto (the default here: resolved per network against RestURL)
	// or an explicit signbytes.V1 / signbytes.V2 (used as-is, never retried).
	Build BuildHybridMessagesParams
	// RestURL is the REST (LCD) base URL used both to resolve the sign-bytes
	// version and to broadcast.
	RestURL string
	// Mode is the broadcast mode (empty = BroadcastSync).
	Mode BroadcastMode
	// Wait configures post-broadcast polling (zero values use the defaults).
	Wait WaitOptions
	// HTTPClient is an optional injected client for broadcast + polling.
	HTTPClient *http.Client
	// Resolver decides the sign-bytes version for Auto. Nil uses
	// signbytes.DefaultResolver.
	Resolver *signbytes.Resolver
	// Context bounds the version query. Nil uses context.Background().
	Context context.Context
}

// HybridBroadcastResult reports BroadcastHybridAndWait's outcome.
type HybridBroadcastResult struct {
	// Result is the confirmed tx result.
	Result *TxResult
	// Built is the tx that was accepted (after a retry, the re-signed one). Its
	// SignBytesVersion is the form that was used.
	Built *BuiltTx
	// Retried is true when the first attempt was refused as a hybrid-signature
	// failure and the tx was re-signed under a freshly resolved version.
	Retried bool
}

// BroadcastHybridAndWait resolves the hybrid sign-bytes version for the target
// network, builds and signs the hybrid tx, broadcasts it and waits for
// inclusion.
//
// Retry rule: when the version was Auto and the chain refuses the tx with the
// hybrid-signature failure (codespace "pqc" code 21, or a log containing
// "hybrid PQC signature verification failed"; see IsHybridSignBytesRejection),
// the resolver is force-refreshed and, if it now names a different version, the
// tx is re-signed and broadcast exactly once more; any error from that second
// attempt is returned. An explicit V1 / V2 is never retried, and code 21 from
// any other codespace is not treated as this case.
//
// On error, the returned result (when non-nil) still carries the last BuiltTx.
func BroadcastHybridAndWait(params BroadcastHybridParams) (*HybridBroadcastResult, error) {
	ctx := params.Context
	if ctx == nil {
		ctx = context.Background()
	}
	resolver := params.Resolver
	if resolver == nil {
		resolver = signbytes.DefaultResolver
	}
	requested := params.Build.SignBytesVersion
	chainID := params.Build.ChainID

	version, err := resolver.Resolve(ctx, params.RestURL, chainID, requested)
	if err != nil {
		return nil, err
	}
	res, built, err := buildAndBroadcastHybrid(params, version)
	if err == nil || !requested.IsAuto() || !IsHybridSignBytesRejection(err) {
		return &HybridBroadcastResult{Result: res, Built: built}, err
	}

	// Refused as a hybrid-signature failure under an auto-resolved version:
	// the network may have just switched form. Ask again, bypassing the cache.
	fresh, rerr := resolver.Refresh(ctx, params.RestURL, chainID, requested)
	if rerr != nil {
		return &HybridBroadcastResult{Result: res, Built: built},
			fmt.Errorf("%w (re-resolving the sign-bytes version also failed: %v)", err, rerr)
	}
	if fresh == version {
		// The node still names the form we signed; re-signing would produce
		// the same refusal. Surface the original error.
		return &HybridBroadcastResult{Result: res, Built: built}, err
	}
	res, built, err = buildAndBroadcastHybrid(params, fresh)
	return &HybridBroadcastResult{Result: res, Built: built, Retried: true}, err
}

func buildAndBroadcastHybrid(params BroadcastHybridParams, version signbytes.Version) (*TxResult, *BuiltTx, error) {
	b := params.Build
	b.SignBytesVersion = version
	built, err := BuildHybridMessages(b)
	if err != nil {
		return nil, nil, err
	}
	mode := params.Mode
	if mode == "" {
		mode = BroadcastSync
	}
	res, err := BroadcastAndWait(BroadcastAndWaitParams{
		RestURL:    params.RestURL,
		TxBytes:    built.TxRawBytes,
		Mode:       mode,
		Wait:       params.Wait,
		HTTPClient: params.HTTPClient,
	})
	return res, built, err
}

// IsHybridSignBytesRejection reports whether err is the chain refusing a hybrid
// PQC signature: a *QoreTxError with codespace "pqc" and code 21, or any error
// whose log / message contains "hybrid PQC signature verification failed".
// Code 21 in another codespace (e.g. "sdk" tx too large) is not a match.
func IsHybridSignBytesRejection(err error) bool {
	if err == nil {
		return false
	}
	var txErr *QoreTxError
	if errors.As(err, &txErr) {
		if signbytes.IsHybridRejection(txErr.Codespace, txErr.Code, txErr.RawLog) {
			return true
		}
	}
	return strings.Contains(err.Error(), signbytes.HybridRejectionMessage)
}
