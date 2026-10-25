package tx

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeTxErrorStakingTier(t *testing.T) {
	for code, want := range map[uint32]string{
		2:  "invalid staking-tier parameters",
		5:  "this lock term is not offered (see the module parameters)",
		13: "this stake is locked; undelegating or redelegating it waits for the lock to end",
	} {
		if e := DecodeTxError(code, "stakingtier", ""); e.Reason != want {
			t.Errorf("stakingtier %d: %q", code, e.Reason)
		}
	}
	if len(moduleCodespaceReasons["stakingtier"]) != 12 {
		t.Fatalf("stakingtier codes 2-13: got %d", len(moduleCodespaceReasons["stakingtier"]))
	}
	if e := DecodeTxError(14, "stakingtier", ""); e.Reason != "unknown stakingtier error" {
		t.Fatalf("14: %q", e.Reason)
	}
}

const simText = "rpc error: code = Unknown desc = failed to execute message; message index: 0: " +
	"no bonus to claim [baseapp.go:1052] with gas used: '111685': unknown request"

func TestDecodeTxErrorFailedSimulationTextOnly(t *testing.T) {
	e := DecodeRefusalText(simText)
	if e == nil || e.Codespace != "stakingtier" || e.Code != 12 || e.Reason != "no bonus to claim" || e.RawLog != simText {
		t.Fatalf("text-only refusal: %+v", e)
	}
	// The longest match wins: the hybrid failure is not the plain PQC one.
	if h := DecodeRefusalText("hybrid PQC signature verification failed"); h == nil || h.Codespace != "pqc" || h.Code != 21 {
		t.Fatalf("longest match: %+v", h)
	}
	// A coded error is left alone.
	if c := DecodeTxError(5, "sdk", "no bonus to claim"); c.Code != 5 || c.Codespace != "sdk" {
		t.Fatalf("coded: %+v", c)
	}
	// Text that names nothing stays nil, and code 0 is success whatever the log says.
	if DecodeRefusalText("") != nil || DecodeRefusalText("something else") != nil {
		t.Fatal("expected nil")
	}
	if DecodeTxError(0, "", simText) != nil {
		t.Fatal("code 0 must decode as success, even when the log names an error")
	}
}

func TestEstimateGasNamesASimulationRefusal(t *testing.T) {
	body := `{"code":2,"message":"` + simText + `","details":[]}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(body))
	}))
	defer srv.Close()
	_, err := EstimateGas(srv.URL, []byte{0x01}, nil)
	var txErr *QoreTxError
	if !errors.As(err, &txErr) || txErr.Codespace != "stakingtier" || txErr.Code != 12 || txErr.RawLog != simText {
		t.Fatalf("expected a named refusal, got %v", err)
	}
	if !strings.Contains(err.Error(), "simulate HTTP 500") || !strings.Contains(err.Error(), "no bonus to claim") {
		t.Fatalf("message: %v", err)
	}
	// A failure that names no refusal keeps the plain HTTP error with its body.
	plain := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte("bad gateway"))
	}))
	defer plain.Close()
	_, err = EstimateFee(plain.URL, []byte{0x01}, 0, "", nil)
	if err == nil || errors.As(err, &txErr) || !strings.Contains(err.Error(), "bad gateway") {
		t.Fatalf("plain: %v", err)
	}
}
