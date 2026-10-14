package messages

import (
	"encoding/hex"
	"fmt"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/pqc"
)

// PQC key registration integrity (chain v3.2.3).
//
// From v3.2.3 the chain refuses a registration that protects nothing, and
// accepts proof that the registrant holds the key's secret:
//   - key_type "classical_only" registers no post-quantum key, and the account
//     could then never sign a transaction again;
//   - an empty public key;
//   - a degenerate ML-DSA-87 key, whose t1 part (every byte after the 32-byte
//     rho) is zero: anyone can forge signatures for it;
//   - proof_of_possession (optional now, to become mandatory): the key's own
//     ML-DSA signature over
//     "qorechain-pqc-pop-v1|<chain-id>|<algorithm>|<account>|<hex(public key)>",
//     lower-case hex, deterministic, empty context.
//
// Also from v3.2.3 an account that already has a key must send register /
// migrate with the hybrid signature (pqcdx.Client.MigratePQCKeyHybrid), a
// rotation or migration to a key the account used before is refused, and none
// of the key-management messages may travel inside authz MsgExec.
//
// proof_of_possession is a new field: a node below v3.2.3 refuses the whole
// transaction when it is set. Set it only once the network has applied v3.2.3
// (query.RestClient.IsUpgradeApplied(query.ChainUpgradeV3_2_3)).
const (
	// MLDSA87PublicKeyLength is the size of an ML-DSA-87 public key.
	MLDSA87PublicKeyLength = 2592
	// KeyTypeClassicalOnly is the key type the chain refuses from v3.2.3.
	KeyTypeClassicalOnly = "classical_only"
	// ProofOfPossessionDomain prefixes the proof-of-possession sign-bytes.
	ProofOfPossessionDomain = "qorechain-pqc-pop-v1"

	mldsa87RhoLength = 32
)

// IsDegeneratePQCPublicKey reports whether publicKey is an ML-DSA-87 key
// nobody needs a secret for: right length, every byte after rho zero. Keys of
// another length are not judged.
func IsDegeneratePQCPublicKey(publicKey []byte) bool {
	if len(publicKey) != MLDSA87PublicKeyLength {
		return false
	}
	for _, b := range publicKey[mldsa87RhoLength:] {
		if b != 0 {
			return false
		}
	}
	return true
}

// ValidateRegisteredPQCKey refuses a registration the chain refuses from
// v3.2.3. Not network-gated: such a registration protects nothing, or locks the
// account, on any network.
func ValidateRegisteredPQCKey(keyType string, publicKey []byte) error {
	if keyType == KeyTypeClassicalOnly {
		return fmt.Errorf(`key_type "classical_only" registers no post-quantum key; the account would be unable to sign any transaction afterwards`)
	}
	if len(publicKey) == 0 {
		return fmt.Errorf("a post-quantum public key is required")
	}
	if IsDegeneratePQCPublicKey(publicKey) {
		return fmt.Errorf("the key's t1 part is all zero, so anyone can forge its signatures")
	}
	return nil
}

// ProofOfPossessionSignBytes is what the key being registered signs to prove
// its owner holds the secret. It names the chain, the algorithm, the account
// and the key, so a proof made for one account or chain proves nothing for
// another.
func ProofOfPossessionSignBytes(chainID string, algorithmID uint32, account string, publicKey []byte) ([]byte, error) {
	if chainID == "" {
		return nil, fmt.Errorf("proof of possession: chain id is required")
	}
	if account == "" {
		return nil, fmt.Errorf("proof of possession: account is required")
	}
	return []byte(fmt.Sprintf("%s|%s|%d|%s|%s", ProofOfPossessionDomain, chainID, algorithmID, account, hex.EncodeToString(publicKey))), nil
}

// SignProofOfPossession signs the proof of possession with the key being
// registered (deterministic ML-DSA-87). Set the result as
// MsgRegisterPQCKeyV2.ProofOfPossession — only on a network that has applied
// v3.2.3.
func SignProofOfPossession(chainID, account string, keypair pqc.Keypair) ([]byte, error) {
	bz, err := ProofOfPossessionSignBytes(chainID, uint32(pqc.AlgorithmDilithium5), account, keypair.PublicKey)
	if err != nil {
		return nil, err
	}
	return pqc.PQCSign(keypair.SecretKey, bz)
}

// VerifyProofOfPossession verifies a proof of possession locally, as the chain
// will.
func VerifyProofOfPossession(chainID, account string, publicKey, proof []byte) bool {
	bz, err := ProofOfPossessionSignBytes(chainID, uint32(pqc.AlgorithmDilithium5), account, publicKey)
	if err != nil {
		return false
	}
	return pqc.PQCVerify(publicKey, bz, proof)
}
