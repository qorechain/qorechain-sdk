package client

import (
	"errors"
	"testing"

	sdk "github.com/cosmos/cosmos-sdk/types"

	crossvmv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/crossvm/v1"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/tx"
)

func TestEstimateForRefusesFixedGasForCrossVM(t *testing.T) {
	c, err := CreateClient(Options{Network: "localnet"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = c.Fees.EstimateFor("normal", []sdk.Msg{&crossvmv1.MsgCrossVMCall{}})
	if !errors.Is(err, tx.ErrFixedGasForWasm) {
		t.Fatalf("err = %v", err)
	}
}
