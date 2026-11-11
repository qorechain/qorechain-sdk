package query

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func serve(t *testing.T, h func(w http.ResponseWriter, r *http.Request)) *RestClient {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(h))
	t.Cleanup(srv.Close)
	return NewRestClient(srv.URL, srv.Client())
}

func TestGetAllCrossVMPendingFollowsNextKey(t *testing.T) {
	var keys []string
	c := serve(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != CrossVMPendingPath {
			http.NotFound(w, r)
			return
		}
		key := r.URL.Query().Get("pagination.key")
		keys = append(keys, key)
		if r.URL.Query().Get("pagination.limit") != "100" {
			t.Errorf("limit = %q", r.URL.Query().Get("pagination.limit"))
		}
		switch key {
		case "":
			fmt.Fprintf(w, `{"messages":[{"id":"a"},{"id":"b"}],"count":2,"pagination":{"next_key":"%s"}}`, base64.StdEncoding.EncodeToString([]byte("k1")))
		case base64.StdEncoding.EncodeToString([]byte("k1")):
			fmt.Fprint(w, `{"messages":[{"id":"c"}],"count":1,"pagination":{"next_key":null}}`)
		default:
			t.Errorf("unexpected key %q", key)
		}
	})
	all, err := c.GetAllCrossVMPending(0)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 3 || all[2].Id != "c" || len(keys) != 2 {
		t.Fatalf("all = %v, keys = %v", all, keys)
	}
}

func TestGetAllCrossVMPendingPageCap(t *testing.T) {
	n := 0
	c := serve(t, func(w http.ResponseWriter, r *http.Request) {
		n++
		fmt.Fprintf(w, `{"messages":[],"pagination":{"next_key":"%s"}}`, base64.StdEncoding.EncodeToString([]byte(fmt.Sprint(n))))
	})
	if _, err := c.GetAllCrossVMPending(3); err == nil || n != 3 {
		t.Fatalf("err = %v after %d pages", err, n)
	}
}

func TestGetEVMLimits(t *testing.T) {
	cases := map[string]EVMLimits{
		`{"limits":{"tx_max_gas":"0"},"tx_max_gas":"30000000","precompile_input_max_bytes":"65536"}`: {30_000_000, 65536},
		`{"limits":{"tx_max_gas":"25000000","precompile_input_max_bytes":"1024"}}`:                   {25_000_000, 1024},
		`{}`: {DefaultEVMTxMaxGas, 0},
	}
	for body, want := range cases {
		c := serve(t, func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != EVMLimitsPath {
				http.NotFound(w, r)
				return
			}
			fmt.Fprint(w, body)
		})
		got, err := c.GetEVMLimits()
		if err != nil || got != want {
			t.Errorf("%s: got %+v, err %v, want %+v", body, got, err, want)
		}
	}
}

func TestGetSvmAndRdkParams(t *testing.T) {
	c := serve(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case SvmParamsPath:
			fmt.Fprint(w, `{"params":{"max_program_size":"1024","rent_exemption_multi":"2.000000000000000000","enabled":true,"max_custody_hard_uqor":"500","max_cpi":4}}`)
		case RdkParamsPath:
			fmt.Fprint(w, `{"params":{"max_rollups":100,"min_submitter_bond":"77","rollup_creation_burn_rate":"0.01"}}`)
		default:
			http.NotFound(w, r)
		}
	})
	svm, err := c.GetSvmParams()
	if err != nil {
		t.Fatal(err)
	}
	if svm.MaxProgramSize != 1024 || !svm.Enabled || svm.MaxCustodyHardUqor != 500 || svm.MaxCpi != 4 || svm.RentExemptionMulti.String() != "2.000000000000000000" {
		t.Fatalf("svm = %+v", svm)
	}
	bare, err := ParseSvmParams([]byte(`{"max_program_size":"7"}`))
	if err != nil || bare.MaxProgramSize != 7 {
		t.Fatalf("bare = %+v, err = %v", bare, err)
	}
	rdk, err := c.GetRdkParams()
	if err != nil || rdk.Params.MaxRollups != 100 || rdk.Params.MinSubmitterBond != 77 {
		t.Fatalf("rdk = %+v, err = %v", rdk, err)
	}
}

func TestGetFeemarketMinGasPrice(t *testing.T) {
	c := serve(t, func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, FeemarketParamsPath) {
			http.NotFound(w, r)
			return
		}
		fmt.Fprint(w, `{"params":{"min_gas_price":"100000000000.000000000000000000","base_fee":"1"}}`)
	})
	got, err := c.GetFeemarketMinGasPrice()
	if err != nil || got != "100000000000.000000000000000000" {
		t.Fatalf("got %q, err %v", got, err)
	}
}
