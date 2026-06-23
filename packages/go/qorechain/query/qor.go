package query

import (
	"encoding/json"
	"net/http"
)

// QorMethods is the authoritative map of snake_case-ish Go method names to the
// exact wire method names of the QoreChain qor_* JSON-RPC namespace. The
// on-the-wire names use the chain's exact casing and must not be altered.
var QorMethods = map[string]string{
	"GetPQCKeyStatus":         "qor_getPQCKeyStatus",
	"GetHybridSignatureMode":  "qor_getHybridSignatureMode",
	"GetAIStats":              "qor_getAIStats",
	"GetCrossVMMessage":       "qor_getCrossVMMessage",
	"GetReputationScore":      "qor_getReputationScore",
	"GetLayerInfo":            "qor_getLayerInfo",
	"GetBridgeStatus":         "qor_getBridgeStatus",
	"GetRLAgentStatus":        "qor_getRLAgentStatus",
	"GetRLObservation":        "qor_getRLObservation",
	"GetRLReward":             "qor_getRLReward",
	"GetPoolClassification":   "qor_getPoolClassification",
	"GetBurnStats":            "qor_getBurnStats",
	"GetXQOREPosition":        "qor_getXQOREPosition",
	"GetInflationRate":        "qor_getInflationRate",
	"GetTokenomicsOverview":   "qor_getTokenomicsOverview",
	"GetRollupStatus":         "qor_getRollupStatus",
	"ListRollups":             "qor_listRollups",
	"GetSettlementBatch":      "qor_getSettlementBatch",
	"SuggestRollupProfile":    "qor_suggestRollupProfile",
	"GetDABlobStatus":         "qor_getDABlobStatus",
	"GetBTCStakingPosition":   "qor_getBTCStakingPosition",
	"GetAbstractAccount":      "qor_getAbstractAccount",
	"GetFairBlockStatus":      "qor_getFairBlockStatus",
	"GetGasAbstractionConfig": "qor_getGasAbstractionConfig",
	"GetLaneConfiguration":    "qor_getLaneConfiguration",
}

// QorClient is a typed client for the QoreChain qor_* JSON-RPC namespace. Point
// it at the network's EVM JSON-RPC endpoint.
type QorClient struct {
	*JSONRPCClient
}

// NewQorClient creates a QorClient targeting the given (EVM JSON-RPC) URL.
func NewQorClient(rpcURL string, httpClient *http.Client) *QorClient {
	return &QorClient{JSONRPCClient: NewJSONRPCClient(rpcURL, httpClient)}
}

// --- PQC / signatures ---

func (c *QorClient) GetPQCKeyStatus(address string) (json.RawMessage, error) {
	return c.Call("qor_getPQCKeyStatus", []any{address})
}

func (c *QorClient) GetHybridSignatureMode() (json.RawMessage, error) {
	return c.Call("qor_getHybridSignatureMode", []any{})
}

// --- AI engine ---

func (c *QorClient) GetAIStats() (json.RawMessage, error) {
	return c.Call("qor_getAIStats", []any{})
}

// --- Cross-VM ---

func (c *QorClient) GetCrossVMMessage(messageID string) (json.RawMessage, error) {
	return c.Call("qor_getCrossVMMessage", []any{messageID})
}

// --- Reputation / pools ---

func (c *QorClient) GetReputationScore(validator string) (json.RawMessage, error) {
	return c.Call("qor_getReputationScore", []any{validator})
}

func (c *QorClient) GetPoolClassification(validator string) (json.RawMessage, error) {
	return c.Call("qor_getPoolClassification", []any{validator})
}

// --- Layers / bridge ---

func (c *QorClient) GetLayerInfo(layerID string) (json.RawMessage, error) {
	return c.Call("qor_getLayerInfo", []any{layerID})
}

func (c *QorClient) GetBridgeStatus(chainID string) (json.RawMessage, error) {
	return c.Call("qor_getBridgeStatus", []any{chainID})
}

// --- Reinforcement learning ---

func (c *QorClient) GetRLAgentStatus() (json.RawMessage, error) {
	return c.Call("qor_getRLAgentStatus", []any{})
}

func (c *QorClient) GetRLObservation() (json.RawMessage, error) {
	return c.Call("qor_getRLObservation", []any{})
}

func (c *QorClient) GetRLReward() (json.RawMessage, error) {
	return c.Call("qor_getRLReward", []any{})
}

// --- Tokenomics ---

func (c *QorClient) GetBurnStats() (json.RawMessage, error) {
	return c.Call("qor_getBurnStats", []any{})
}

func (c *QorClient) GetXQOREPosition(address string) (json.RawMessage, error) {
	return c.Call("qor_getXQOREPosition", []any{address})
}

func (c *QorClient) GetInflationRate() (json.RawMessage, error) {
	return c.Call("qor_getInflationRate", []any{})
}

func (c *QorClient) GetTokenomicsOverview() (json.RawMessage, error) {
	return c.Call("qor_getTokenomicsOverview", []any{})
}

// --- Rollups / DA / settlement ---

func (c *QorClient) GetRollupStatus(rollupID string) (json.RawMessage, error) {
	return c.Call("qor_getRollupStatus", []any{rollupID})
}

func (c *QorClient) ListRollups() (json.RawMessage, error) {
	return c.Call("qor_listRollups", []any{})
}

func (c *QorClient) GetSettlementBatch(rollupID string, batchIndex int) (json.RawMessage, error) {
	return c.Call("qor_getSettlementBatch", []any{rollupID, batchIndex})
}

func (c *QorClient) SuggestRollupProfile(useCase string) (json.RawMessage, error) {
	return c.Call("qor_suggestRollupProfile", []any{useCase})
}

func (c *QorClient) GetDABlobStatus(rollupID string, blobIndex int) (json.RawMessage, error) {
	return c.Call("qor_getDABlobStatus", []any{rollupID, blobIndex})
}

// --- BTC staking / accounts ---

func (c *QorClient) GetBTCStakingPosition(address string) (json.RawMessage, error) {
	return c.Call("qor_getBTCStakingPosition", []any{address})
}

func (c *QorClient) GetAbstractAccount(address string) (json.RawMessage, error) {
	return c.Call("qor_getAbstractAccount", []any{address})
}

// --- Ordering / gas / lanes ---

func (c *QorClient) GetFairBlockStatus() (json.RawMessage, error) {
	return c.Call("qor_getFairBlockStatus", []any{})
}

func (c *QorClient) GetGasAbstractionConfig() (json.RawMessage, error) {
	return c.Call("qor_getGasAbstractionConfig", []any{})
}

func (c *QorClient) GetLaneConfiguration() (json.RawMessage, error) {
	return c.Call("qor_getLaneConfiguration", []any{})
}
