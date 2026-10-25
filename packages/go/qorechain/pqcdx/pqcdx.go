// Package pqcdx provides a high-level, quantum-safe developer-experience (DX)
// helper for QoreChain's x/pqc module. It wraps the three things an app developer
// actually wants when adopting post-quantum signatures:
//
//   - reading whether an address has a PQC key registered (IsPQCRegistered /
//     GetPQCStatus, via the qor_getPQCKeyStatus JSON-RPC method);
//   - idempotently registering the signer's PQC key if it is missing
//     (EnsurePQCRegistered, which builds and broadcasts a MsgRegisterPQCKeyV2 only
//     when needed); and
//   - migrating an account to hybrid (classical + ML-DSA-87) signing once the key
//     is registered (MigrateToHybrid / MigratePQCKey).
//
// The helper mirrors the SDK's module-helper style (see the crossvm helper): a
// caller-supplied Signer carries the explicit account number, sequence, chain id,
// and fee — the Go SDK never simulates or auto-fetches these — and the high-level
// methods build, sign, and broadcast using that context.
//
// On-chain mapping: MsgRegisterPQCKeyV2 { sender, public_key, algorithm_id,
// ecdsa_pubkey, key_type } at /qorechain.pqc.v1.MsgRegisterPQCKeyV2 (the chain's
// classical-exempt bootstrap path), and MsgMigratePQCKey at
// /qorechain.pqc.v1.MsgMigratePQCKey. Registration status is read via
// qor_getPQCKeyStatus.
package pqcdx

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"

	sdk "github.com/cosmos/cosmos-sdk/types"
	"golang.org/x/crypto/sha3"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/accounts"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/messages"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/pqc"
	pqcv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/pqc/v1"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/query"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/signbytes"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/tx"
)

// Message type URLs for the x/pqc messages this helper builds.
const (
	// MsgRegisterPQCKeyTypeURL is the type URL of the legacy (v1) PQC key
	// registration message.
	MsgRegisterPQCKeyTypeURL = "/qorechain.pqc.v1.MsgRegisterPQCKey"
	// MsgRegisterPQCKeyV2TypeURL is the type URL of the current PQC key
	// registration message (explicit algorithm_id; the chain's classical-exempt
	// bootstrap path). This is what the helpers in this package broadcast.
	MsgRegisterPQCKeyV2TypeURL = "/qorechain.pqc.v1.MsgRegisterPQCKeyV2"
	// MsgMigratePQCKeyTypeURL is the type URL of the PQC key migration message.
	MsgMigratePQCKeyTypeURL = "/qorechain.pqc.v1.MsgMigratePQCKey"
)

// DefaultKeyType is the key_type recorded on MsgRegisterPQCKeyV2 when the
// caller does not set RegisterOptions.KeyType. "hybrid" (classical + PQC) is
// what the chain's bootstrap registration path expects.
const DefaultKeyType = "hybrid"

// QorRPC is the subset of query.QorClient used to read PQC key status. The
// concrete *query.QorClient satisfies it.
type QorRPC interface {
	GetPQCKeyStatus(address string) (json.RawMessage, error)
}

// Status is the decoded result of qor_getPQCKeyStatus for an address.
type Status struct {
	// Registered reports whether the address has a PQC key on chain.
	Registered bool
	// AlgorithmID is the registered algorithm identifier (0 when unregistered;
	// 1 = Dilithium-5 / ML-DSA-87).
	AlgorithmID uint8
	// Pubkey is the registered PQC public key bytes (nil when unregistered).
	Pubkey []byte
	// PossessionProven reports whether the key was proven by a proof of
	// possession (chain v3.2.4): a registration carrying a valid proof, or a
	// rotation or migration. False for a key registered without one; nil on
	// nodes below v3.2.4 and over qor_getPQCKeyStatus. Read over REST only.
	PossessionProven *bool
}

// statusWire tolerantly decodes the qor_getPQCKeyStatus response. The chain
// reports the field under one of a few common names, and the public key may
// arrive as base64 (std or URL-safe) or hex (optional 0x); all are accepted.
type statusWire struct {
	Registered   *bool    `json:"registered"`
	IsRegistered *bool    `json:"is_registered"`
	HasKey       *bool    `json:"has_key"`
	HasPQCKey    *bool    `json:"has_pqc_key"`
	AlgorithmID  *uint8   `json:"algorithm_id"`
	AlgID        *uint8   `json:"algorithm"`
	Pubkey       keyField `json:"pubkey"`
	PublicKey    keyField `json:"public_key"`
}

// keyField is a public key carried as a JSON string, hex (optional 0x prefix)
// or base64 (std or URL-safe, padded or not). Anything else, or a string that
// does not decode, reads as no key rather than failing the whole answer.
type keyField []byte

func (k *keyField) UnmarshalJSON(data []byte) error {
	var str string
	if err := json.Unmarshal(data, &str); err != nil {
		*k = nil
		return nil
	}
	*k = decodeKeyString(str)
	return nil
}

// decodeKeyString decodes a hex (optional 0x) or base64 (std / URL-safe) key;
// nil when empty or undecodable.
func decodeKeyString(str string) []byte {
	if str == "" {
		return nil
	}
	h := strings.TrimPrefix(strings.TrimPrefix(str, "0x"), "0X")
	if len(h)%2 == 0 && h != "" {
		if b, err := hex.DecodeString(h); err == nil {
			return b
		}
	}
	std := strings.TrimRight(strings.NewReplacer("-", "+", "_", "/").Replace(str), "=")
	if b, err := base64.RawStdEncoding.DecodeString(std); err == nil && len(b) > 0 {
		return b
	}
	return nil
}

func (w statusWire) toStatus() Status {
	s := Status{}
	switch {
	case w.Registered != nil:
		s.Registered = *w.Registered
	case w.IsRegistered != nil:
		s.Registered = *w.IsRegistered
	case w.HasKey != nil:
		s.Registered = *w.HasKey
	case w.HasPQCKey != nil:
		s.Registered = *w.HasPQCKey
	}
	switch {
	case w.AlgorithmID != nil:
		s.AlgorithmID = *w.AlgorithmID
	case w.AlgID != nil:
		s.AlgorithmID = *w.AlgID
	}
	switch {
	case len(w.Pubkey) > 0:
		s.Pubkey = w.Pubkey
	case len(w.PublicKey) > 0:
		s.Pubkey = w.PublicKey
	}
	// A non-empty key implies registration even if the boolean flag is absent.
	if !s.Registered && len(s.Pubkey) > 0 {
		s.Registered = true
	}
	return s
}

// GetPQCStatus reads the PQC key registration status for an address via
// qor_getPQCKeyStatus and decodes it into a Status.
func GetPQCStatus(client QorRPC, address string) (Status, error) {
	if client == nil {
		return Status{}, fmt.Errorf("pqcdx: GetPQCStatus requires a QorRPC client")
	}
	raw, err := client.GetPQCKeyStatus(address)
	if err != nil {
		return Status{}, err
	}
	var wire statusWire
	if err := json.Unmarshal(raw, &wire); err != nil {
		return Status{}, fmt.Errorf("pqcdx: decode qor_getPQCKeyStatus: %w", err)
	}
	// No answer is not "not registered": reading it that way makes a client
	// re-register a key the chain already has, and pay the fee each time.
	if wire.Registered == nil && wire.IsRegistered == nil && wire.HasKey == nil && wire.HasPQCKey == nil &&
		len(wire.Pubkey) == 0 && len(wire.PublicKey) == 0 {
		return Status{}, fmt.Errorf("pqcdx: qor_getPQCKeyStatus gave no usable answer for %s; cannot tell whether a PQC key is registered", address)
	}
	return wire.toStatus(), nil
}

// registeredCache holds positive answers per (restURL, address), with the
// registered key so a cached answer can still be compared with a keypair.
var (
	registeredMu    sync.Mutex
	registeredCache = map[string]Status{}
)

func statusCacheKey(restURL, address string) string {
	return strings.TrimRight(restURL, "/") + "|" + address
}

// forgetStatus drops one cached answer, so the next read asks the chain.
func forgetStatus(restURL, address string) {
	registeredMu.Lock()
	delete(registeredCache, statusCacheKey(restURL, address))
	registeredMu.Unlock()
}

func cloneStatus(s Status) Status {
	s.Pubkey = bytes.Clone(s.Pubkey)
	if s.PossessionProven != nil {
		v := *s.PossessionProven
		s.PossessionProven = &v
	}
	return s
}

// FetchPQCStatus reads the PQC registration status over REST
// (GET {restURL}/qorechain/pqc/v1/account/{address}), the route every public
// endpoint serves (the qor_* JSON-RPC namespace is not exposed publicly).
//
// The chain answers {"found": false} for an account without a key. Anything
// that is not a readable "found" — an HTTP error, a missing field, a transport
// failure — is UNKNOWN: retried once, then returned as an error. It is never
// read as "not registered". A positive answer is cached per (restURL, address),
// registered key included.
func FetchPQCStatus(restURL, address string) (Status, error) {
	base := strings.TrimRight(restURL, "/")
	key := statusCacheKey(base, address)
	registeredMu.Lock()
	cached, ok := registeredCache[key]
	registeredMu.Unlock()
	if ok {
		return cloneStatus(cached), nil
	}
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		raw, err := query.NewRestClient(base, nil).GetPQCAccount(address)
		if err != nil {
			lastErr = err
			continue
		}
		var body struct {
			Found   *bool `json:"found"`
			Account *struct {
				AlgorithmID      *uint8   `json:"algorithm_id"`
				PublicKey        keyField `json:"public_key"`
				PossessionProven *bool    `json:"possession_proven"`
			} `json:"account"`
		}
		if err := json.Unmarshal(raw, &body); err != nil || body.Found == nil {
			lastErr = fmt.Errorf(`no "found" field in the answer for %s`, address)
			continue
		}
		if !*body.Found {
			return Status{}, nil
		}
		s := Status{Registered: true}
		if body.Account != nil {
			if body.Account.AlgorithmID != nil {
				s.AlgorithmID = *body.Account.AlgorithmID
			}
			s.Pubkey = body.Account.PublicKey
			s.PossessionProven = body.Account.PossessionProven
		}
		registeredMu.Lock()
		registeredCache[key] = cloneStatus(s)
		registeredMu.Unlock()
		return s, nil
	}
	return Status{}, fmt.Errorf("pqcdx: cannot tell whether %s has a registered PQC key: %w", address, lastErr)
}

// ClearPQCStatusCache forgets cached registration answers (tests, network
// switches).
func ClearPQCStatusCache() {
	registeredMu.Lock()
	registeredCache = map[string]Status{}
	registeredMu.Unlock()
}

// PQCStatusPublicKey returns the registered public key a Status carries, or nil
// when it carries none. (Both readers decode the key the chain sends, base64
// over REST or hex/base64 over qor_getPQCKeyStatus, into Status.Pubkey.)
func PQCStatusPublicKey(s Status) []byte {
	if len(s.Pubkey) == 0 {
		return nil
	}
	return s.Pubkey
}

// IsRegisteredPQCKey reports whether the key a Status reports registered is
// publicKey. known is false when the status is registered but carries no key
// to compare; an unregistered status is (false, true).
func IsRegisteredPQCKey(s Status, publicKey []byte) (match, known bool) {
	if !s.Registered {
		return false, true
	}
	registered := PQCStatusPublicKey(s)
	if registered == nil {
		return false, false
	}
	return bytes.Equal(registered, publicKey), true
}

// KindPQCKeyMismatch is PQCKeyMismatchError's Kind.
const KindPQCKeyMismatch = "pqc_key_mismatch"

// PQCKeyMismatchError is returned by EnsurePQCRegistered (and MigrateToHybrid)
// when the account already has a PQC key and it is NOT the Signer's PQCKeypair.
// Nothing is broadcast: the chain refuses a second registration after charging
// the fee, and every hybrid transaction signed with the Signer's key would be
// refused. Sign with the keypair that registered the account, or rotate its key
// (MsgRotatePQCKey).
type PQCKeyMismatchError struct {
	// Address is the account.
	Address string
	// RegisteredPublicKey is the key registered on chain.
	RegisteredPublicKey []byte
	// PublicKey is the caller's key.
	PublicKey []byte
}

// Kind is a short stable identifier for the error (KindPQCKeyMismatch).
func (e *PQCKeyMismatchError) Kind() string { return KindPQCKeyMismatch }

func (e *PQCKeyMismatchError) Error() string {
	return fmt.Sprintf("%s already has a different PQC key registered (registered %s, this keypair %s). "+
		"Nothing was sent. Sign with the keypair that registered the account, or rotate its key with MsgRotatePQCKey.",
		e.Address, keyFingerprint(e.RegisteredPublicKey), keyFingerprint(e.PublicKey))
}

// keyFingerprint is the first 8 bytes of SHAKE-256(key), hex: enough to tell
// two keys apart in a message.
func keyFingerprint(key []byte) string {
	out := make([]byte, 8)
	sha3.ShakeSum256(out, key)
	return hex.EncodeToString(out)
}

// isAlreadyRegistered reports the chain's refusal of a second registration
// (pqc 7): not an error for a helper whose job is "make sure it is registered".
func isAlreadyRegistered(code uint32, codespace, rawLog string) bool {
	if strings.Contains(strings.ToLower(rawLog), "pqc account already registered") {
		return true
	}
	return codespace == "pqc" && code == 7
}

// IsPQCRegistered reports whether an address has a PQC key registered, via
// qor_getPQCKeyStatus.
func IsPQCRegistered(client QorRPC, address string) (bool, error) {
	s, err := GetPQCStatus(client, address)
	if err != nil {
		return false, err
	}
	return s.Registered, nil
}

// Signer carries the signing context EnsurePQCRegistered / MigrateToHybrid need
// to build, sign, and broadcast a transaction. It mirrors the crossvm helper's
// Signer: the account number / sequence / chain id / fee are supplied explicitly
// (as everywhere else in tx.*). The sender address is taken from Account.Address.
type Signer struct {
	// Account is the native secp256k1 signer. Its PublicKey (33-byte compressed
	// secp256k1 key) is recorded as the message's ecdsa_pubkey.
	Account accounts.Secp256k1Account
	// PQCKeypair is the signer's ML-DSA-87 (Dilithium-5) keypair. Its PublicKey
	// is recorded as the message's dilithium_pubkey, and the secret key is used
	// for hybrid signing in MigrateToHybrid.
	PQCKeypair pqc.Keypair
	// ChainID is the chain id (e.g. "qorechain-vladi").
	ChainID string
	// RestURL is the REST (LCD) base URL used to broadcast.
	RestURL string
	// AccountNumber is the signer's on-chain account number.
	AccountNumber uint64
	// Sequence is the signer's current account sequence (nonce).
	Sequence uint64
	// Fee is the explicit fee to pay.
	Fee tx.Fee
	// Mode is the broadcast mode (defaults to tx.BroadcastSync).
	Mode tx.BroadcastMode
	// Wait configures post-broadcast polling (zero values use sensible defaults).
	Wait tx.WaitOptions
	// SignBytesVersion selects the hybrid sign-bytes form MigrateToHybrid signs
	// (see package signbytes). Empty / signbytes.Auto (the default) resolves it
	// per network against RestURL and re-signs once if the chain refuses the
	// hybrid signature (pqc code 21); signbytes.V1 / signbytes.V2 force a form
	// and are never retried.
	SignBytesVersion signbytes.Version
	// SignBytesResolver resolves SignBytesVersion when it is Auto. Nil uses
	// signbytes.DefaultResolver.
	SignBytesResolver *signbytes.Resolver
}

// Client is the high-level PQC DX helper bound to a Signer and a status reader.
type Client struct {
	signer Signer
	qor    QorRPC
}

// Options configures New.
type Options struct {
	// Qor is the qor_* JSON-RPC client used to read registration status
	// (qor_getPQCKeyStatus). Required for EnsurePQCRegistered's idempotency check.
	Qor QorRPC
}

// New creates a PQC DX helper bound to a Signer.
func New(signer Signer, opts Options) *Client {
	return &Client{signer: signer, qor: opts.Qor}
}

// Address returns the signer's native address.
func (c *Client) Address() string { return c.signer.Account.Address }

// Status reads the signer's own PQC registration status.
//
// It reads REST from Signer.RestURL (every public endpoint serves it); the
// qor_* JSON-RPC client is only used when no REST URL is set.
func (c *Client) Status() (Status, error) {
	if c.signer.RestURL != "" {
		return FetchPQCStatus(c.signer.RestURL, c.signer.Account.Address)
	}
	return GetPQCStatus(c.qor, c.signer.Account.Address)
}

// RegisterOptions tune EnsurePQCRegistered.
type RegisterOptions struct {
	// KeyType is the key_type recorded on MsgRegisterPQCKeyV2. Empty uses
	// DefaultKeyType.
	KeyType string
	// Force skips the qor_getPQCKeyStatus pre-check and always broadcasts the
	// registration message. Use when status is already known to be unregistered.
	Force bool
	// ProofOfPossession is the key's proof of possession (chain v3.2.3), from
	// messages.SignProofOfPossession. Optional on the chain today and due to
	// become mandatory. A node below v3.2.3 refuses the whole transaction when
	// it is set, so set it only once the network has applied v3.2.3.
	// EnsurePQCRegistered signs it itself when Signer.RestURL is set and the
	// network has applied v3.2.3; set it here to override.
	ProofOfPossession []byte
}

// EnsureResult reports the outcome of EnsurePQCRegistered.
type EnsureResult struct {
	// AlreadyRegistered is true when the address already had a PQC key and no
	// transaction was broadcast.
	AlreadyRegistered bool
	// KeyVerified reports, when AlreadyRegistered is true, whether the
	// registered key was compared with Signer.PQCKeypair and matched. It is
	// false only when the account has a key and no answer carried it (a
	// qor_getPQCKeyStatus answer without the key, and no Signer.RestURL to read
	// it from): the key could not be checked, so do not assume it is yours.
	// Always false when a registration was sent.
	KeyVerified bool
	// TxHash is the registration tx hash. Empty when AlreadyRegistered is true.
	TxHash string
}

// registerMessage builds the MsgRegisterPQCKeyV2 for the signer.
func (c *Client) registerMessage(keyType string, proofOfPossession []byte) (*pqcv1.MsgRegisterPQCKeyV2, error) {
	if len(c.signer.PQCKeypair.PublicKey) == 0 {
		return nil, fmt.Errorf("pqcdx: Signer.PQCKeypair.PublicKey is required to register")
	}
	if len(c.signer.Account.PublicKey) == 0 {
		return nil, fmt.Errorf("pqcdx: Signer.Account.PublicKey is required to register")
	}
	if keyType == "" {
		keyType = DefaultKeyType
	}
	// From chain v3.2.2 an ecdsa_pubkey that is not the sender's is refused
	// after the fee is charged; catch it here. Not network-gated: such a key is
	// wrong anywhere.
	if _, err := messages.ValidateClassicalKeyForSender(c.signer.Account.Address, c.signer.Account.PublicKey); err != nil {
		return nil, fmt.Errorf("pqcdx: %w", err)
	}
	// From chain v3.2.3 a classical_only, empty or degenerate key is refused
	// after the fee; such a registration is wrong on any network.
	if err := messages.ValidateRegisteredPQCKey(keyType, c.signer.PQCKeypair.PublicKey); err != nil {
		return nil, fmt.Errorf("pqcdx: %w", err)
	}
	msg := messages.Pqc.RegisterKeyV2(
		c.signer.Account.Address,
		c.signer.PQCKeypair.PublicKey,
		pqcv1.AlgorithmID(pqc.AlgorithmDilithium5),
		c.signer.Account.PublicKey,
		keyType,
	)
	msg.ProofOfPossession = proofOfPossession
	return msg, nil
}

// EnsurePQCRegistered ensures the signer's PQC key is registered on chain. It is
// idempotent: unless RegisterOptions.Force is set, it first reads the status
// (Client.Status: REST from Signer.RestURL); an unreadable status is an error,
// never a blind registration (the chain charges the fee before refusing a second
// one). When the account already has a key it compares it with
// Signer.PQCKeypair: the same key returns AlreadyRegistered without
// broadcasting; a different key returns a *PQCKeyMismatchError and nothing is
// sent, since every hybrid transaction signed with the Signer's key would be
// refused. A status that carries no public key is re-read uncached over REST
// (Signer.RestURL); when there is no REST URL either, the result says
// KeyVerified false instead of claiming the key is yours. Otherwise it builds and
// broadcasts a MsgRegisterPQCKeyV2 carrying the signer's Dilithium and ECDSA
// public keys. A refusal as "already registered" (pqc 7) counts as
// AlreadyRegistered, after the same key comparison; any other non-zero code is
// returned as a *tx.QoreTxError.
func (c *Client) EnsurePQCRegistered(opts RegisterOptions) (EnsureResult, error) {
	if !opts.Force {
		s, err := c.Status()
		if err != nil {
			return EnsureResult{}, err
		}
		if s.Registered {
			// Registered, but by whom? A different key means the Signer's hybrid
			// transactions would all be refused; say so now rather than "done".
			match, known := IsRegisteredPQCKey(s, c.signer.PQCKeypair.PublicKey)
			switch {
			case known && !match:
				if err := c.checkStillMismatched(s); err != nil {
					return EnsureResult{}, err
				}
				match = true
			case !known && c.signer.RestURL != "":
				// The answer carried no key: read it over REST rather than
				// take "registered" for "yours".
				forgetStatus(c.signer.RestURL, c.signer.Account.Address)
				fresh, err := FetchPQCStatus(c.signer.RestURL, c.signer.Account.Address)
				if err != nil {
					return EnsureResult{}, err
				}
				if err := c.mismatchError(fresh); err != nil {
					return EnsureResult{}, err
				}
				match, _ = IsRegisteredPQCKey(fresh, c.signer.PQCKeypair.PublicKey)
			}
			return EnsureResult{AlreadyRegistered: true, KeyVerified: match}, nil
		}
	}
	// From chain v3.2.3 the registration carries a proof that the registrant
	// holds the key. Sign it once the network has applied v3.2.3, never before:
	// a node below it refuses the whole transaction for the field.
	pop := opts.ProofOfPossession
	if len(pop) == 0 && c.signer.RestURL != "" {
		applied, err := query.NewRestClient(c.signer.RestURL, nil).IsUpgradeApplied(query.ChainUpgradeV3_2_3)
		if err != nil {
			return EnsureResult{}, fmt.Errorf("pqcdx: cannot tell whether the network applied v3.2.3: %w", err)
		}
		if applied {
			if pop, err = messages.SignProofOfPossession(c.signer.ChainID, c.signer.Account.Address, c.signer.PQCKeypair); err != nil {
				return EnsureResult{}, err
			}
		}
	}
	msg, err := c.registerMessage(opts.KeyType, pop)
	if err != nil {
		return EnsureResult{}, err
	}
	res, err := c.broadcast([]sdk.Msg{msg})
	if err != nil {
		var txErr *tx.QoreTxError
		if errors.As(err, &txErr) && isAlreadyRegistered(txErr.Code, txErr.Codespace, txErr.RawLog) {
			return c.registeredMeanwhile()
		}
		return EnsureResult{}, err
	}
	if res.Code != 0 {
		if isAlreadyRegistered(res.Code, res.Codespace, res.RawLog) {
			return c.registeredMeanwhile()
		}
		// Any other refusal is a failure, never a registration.
		txErr := tx.DecodeTxError(res.Code, res.Codespace, res.RawLog)
		txErr.TxHash = res.TxHash
		return EnsureResult{}, txErr
	}
	return EnsureResult{TxHash: res.TxHash}, nil
}

// checkStillMismatched handles a status that says "registered, with another
// key". When it came over REST it is read once more uncached (a rotation may
// have just landed) before returning the mismatch.
func (c *Client) checkStillMismatched(s Status) error {
	current := s
	if c.signer.RestURL != "" {
		forgetStatus(c.signer.RestURL, c.signer.Account.Address)
		var err error
		if current, err = FetchPQCStatus(c.signer.RestURL, c.signer.Account.Address); err != nil {
			return err
		}
	}
	return c.mismatchError(current)
}

// registeredMeanwhile handles the chain's "already registered" refusal (a race,
// or a stale answer): not an error for a helper whose job is "make sure it is
// registered", unless the key now registered is not the Signer's.
func (c *Client) registeredMeanwhile() (EnsureResult, error) {
	if c.signer.RestURL != "" {
		forgetStatus(c.signer.RestURL, c.signer.Account.Address)
		now, err := FetchPQCStatus(c.signer.RestURL, c.signer.Account.Address)
		if err != nil {
			return EnsureResult{}, err
		}
		if err := c.mismatchError(now); err != nil {
			return EnsureResult{}, err
		}
		match, _ := IsRegisteredPQCKey(now, c.signer.PQCKeypair.PublicKey)
		return EnsureResult{AlreadyRegistered: true, KeyVerified: match}, nil
	}
	// Nothing to read the key from: registered, but not verified as the Signer's.
	return EnsureResult{AlreadyRegistered: true}, nil
}

// mismatchError is a *PQCKeyMismatchError when s is registered with a key other
// than the Signer's, else nil.
func (c *Client) mismatchError(s Status) error {
	if !s.Registered {
		return nil
	}
	if match, known := IsRegisteredPQCKey(s, c.signer.PQCKeypair.PublicKey); known && !match {
		return &PQCKeyMismatchError{
			Address:             c.signer.Account.Address,
			RegisteredPublicKey: PQCStatusPublicKey(s),
			PublicKey:           c.signer.PQCKeypair.PublicKey,
		}
	}
	return nil
}

// BuildRegister builds and signs the MsgRegisterPQCKeyV2 WITHOUT broadcasting,
// returning the BuiltTx. It does not check current status.
func (c *Client) BuildRegister(opts RegisterOptions) (*tx.BuiltTx, error) {
	msg, err := c.registerMessage(opts.KeyType, opts.ProofOfPossession)
	if err != nil {
		return nil, err
	}
	return c.build([]sdk.Msg{msg})
}

// MigrateOptions tune MigratePQCKey.
type MigrateOptions struct {
	// OldPublicKey is the previously registered PQC public key.
	OldPublicKey []byte
	// NewPublicKey is the replacement PQC public key.
	NewPublicKey []byte
	// NewAlgorithmID is the replacement algorithm identifier (e.g.
	// pqc.AlgorithmDilithium5).
	NewAlgorithmID uint8
	// OldSignature proves control of the old key: the old secret key's signature
	// over the migration sign-bytes, built with signbytes.Migration in the form
	// the target network verifies (v2 binds chain id, account, algorithms,
	// execution height and BOTH public keys; v1 is the legacy ASCII string).
	OldSignature []byte
	// NewSignature proves control of the new key: the new secret key's
	// signature over the same migration sign-bytes.
	NewSignature []byte
}

// migrateMessage builds the MsgMigratePQCKey for the signer.
func (c *Client) migrateMessage(o MigrateOptions) (*pqcv1.MsgMigratePQCKey, error) {
	if len(o.NewPublicKey) == 0 {
		return nil, fmt.Errorf("pqcdx: MigrateOptions.NewPublicKey is required")
	}
	if len(o.OldSignature) == 0 || len(o.NewSignature) == 0 {
		return nil, fmt.Errorf("pqcdx: MigrateOptions requires OldSignature and NewSignature")
	}
	return messages.Pqc.MigrateKey(
		c.signer.Account.Address,
		o.OldPublicKey,
		o.NewPublicKey,
		pqcv1.AlgorithmID(o.NewAlgorithmID),
		o.OldSignature,
		o.NewSignature,
	), nil
}

// MigratePQCKey builds, signs CLASSICALLY, and broadcasts a MsgMigratePQCKey,
// rotating the account's registered PQC key to a new key (and optionally a new
// algorithm).
//
// Deprecated: from chain v3.2.3 (and in the mempool of every v3.2.3 node) an
// account that has a PQC key must send MsgMigratePQCKey with the hybrid
// signature; a classical one is refused (pqc 234). Use MigratePQCKeyHybrid.
func (c *Client) MigratePQCKey(o MigrateOptions) (*tx.TxResult, error) {
	msg, err := c.migrateMessage(o)
	if err != nil {
		return nil, err
	}
	return c.broadcast([]sdk.Msg{msg})
}

// MigratePQCKeyHybrid rotates the account's PQC key with the hybrid signature
// the chain requires from v3.2.3 for an account that has a key. The Signer's
// PQCKeypair must be the CURRENTLY registered key (the one being rotated out):
// the transaction's hybrid signature is verified against it. Works on every
// network, before and after v3.2.3.
func (c *Client) MigratePQCKeyHybrid(o MigrateOptions) (*MigrateToHybridResult, error) {
	msg, err := c.migrateMessage(o)
	if err != nil {
		return nil, err
	}
	return c.MigrateToHybrid([]sdk.Msg{msg}, MigrateToHybridOptions{})
}

// BuildMigratePQCKey builds and signs a MsgMigratePQCKey WITHOUT broadcasting.
func (c *Client) BuildMigratePQCKey(o MigrateOptions) (*tx.BuiltTx, error) {
	msg, err := c.migrateMessage(o)
	if err != nil {
		return nil, err
	}
	return c.build([]sdk.Msg{msg})
}

// MigrateOptionsHybrid tune MigrateToHybrid.
type MigrateToHybridOptions struct {
	// Register controls the pre-flight registration: when set, MigrateToHybrid
	// runs EnsurePQCRegistered with these options first.
	Register RegisterOptions
	// IncludePQCPublicKey embeds the signer's Dilithium public key in the hybrid
	// signature extension (B-mode). Leave false for the B0 contract (no embedded
	// public key) when the chain already knows the key.
	IncludePQCPublicKey bool
}

// MigrateToHybridResult reports the outcome of MigrateToHybrid.
type MigrateToHybridResult struct {
	// AlreadyRegistered mirrors EnsureResult.AlreadyRegistered from the pre-flight
	// registration step.
	AlreadyRegistered bool
	// RegisterTxHash is the registration tx hash (empty when AlreadyRegistered).
	RegisterTxHash string
	// Result is the confirmed hybrid transaction result.
	Result *tx.TxResult
	// SignBytesVersion is the hybrid sign-bytes form the accepted tx used.
	SignBytesVersion signbytes.Version
	// Retried is true when the first hybrid attempt was refused (pqc code 21)
	// and the tx was re-signed under a freshly resolved version.
	Retried bool
}

// MigrateToHybrid is the one-call "go quantum-safe" path: it ensures the signer's
// PQC key is registered (returning EnsurePQCRegistered's *PQCKeyMismatchError
// when the account holds a different key), then builds and broadcasts the given messages as a
// hybrid (classical + ML-DSA-87) transaction using the signer's PQC keypair.
//
// The messages are any module messages (e.g. a bank send from the composers);
// they are sent under the hybrid signature so the account's first hybrid tx and
// its registration can be sequenced without hand-wiring tx.BuildHybridMessages.
//
// The hybrid half goes through tx.BroadcastHybridAndWait: the sign-bytes form
// (v1/v2) is resolved per network from Signer.SignBytesVersion (default auto,
// asked of Signer.RestURL), and an auto-resolved tx refused with pqc code 21 is
// re-signed once under a freshly resolved version.
func (c *Client) MigrateToHybrid(msgs []sdk.Msg, opts MigrateToHybridOptions) (*MigrateToHybridResult, error) {
	if len(msgs) == 0 {
		return nil, fmt.Errorf("pqcdx: MigrateToHybrid requires at least one message")
	}
	if len(c.signer.PQCKeypair.SecretKey) == 0 {
		return nil, fmt.Errorf("pqcdx: Signer.PQCKeypair.SecretKey is required for hybrid signing")
	}
	ensure, err := c.EnsurePQCRegistered(opts.Register)
	if err != nil {
		return nil, err
	}
	// When a registration tx was broadcast in the same flow, advance the local
	// sequence so the subsequent hybrid tx signs over the next nonce.
	sequence := c.signer.Sequence
	if !ensure.AlreadyRegistered {
		sequence++
	}
	out, err := tx.BroadcastHybridAndWait(tx.BroadcastHybridParams{
		Build: tx.BuildHybridMessagesParams{
			Account:             c.signer.Account,
			PQCKeypair:          c.signer.PQCKeypair,
			Messages:            msgs,
			Fee:                 c.signer.Fee,
			ChainID:             c.signer.ChainID,
			AccountNumber:       c.signer.AccountNumber,
			Sequence:            sequence,
			IncludePQCPublicKey: opts.IncludePQCPublicKey,
			SignBytesVersion:    c.signer.SignBytesVersion,
		},
		RestURL:  c.signer.RestURL,
		Mode:     c.signer.Mode,
		Wait:     c.signer.Wait,
		Resolver: c.signer.SignBytesResolver,
	})
	if err != nil {
		return nil, err
	}
	return &MigrateToHybridResult{
		AlreadyRegistered: ensure.AlreadyRegistered,
		RegisterTxHash:    ensure.TxHash,
		Result:            out.Result,
		SignBytesVersion:  out.Built.SignBytesVersion,
		Retried:           out.Retried,
	}, nil
}

// build signs the given messages into a BuiltTx using the helper's Signer
// (classical secp256k1 signature).
func (c *Client) build(msgs []sdk.Msg) (*tx.BuiltTx, error) {
	return tx.SendMessages(tx.SendMessagesParams{
		Account:       c.signer.Account,
		Messages:      msgs,
		Fee:           c.signer.Fee,
		ChainID:       c.signer.ChainID,
		AccountNumber: c.signer.AccountNumber,
		Sequence:      c.signer.Sequence,
	})
}

// broadcast builds, signs (classical), and broadcasts the given messages, waiting
// for inclusion.
func (c *Client) broadcast(msgs []sdk.Msg) (*tx.TxResult, error) {
	built, err := c.build(msgs)
	if err != nil {
		return nil, err
	}
	return c.broadcastBuilt(built)
}

// broadcastBuilt broadcasts an already-built tx and waits for inclusion.
func (c *Client) broadcastBuilt(built *tx.BuiltTx) (*tx.TxResult, error) {
	mode := c.signer.Mode
	if mode == "" {
		mode = tx.BroadcastSync
	}
	return tx.BroadcastAndWait(tx.BroadcastAndWaitParams{
		RestURL: c.signer.RestURL,
		TxBytes: built.TxRawBytes,
		Mode:    mode,
		Wait:    c.signer.Wait,
	})
}
