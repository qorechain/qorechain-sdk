package pqcv1

// AlgorithmID is the named integer type referenced by the generated PQC messages
// via gogoproto's casttype option. It mirrors the chain's x/pqc algorithm
// identifier (0=unspecified, 1=Dilithium-5/ML-DSA-87, 2=ML-KEM-1024). The
// underlying uint32 keeps the wire encoding identical to a plain proto3 uint32
// field.
type AlgorithmID uint32
