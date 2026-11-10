package signbytes

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/query"
)

// FeatureV2 is the protocol feature switch that moves a network to the v2
// sign-bytes. The Resolver reads it first, from
// GET {restURL}/qorechain/pqc/v1/protocol_features (chain v3.2.4 and later).
const FeatureV2 = "pqc-sign-bytes-v2"

// DefaultTTL is how long a Resolver trusts a node's answer. It is short on
// purpose: a network can apply one of V2Upgrades while a wallet or service is
// running.
const DefaultTTL = 60 * time.Second

// defaultHTTPTimeout bounds each node query when the Resolver builds its
// own HTTP client.
const defaultHTTPTimeout = 10 * time.Second

// ResolverOptions configures NewResolver. Zero values use the defaults.
type ResolverOptions struct {
	// HTTPClient performs the node queries. Nil uses a client with a 10s
	// timeout.
	HTTPClient *http.Client
	// TTL is how long an answer is cached per (REST URL, chain id). Zero uses
	// DefaultTTL; a negative value disables caching.
	TTL time.Duration
	// Now overrides the clock (tests). Nil uses time.Now.
	Now func() time.Time
}

// Resolver decides the sign-bytes version per network, asking the node (its
// FeatureV2 protocol feature, else whether any of V2Upgrades has been applied)
// when the chain id alone is not enough, and
// caching the answer per (REST URL, chain id) for a short TTL. It is safe for
// concurrent use.
type Resolver struct {
	httpClient *http.Client
	ttl        time.Duration
	now        func() time.Time

	mu    sync.Mutex
	cache map[cacheKey]cacheEntry
}

type cacheKey struct {
	restURL string
	chainID string
}

type cacheEntry struct {
	version Version
	expires time.Time
}

// NewResolver builds a Resolver.
func NewResolver(opts ResolverOptions) *Resolver {
	r := &Resolver{
		httpClient: opts.HTTPClient,
		ttl:        opts.TTL,
		now:        opts.Now,
		cache:      map[cacheKey]cacheEntry{},
	}
	if r.httpClient == nil {
		r.httpClient = &http.Client{Timeout: defaultHTTPTimeout}
	}
	if r.ttl == 0 {
		r.ttl = DefaultTTL
	}
	if r.now == nil {
		r.now = time.Now
	}
	return r
}

// DefaultResolver is the process-wide Resolver used by the package-level
// Resolve / Refresh / ClearCache helpers and by SDK high-level paths that are
// not given a Resolver of their own.
var DefaultResolver = NewResolver(ResolverOptions{})

// Resolve returns the version to sign for chainID.
//
//   - An explicit V1 / V2 is returned as-is, with no network access.
//   - Auto (or ""): a non-legacy chain is V2 with no network access. A legacy
//     chain is first decided by its protocol feature switches,
//     GET {restURL}/qorechain/pqc/v1/protocol_features: V2 when FeatureV2 is
//     listed and enabled, V1 when the node lists its features and FeatureV2 is
//     disabled or absent. This also covers a fresh network that reuses a legacy
//     chain id: it enables every feature at genesis and applies no plan.
//     Only when that query cannot answer (older node, transport error,
//     unexpected or empty payload) is the chain decided by
//     GET {restURL}/cosmos/upgrade/v1beta1/applied_plan/{name} for every name in
//     V2Upgrades, in order, stopping at the first that answers a height greater
//     than zero (V2). A missing height counts as 0; V1 only when every name
//     answers 0. The answer is cached for the TTL.
//
// A legacy chain with an empty restURL, or a failed applied-plan query after
// the features could not answer, returns an error
// wrapping ErrUnresolvedVersion: pass a REST URL or an explicit V1 / V2. The
// Resolver never guesses.
func (r *Resolver) Resolve(ctx context.Context, restURL, chainID string, requested Version) (Version, error) {
	return r.resolve(ctx, restURL, chainID, requested, false)
}

// Refresh is Resolve with the cache bypassed for Auto: the node is always asked
// again (legacy chains) and the cache entry replaced. Use it after the chain
// refused a hybrid signature (IsHybridRejection).
func (r *Resolver) Refresh(ctx context.Context, restURL, chainID string, requested Version) (Version, error) {
	return r.resolve(ctx, restURL, chainID, requested, true)
}

// ClearCache drops every cached answer.
func (r *Resolver) ClearCache() {
	r.mu.Lock()
	r.cache = map[cacheKey]cacheEntry{}
	r.mu.Unlock()
}

func (r *Resolver) resolve(ctx context.Context, restURL, chainID string, requested Version, force bool) (Version, error) {
	if err := requested.Validate(); err != nil {
		return "", err
	}
	if !requested.IsAuto() {
		return requested, nil
	}
	// Guard the argument order. restURL and chainID are adjacent strings, and the
	// other language bindings take (chainID, restURL), so a caller porting code
	// can swap them. Swapped, chainID would hold a URL, which is not a legacy
	// chain, and this would quietly answer V2 - the form mainnet refuses - with
	// no request made and no error raised. Fail loudly instead.
	if strings.Contains(chainID, "://") {
		return "", fmt.Errorf("%w: chainID %q looks like a URL; the argument order here is "+
			"(ctx, restURL, chainID, version)", ErrUnresolvedVersion, chainID)
	}
	if strings.TrimSpace(chainID) == "" {
		return "", fmt.Errorf("%w: chainID is empty; pass the target network's chain id, "+
			"or signbytes.V1 / signbytes.V2 explicitly", ErrUnresolvedVersion)
	}
	if !IsLegacyChain(chainID) {
		return V2, nil
	}
	if u := strings.TrimSpace(restURL); u != "" && !strings.Contains(u, "://") {
		return "", fmt.Errorf("%w: restURL %q is not a URL; the argument order here is "+
			"(ctx, restURL, chainID, version)", ErrUnresolvedVersion, restURL)
	}
	base := strings.TrimRight(strings.TrimSpace(restURL), "/")
	if base == "" {
		return "", fmt.Errorf("%w for chain %q: no REST URL to ask whether upgrade %s is applied; "+
			"pass a REST URL or signbytes.V1 / signbytes.V2 explicitly", ErrUnresolvedVersion, chainID, v2UpgradeNames())
	}
	key := cacheKey{restURL: base, chainID: chainID}
	if !force && r.ttl > 0 {
		r.mu.Lock()
		e, ok := r.cache[key]
		r.mu.Unlock()
		if ok && r.now().Before(e.expires) {
			return e.version, nil
		}
	}
	v, ok := r.featuresVersion(ctx, base)
	if !ok {
		height, err := r.appliedPlanHeight(ctx, base)
		if err != nil {
			return "", fmt.Errorf("%w for chain %q: cannot ask %s whether upgrade %s is applied (%v); "+
				"pass signbytes.V1 or signbytes.V2 explicitly", ErrUnresolvedVersion, chainID, base, v2UpgradeNames(), err)
		}
		v = VersionFor(chainID, height)
	}
	if r.ttl > 0 {
		r.mu.Lock()
		r.cache[key] = cacheEntry{version: v, expires: r.now().Add(r.ttl)}
		r.mu.Unlock()
	}
	return v, nil
}

// featuresVersion reads the node's protocol feature switches. ok is false when
// they cannot answer: the route is not served (below chain v3.2.4), the request
// fails, or the payload is unexpected or lists no features. The caller then
// falls back to the applied-plan query.
func (r *Resolver) featuresVersion(ctx context.Context, base string) (v Version, ok bool) {
	if ctx == nil {
		ctx = context.Background()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+query.ProtocolFeaturesPath, nil)
	if err != nil {
		return "", false
	}
	req.Header.Set("Accept", "application/json")
	resp, err := r.httpClient.Do(req)
	if err != nil {
		return "", false
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil || resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", false
	}
	return VersionFromFeatures(body)
}

// VersionFromFeatures decides the version from a protocol_features response
// body: V2 when FeatureV2 is listed and enabled, V1 when the body lists
// features and FeatureV2 is disabled or absent. ok is false when the body
// cannot be parsed or lists no features.
func VersionFromFeatures(body []byte) (v Version, ok bool) {
	p, err := query.ParseProtocolFeatures(body)
	if err != nil || p == nil || len(p.Features) == 0 {
		return "", false
	}
	if p.Enabled(FeatureV2) {
		return V2, true
	}
	return V1, true
}

// appliedPlanHeight asks the node about EVERY name in V2Upgrades and returns the
// first height greater than zero, or 0 when none of the plans is applied.
//
// The switch to v2 ships under two plan names and each network applies only one
// of them (mainnet "v3.2.0", the testnet already "v3.1.98"), so asking a single
// name answers height 0 on the other network and would resolve v1 there - the
// form it refuses with pqc code 21. Names are ordered most likely first and the
// loop short-circuits: a network that took the first name costs one request.
// A failed query is returned as an error, never treated as "not applied".
func (r *Resolver) appliedPlanHeight(ctx context.Context, base string) (int64, error) {
	for _, name := range V2Upgrades {
		h, err := r.appliedPlanHeightFor(ctx, base, name)
		if err != nil {
			return 0, fmt.Errorf("plan %s: %w", name, err)
		}
		if h > 0 {
			return h, nil
		}
	}
	return 0, nil
}

// appliedPlanHeightFor queries the applied-plan endpoint for one plan name and
// returns the height (0 when that plan is not applied or the field is absent).
func (r *Resolver) appliedPlanHeightFor(ctx context.Context, base, name string) (int64, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	u := base + "/cosmos/upgrade/v1beta1/applied_plan/" + name
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := r.httpClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if err != nil {
		return 0, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return 0, fmt.Errorf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return parseAppliedPlanHeight(body)
}

// parseAppliedPlanHeight reads {"height":"<n>"} (a JSON number is tolerated; a
// missing or null height is 0).
func parseAppliedPlanHeight(body []byte) (int64, error) {
	var resp struct {
		Height json.RawMessage `json:"height"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return 0, fmt.Errorf("parse applied_plan response: %w", err)
	}
	s := strings.Trim(strings.TrimSpace(string(resp.Height)), `"`)
	if s == "" || s == "null" {
		return 0, nil
	}
	h, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("parse applied_plan height %q: %w", s, err)
	}
	if h < 0 {
		return 0, fmt.Errorf("applied_plan height is negative: %d", h)
	}
	return h, nil
}

// Resolve calls DefaultResolver.Resolve.
func Resolve(ctx context.Context, restURL, chainID string, requested Version) (Version, error) {
	return DefaultResolver.Resolve(ctx, restURL, chainID, requested)
}

// Refresh calls DefaultResolver.Refresh.
func Refresh(ctx context.Context, restURL, chainID string, requested Version) (Version, error) {
	return DefaultResolver.Refresh(ctx, restURL, chainID, requested)
}

// ClearCache calls DefaultResolver.ClearCache.
func ClearCache() { DefaultResolver.ClearCache() }
