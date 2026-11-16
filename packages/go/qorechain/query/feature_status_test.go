package query

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

const featureListBody = `{"features":[` +
	`{"name":"pqc-sign-bytes-v2","enabled":true,"known":true,"staged":false},` +
	`{"name":"pqc-possession-flag","enabled":false,"known":true,"staged":false}` +
	`],"height":"9"}`

func TestClassifyProtocolFeature(t *testing.T) {
	cases := []struct {
		name    string
		status  int
		body    string
		feature string
		want    FeatureStatus
		wantErr bool
	}{
		{"enabled", 200, featureListBody, FeatureSignBytesV2, FeatureStatusEnabled, false},
		{"disabled", 200, featureListBody, FeaturePossessionFlag, FeatureStatusDisabled, false},
		{"absent", 200, featureListBody, "other", FeatureStatusNotServed, false},
		{"empty list", 200, `{"features":[],"height":"1"}`, FeatureSignBytesV2, FeatureStatusNotServed, false},
		{"no list", 200, `{}`, FeatureSignBytesV2, FeatureStatusNotServed, false},
		{"404", 404, `{"code":5,"message":"Not Found"}`, FeatureSignBytesV2, FeatureStatusNotServed, false},
		{"501", 501, `{"code":12,"message":"Not Implemented","details":[]}`, FeatureSignBytesV2, FeatureStatusNotServed, false},
		{"code 12 body", 400, `{"code":12,"message":"Not Implemented"}`, FeatureSignBytesV2, FeatureStatusNotServed, false},
		{"500", 500, `{"code":13}`, FeatureSignBytesV2, FeatureStatusUnknown, true},
		{"502", 502, `bad gateway`, FeatureSignBytesV2, FeatureStatusUnknown, true},
		{"429", 429, `slow down`, FeatureSignBytesV2, FeatureStatusUnknown, true},
		{"unparsable", 200, `<html>`, FeatureSignBytesV2, FeatureStatusUnknown, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := ClassifyProtocolFeature(c.status, []byte(c.body), c.feature)
			if got != c.want || (err != nil) != c.wantErr {
				t.Fatalf("got %s, %v; want %s, error %v", got, err, c.want, c.wantErr)
			}
		})
	}
}

func TestFetchProtocolFeatureStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != ProtocolFeaturesPath {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(featureListBody))
	}))
	defer srv.Close()
	st, err := FetchProtocolFeatureStatus(context.Background(), srv.Client(), srv.URL+"/", FeatureSignBytesV2)
	if err != nil || st != FeatureStatusEnabled {
		t.Fatalf("got %s, %v", st, err)
	}
	if st, err := NewRestClient(srv.URL, srv.Client()).ProtocolFeatureStatus(FeaturePossessionFlag); err != nil || st != FeatureStatusDisabled {
		t.Fatalf("got %s, %v", st, err)
	}
}

func TestFetchProtocolFeatureStatusConnectionRefused(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	_ = ln.Close()
	st, err := FetchProtocolFeatureStatus(context.Background(), nil, "http://"+addr, FeatureSignBytesV2)
	if st != FeatureStatusUnknown || err == nil {
		t.Fatalf("got %s, %v; want unknown with an error", st, err)
	}
}
