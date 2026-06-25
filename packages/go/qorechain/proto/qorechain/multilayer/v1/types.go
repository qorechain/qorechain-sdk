package multilayerv1

// LayerStatus is the named string type referenced by the generated multilayer
// messages via gogoproto's casttype option. It mirrors the chain's x/multilayer
// layer-status identifier (e.g. "active", "paused"). The underlying string keeps
// the wire encoding identical to a plain proto3 string field.
type LayerStatus string
