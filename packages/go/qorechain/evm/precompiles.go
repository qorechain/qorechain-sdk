package evm

import (
	"fmt"
	"math/big"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/address"
)

// Fixed 20-byte precompile addresses (zero-padded), matching the chain's
// published interface registrations. These mirror the canonical SDK constants.
const (
	// CrossVMBridgeAddress is the CrossVM Bridge precompile.
	CrossVMBridgeAddress = "0x0000000000000000000000000000000000000901"
	// PQCVerifyAddress is the PQC signature-verification precompile.
	PQCVerifyAddress = "0x0000000000000000000000000000000000000A01"
	// PQCKeyStatusAddress is the PQC key-registration-status precompile.
	PQCKeyStatusAddress = "0x0000000000000000000000000000000000000A02"
	// AIRiskScoreAddress is the AI transaction risk-score precompile
	// (IQoreAI.aiRiskScore).
	AIRiskScoreAddress = "0x0000000000000000000000000000000000000B01"
	// AIAnomalyCheckAddress is the AI anomaly-check precompile
	// (IQoreAI.aiAnomalyCheck).
	AIAnomalyCheckAddress = "0x0000000000000000000000000000000000000B02"
	// RLConsensusParamsAddress is the consensus-parameters precompile.
	RLConsensusParamsAddress = "0x0000000000000000000000000000000000000C01"
)

// Precompile function signatures (used to derive the 4-byte selectors).
const (
	aiRiskScoreSignature    = "aiRiskScore(bytes)"
	aiAnomalyCheckSignature = "aiAnomalyCheck(address,uint256)"
)

// AIRiskScore computes an on-chain risk score for raw transaction data by
// calling the aiRiskScore(bytes) precompile via eth_call.
//
// It returns the numeric score and a discrete level (0 = lowest risk). A level
// of 3 or above is conventionally treated as high risk (see
// SimulateWithRiskScore). A returned error usually means the precompile is not
// available on this node.
func (c *Client) AIRiskScore(txData []byte) (score *big.Int, level uint8, err error) {
	calldata := append(selector(aiRiskScoreSignature), encodeBytesArg(txData)...)
	ret, err := c.EthCall(CallMsg{To: normalizeHexAddr(AIRiskScoreAddress), Data: calldata}, "latest")
	if err != nil {
		return nil, 0, err
	}
	score, err = decodeUint(ret, 0)
	if err != nil {
		return nil, 0, fmt.Errorf("decode aiRiskScore score: %w", err)
	}
	level, err = decodeUint8(ret, 1)
	if err != nil {
		return nil, 0, fmt.Errorf("decode aiRiskScore level: %w", err)
	}
	return score, level, nil
}

// AIAnomalyCheck checks whether a (sender, amount) pair is anomalous by calling
// the aiAnomalyCheck(address,uint256) precompile via eth_call.
//
// sender may be an EVM "0x"-prefixed hex address or a bech32 ("qor1...")
// address; bech32 is converted to its 20-byte payload. It returns the anomaly
// score and a flagged boolean. A returned error usually means the precompile is
// not available on this node.
func (c *Client) AIAnomalyCheck(sender string, amount *big.Int) (anomalyScore *big.Int, flagged bool, err error) {
	hexSender, err := toHexAddress(sender)
	if err != nil {
		return nil, false, err
	}
	encAddr, err := encodeAddress(hexSender)
	if err != nil {
		return nil, false, err
	}
	calldata := append(selector(aiAnomalyCheckSignature), encAddr...)
	calldata = append(calldata, encodeUint(amount)...)
	ret, err := c.EthCall(CallMsg{To: normalizeHexAddr(AIAnomalyCheckAddress), Data: calldata}, "latest")
	if err != nil {
		return nil, false, err
	}
	anomalyScore, err = decodeUint(ret, 0)
	if err != nil {
		return nil, false, fmt.Errorf("decode aiAnomalyCheck score: %w", err)
	}
	flagged, err = decodeBool(ret, 1)
	if err != nil {
		return nil, false, fmt.Errorf("decode aiAnomalyCheck flagged: %w", err)
	}
	return anomalyScore, flagged, nil
}

// SimulateTx is the input to SimulateWithRiskScore.
type SimulateTx struct {
	// From is the sender address (hex "0x..." or bech32). Used as the eth_call
	// caller, the anomaly-check subject, and (when To is empty) for gas.
	From string
	// To is the target contract / recipient address.
	To string
	// Data is the transaction calldata; also fed to the risk-score precompile.
	Data []byte
	// Value is the transaction value in wei (nil = 0). Also the anomaly amount.
	Value *big.Int
}

// RiskResult holds the AI risk-score precompile output.
type RiskResult struct {
	Score *big.Int
	Level uint8
}

// AnomalyResult holds the AI anomaly-check precompile output.
type AnomalyResult struct {
	Score   *big.Int
	Flagged bool
}

// SimulateResult is the combined pre-flight result from SimulateWithRiskScore.
type SimulateResult struct {
	// Gas is the eth_estimateGas estimate for the transaction.
	Gas uint64
	// Risk is the aiRiskScore precompile output for the calldata.
	Risk RiskResult
	// Anomaly is the aiAnomalyCheck precompile output for (From, Value).
	Anomaly AnomalyResult
	// Safe is an ADVISORY verdict: true when Risk.Level < 3 AND not flagged.
	//
	// It is a convenience signal for client-side UX only and is NOT enforced by
	// the chain — the transaction can still be submitted when Safe is false, and
	// a Safe value of true is not a guarantee of execution success.
	Safe bool
}

// SimulateWithRiskScore runs an AI pre-flight over a prospective transaction: it
// estimates gas (eth_estimateGas), scores the calldata (aiRiskScore) and checks
// the sender/amount for anomalies (aiAnomalyCheck), then combines them into an
// advisory Safe verdict (Risk.Level < 3 && !Anomaly.Flagged).
//
// The Safe field is advisory only; see SimulateResult.Safe.
func (c *Client) SimulateWithRiskScore(tx SimulateTx) (SimulateResult, error) {
	value := tx.Value
	if value == nil {
		value = big.NewInt(0)
	}

	gas, err := c.EthEstimateGas(CallMsg{From: tx.From, To: tx.To, Data: tx.Data, Value: value})
	if err != nil {
		return SimulateResult{}, fmt.Errorf("estimate gas: %w", err)
	}

	score, level, err := c.AIRiskScore(tx.Data)
	if err != nil {
		return SimulateResult{}, fmt.Errorf("ai risk score: %w", err)
	}

	anomalyScore, flagged, err := c.AIAnomalyCheck(tx.From, value)
	if err != nil {
		return SimulateResult{}, fmt.Errorf("ai anomaly check: %w", err)
	}

	return SimulateResult{
		Gas:     gas,
		Risk:    RiskResult{Score: score, Level: level},
		Anomaly: AnomalyResult{Score: anomalyScore, Flagged: flagged},
		Safe:    level < 3 && !flagged,
	}, nil
}

// toHexAddress accepts either a "0x"-prefixed hex address (returned as-is) or a
// bech32 address (converted to its "0x" payload).
func toHexAddress(addr string) (string, error) {
	if len(addr) >= 2 && (addr[:2] == "0x" || addr[:2] == "0X") {
		return addr, nil
	}
	return address.Bech32ToHex(addr)
}
