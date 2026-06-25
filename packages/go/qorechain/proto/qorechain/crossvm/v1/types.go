package crossvmv1

// VMType is the named string type referenced by the generated crossvm messages
// via gogoproto's casttype option. It mirrors the chain's x/crossvm VM
// identifier (e.g. "evm", "svm", "wasm"). The underlying string keeps the wire
// encoding identical to a plain proto3 string field.
type VMType string
