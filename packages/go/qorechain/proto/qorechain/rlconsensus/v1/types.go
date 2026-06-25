package rlconsensusv1

// AgentMode is the named integer type referenced by the generated rlconsensus
// messages via gogoproto's casttype option. It mirrors the chain's x/rlconsensus
// RL agent operating mode (shadow/conservative/autonomous/paused). The
// underlying uint32 keeps the wire encoding identical to a plain proto3 uint32
// field.
type AgentMode uint32
