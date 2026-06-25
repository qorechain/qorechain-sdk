package ammv1

// PoolType is the named string type referenced by the generated AMM messages
// via gogoproto's casttype option. It mirrors the chain's x/amm pool-type
// identifier (e.g. "constant_product", "stableswap"). Using a string keeps the
// wire encoding identical to a plain proto3 string field.
type PoolType string
