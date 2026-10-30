package messages

import (
	"strings"
	"testing"

	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/cosmos/cosmos-sdk/types/bech32"

	abstractaccountv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/abstractaccount/v1"
)

// mlkemKey packs 1024 coefficients coeff(i) into an ML-KEM-1024 key layout
// (12-bit little-endian pairs) followed by 32 bytes of rho.
func mlkemKey(coeff func(i int) uint16) []byte {
	pub := make([]byte, MLKEM1024PublicKeySize)
	for j := 0; j < 512; j++ {
		c0, c1 := coeff(2*j), coeff(2*j+1)
		pub[3*j] = byte(c0)
		pub[3*j+1] = byte(c0>>8) | byte(c1<<4)
		pub[3*j+2] = byte(c1 >> 4)
	}
	for i := mlkem1024THatSz; i < len(pub); i++ {
		pub[i] = 0xAB
	}
	return pub
}

func TestValidateKEMPublicKey(t *testing.T) {
	good := mlkemKey(func(i int) uint16 { return uint16((i*7 + 1) % 3329) })
	if err := ValidateKEMPublicKey(KEMAlgorithmMLKEM1024, good); err != nil {
		t.Fatalf("good key refused: %v", err)
	}
	// Highest reduced coefficient passes; q itself fails.
	edge := mlkemKey(func(i int) uint16 { return 3328 })
	if err := ValidateKEMPublicKey(KEMAlgorithmMLKEM1024, edge); err != nil {
		t.Fatalf("coefficients of 3328 refused: %v", err)
	}
	bad := mlkemKey(func(i int) uint16 {
		if i == 101 {
			return 3329
		}
		return 5
	})
	if err := ValidateKEMPublicKey(KEMAlgorithmMLKEM1024, bad); err == nil || !strings.Contains(err.Error(), "not reduced") {
		t.Fatalf("unreduced coefficient: err = %v", err)
	}
	allFF := mlkemKey(func(int) uint16 { return 0 })
	for i := 0; i < mlkem1024THatSz; i++ {
		allFF[i] = 0xFF
	}
	if err := ValidateKEMPublicKey(KEMAlgorithmMLKEM1024, allFF); err == nil {
		t.Fatal("0xFF key accepted")
	}
	zero := mlkemKey(func(int) uint16 { return 0 })
	if err := ValidateKEMPublicKey(KEMAlgorithmMLKEM1024, zero); err == nil || !strings.Contains(err.Error(), "all zero") {
		t.Fatalf("all-zero t_hat: err = %v", err)
	}
	if err := ValidateKEMPublicKey(KEMAlgorithmMLKEM1024, good[:1567]); err == nil || !strings.Contains(err.Error(), "1568") {
		t.Fatalf("short key: err = %v", err)
	}
	if err := ValidateKEMPublicKey(0, good); err == nil {
		t.Fatal("algorithm 0 accepted")
	}
	if err := ValidateKEMPublicKey(1, good); err == nil || !strings.Contains(err.Error(), "signature algorithm") {
		t.Fatalf("algorithm 1: err = %v", err)
	}
	// A later algorithm id passes through for the chain's registry.
	if err := ValidateKEMPublicKey(7, []byte{1, 2, 3}); err != nil {
		t.Fatalf("algorithm 7: %v", err)
	}
}

func TestKEMComposers(t *testing.T) {
	good := mlkemKey(func(i int) uint16 { return uint16(i % 3329) })
	msg, err := NewRegisterKEMKey("qor1sender", good)
	if err != nil {
		t.Fatal(err)
	}
	if typeURL(msg) != "/qorechain.pqc.v1.MsgRegisterKEMKey" || msg.AlgorithmID != 2 || len(msg.PublicKey) != 1568 || msg.Sender != "qor1sender" {
		t.Fatalf("register = %s %+v", typeURL(msg), msg.AlgorithmID)
	}
	if _, err := NewRegisterKEMKey("", good); err == nil {
		t.Fatal("empty sender accepted")
	}
	rm := Pqc.RemoveKEMKey("qor1sender")
	if typeURL(rm) != "/qorechain.pqc.v1.MsgRemoveKEMKey" || rm.Sender != "qor1sender" {
		t.Fatalf("remove = %s", typeURL(rm))
	}
	for _, m := range []sdk.Msg{msg, rm} {
		a, err := PackAny(m)
		if err != nil {
			t.Fatal(err)
		}
		var back sdk.Msg
		if err := NewProtoCodec().UnpackAny(a, &back); err != nil {
			t.Fatalf("%s: %v", a.TypeUrl, err)
		}
	}
}

func TestValidateEVMDenom(t *testing.T) {
	addr := "0x" + strings.Repeat("aB", 20)
	ok := []string{"uqor", "ibc/ABC", "erc20/" + addr, "ERC20/" + addr, "erc721/" + addr + "/7", "erc1155/0X" + strings.Repeat("0", 40) + "/1"}
	for _, d := range ok {
		if err := ValidateEVMDenom(d); err != nil {
			t.Errorf("%s: %v", d, err)
		}
	}
	bad := []string{"erc20/" + addr + "/1", "erc20/" + addr[2:], "erc721/0x1234", "erc1155/0x" + strings.Repeat("g", 40), "erc20/"}
	for _, d := range bad {
		if err := ValidateEVMDenom(d); err == nil {
			t.Errorf("%s accepted", d)
		}
	}
	// The rule check applies it to denom limits and allowed denoms.
	rules := []abstractaccountv1.SpendingRule{{Enabled: true, PerTxLimit: 5, AllowedDenoms: []string{"erc20/0x12"}}}
	if err := ValidateSpendingRules(rules); err == nil || !strings.Contains(err.Error(), "contract address") {
		t.Fatalf("allowed denom: err = %v", err)
	}
	rules = []abstractaccountv1.SpendingRule{{Enabled: true, DenomLimits: []*abstractaccountv1.DenomLimit{{Denom: "erc721/nope", PerTxLimit: "1"}}}}
	if err := ValidateSpendingRules(rules); err == nil || !strings.Contains(err.Error(), "contract address") {
		t.Fatalf("denom limit: err = %v", err)
	}
	rules = []abstractaccountv1.SpendingRule{{Enabled: true, DenomLimits: []*abstractaccountv1.DenomLimit{{Denom: "erc20/" + addr, PerTxLimit: "1"}}}}
	if err := ValidateSpendingRules(rules); err != nil {
		t.Fatalf("valid erc20 limit: %v", err)
	}
}

func TestUpdateConfigComposer(t *testing.T) {
	msg, err := NewUpdateConfig("qor1gov", true, 10, 5, 86400)
	if err != nil {
		t.Fatal(err)
	}
	if typeURL(msg) != "/qorechain.abstractaccount.v1.MsgUpdateConfig" || !msg.Enabled || msg.MaxSessionKeys != 10 || msg.MaxSpendingRules != 5 || msg.DefaultSessionTtl != 86400 {
		t.Fatalf("msg = %+v", msg)
	}
	for _, c := range []struct {
		keys, rules int32
		ttl         int64
		auth        string
	}{{0, 5, 1, "g"}, {1, 0, 1, "g"}, {1, 1, 0, "g"}, {1, 1, 1, ""}} {
		if _, err := NewUpdateConfig(c.auth, false, c.keys, c.rules, c.ttl); err == nil {
			t.Errorf("%+v accepted", c)
		}
	}
}

func TestCrossVMUpdateParamsComposer(t *testing.T) {
	contract, err := bech32.ConvertAndEncode("qor", make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	msg, err := NewCrossVMUpdateParams("qor1gov", 65536, 1000, 100, true, []string{"cosmwasm:" + contract})
	if err != nil {
		t.Fatal(err)
	}
	if typeURL(msg) != "/qorechain.crossvm.v1.MsgUpdateParams" || len(msg.BridgeAllowedTargets) != 1 || msg.MaxMessageSize != 65536 {
		t.Fatalf("msg = %+v", msg)
	}
	if _, err := NewCrossVMUpdateParams("qor1gov", 65536, 1000, 100, true, nil); err != nil {
		t.Fatalf("empty allowlist: %v", err)
	}
	cases := []struct {
		size    uint64
		queue   uint32
		timeout int64
		targets []string
	}{
		{0, 1, 1, nil},
		{1<<20 + 1, 1, 1, nil},
		{1, 0, 1, nil},
		{1, 10_001, 1, nil},
		{1, 1, 0, nil},
		{1, 1, 100_001, nil},
		{1, 1, 1, []string{"evm:0x01"}},
		{1, 1, 1, []string{"cosmwasm:notanaddress"}},
		{1, 1, 1, []string{"cosmwasm:" + contract, "cosmwasm:" + contract}},
	}
	for _, c := range cases {
		if _, err := NewCrossVMUpdateParams("qor1gov", c.size, c.queue, c.timeout, true, c.targets); err == nil {
			t.Errorf("%+v accepted", c)
		}
	}
}

func TestRdkUpdateParamsComposer(t *testing.T) {
	good := RdkParams{MaxRollups: 100, MinStakeForRollup: 10_000_000, RollupCreationBurnRate: "0.01",
		DefaultChallengeWindow: 604800, MaxDABlobSize: 2 << 20, BlobRetentionBlocks: 100000, MaxBatchesPerBlock: 10}
	msg, err := NewRdkUpdateParams("qor1gov", good)
	if err != nil {
		t.Fatal(err)
	}
	if typeURL(msg) != "/qorechain.rdk.v1.MsgUpdateParams" || msg.RollupCreationBurnRate != "0.01" || msg.DefaultChallengeWindow != 604800 || msg.MaxDaBlobSize != 2<<20 {
		t.Fatalf("msg = %+v", msg)
	}
	mut := []func(p *RdkParams){
		func(p *RdkParams) { p.MaxRollups = 0 },
		func(p *RdkParams) { p.MinStakeForRollup = 0 },
		func(p *RdkParams) { p.RollupCreationBurnRate = "1" },
		func(p *RdkParams) { p.RollupCreationBurnRate = "-0.1" },
		func(p *RdkParams) { p.RollupCreationBurnRate = "x" },
		func(p *RdkParams) { p.DefaultChallengeWindow = 59 },
		func(p *RdkParams) { p.DefaultChallengeWindow = 30*24*3600 + 1 },
		func(p *RdkParams) { p.MaxDABlobSize = 0 },
		func(p *RdkParams) { p.MaxDABlobSize = 8<<20 + 1 },
		func(p *RdkParams) { p.BlobRetentionBlocks = 0 },
		func(p *RdkParams) { p.MaxBatchesPerBlock = 0 },
	}
	for i, m := range mut {
		p := good
		m(&p)
		if _, err := NewRdkUpdateParams("qor1gov", p); err == nil {
			t.Errorf("mutation %d accepted", i)
		}
	}
}
