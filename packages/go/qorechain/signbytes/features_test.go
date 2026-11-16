package signbytes

import (
	"context"
	"errors"
	"net"
	"net/http"
	"testing"
	"time"
)

// Every way the protocol_features answer can go, against a legacy chain whose
// applied plan says v2. Only a definitive "cannot say" may reach applied_plan;
// a node that could not be asked is an error with no applied_plan request.
func TestResolverProtocolFeatureCases(t *testing.T) {
	cases := []struct {
		name      string
		status    int
		body      string
		want      Version
		wantErr   bool
		planAsked bool
	}{
		{"enabled", http.StatusOK, featuresBody(featureOther, featureV2On), V2, false, false},
		{"disabled", http.StatusOK, featuresBody(featureV2Off), V1, false, false},
		{"absent falls back", http.StatusOK, featuresBody(featureOther), V2, false, true},
		{"404 falls back", 0, "", V2, false, true},
		{"501 falls back", http.StatusNotImplemented, `{"code":12,"message":"Not Implemented","details":[]}`, V2, false, true},
		{"empty list falls back", http.StatusOK, `{"features":[],"height":"1"}`, V2, false, true},
		{"500 is an error", http.StatusInternalServerError, `{"code":13,"message":"internal"}`, "", true, false},
		{"503 is an error", http.StatusServiceUnavailable, `busy`, "", true, false},
		{"429 is an error", http.StatusTooManyRequests, `slow down`, "", true, false},
		{"unparsable is an error", http.StatusOK, `<html>`, "", true, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ps := newLegacyPlanServer(t, `{"height":"5746000"}`)
			ps.setFeatures(c.status, c.body)
			r := NewResolver(ResolverOptions{})
			got, err := r.Resolve(context.Background(), ps.URL, "qorechain-diana", Auto)
			if c.wantErr {
				if err == nil || !errors.Is(err, ErrUnresolvedVersion) {
					t.Fatalf("got %q, %v; want an ErrUnresolvedVersion error", got, err)
				}
			} else if err != nil || got != c.want {
				t.Fatalf("got %q, %v; want %s", got, err, c.want)
			}
			if n := ps.featureRequests.Load(); n != 1 {
				t.Fatalf("feature requests = %d, want 1", n)
			}
			if asked := ps.requests.Load() > 0; asked != c.planAsked {
				t.Fatalf("applied_plan asked = %v, want %v", asked, c.planAsked)
			}
			if c.wantErr {
				// Errors are not cached: the next call asks again.
				_, _ = r.Resolve(context.Background(), ps.URL, "qorechain-diana", Auto)
				if n := ps.featureRequests.Load(); n != 2 {
					t.Fatalf("feature requests after an error = %d, want 2 (errors are not cached)", n)
				}
			}
		})
	}
}

func TestResolverConnectionRefusedIsAnError(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	_ = ln.Close()
	r := NewResolver(ResolverOptions{HTTPClient: &http.Client{Timeout: 2 * time.Second}})
	got, err := r.Resolve(context.Background(), "http://"+addr, "qorechain-vladi", Auto)
	if err == nil || !errors.Is(err, ErrUnresolvedVersion) {
		t.Fatalf("got %q, %v; want an ErrUnresolvedVersion error", got, err)
	}
}

func TestResolverExplicitVersionMakesNoRequest(t *testing.T) {
	for _, v := range []Version{V1, V2} {
		ps := newLegacyPlanServer(t, `{"height":"5746000"}`)
		ps.setFeatures(http.StatusInternalServerError, `down`)
		got, err := NewResolver(ResolverOptions{}).Resolve(context.Background(), ps.URL, "qorechain-diana", v)
		if err != nil || got != v {
			t.Fatalf("got %q, %v; want %s", got, err, v)
		}
		if n := ps.featureRequests.Load() + ps.requests.Load(); n != 0 {
			t.Fatalf("requests = %d, want 0", n)
		}
	}
}

func TestResolverFeatureAnswerCachedWithinTTL(t *testing.T) {
	ps := newLegacyPlanServer(t, `{"height":"0"}`)
	ps.setFeatures(http.StatusOK, featuresBody(featureV2On))
	now := time.Unix(1_700_000_000, 0)
	r := NewResolver(ResolverOptions{Now: func() time.Time { return now }})
	ctx := context.Background()
	if v, err := r.Resolve(ctx, ps.URL, "qorechain-diana", Auto); err != nil || v != V2 {
		t.Fatalf("first = %s, %v", v, err)
	}
	// Within the TTL a node outage does not fail the next transaction.
	ps.setFeatures(http.StatusInternalServerError, `down`)
	now = now.Add(DefaultTTL - time.Second)
	if v, err := r.Resolve(ctx, ps.URL, "qorechain-diana", Auto); err != nil || v != V2 {
		t.Fatalf("cached = %s, %v", v, err)
	}
	if n := ps.featureRequests.Load(); n != 1 {
		t.Fatalf("feature requests = %d, want 1 (cached)", n)
	}
	// After the TTL the node is asked again, and its failure is an error.
	now = now.Add(2 * time.Second)
	if _, err := r.Resolve(ctx, ps.URL, "qorechain-diana", Auto); err == nil {
		t.Fatal("expected an error once the cached answer expired and the node is down")
	}
	if n := ps.featureRequests.Load(); n != 2 {
		t.Fatalf("feature requests = %d, want 2", n)
	}
}
