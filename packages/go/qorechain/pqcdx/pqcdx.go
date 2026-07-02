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
	"encoding/json"
	"fmt"

	sdk "github.com/cosmos/cosmos-sdk/types"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/accounts"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/messages"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/pqc"
	pqcv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/pqc/v1"
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
}

// statusWire tolerantly decodes the qor_getPQCKeyStatus response. The chain
// reports the field under one of a few common names, and the public key may
// arrive as base64 (Go []byte JSON) or 0x-hex; both are accepted.
type statusWire struct {
	Registered   *bool  `json:"registered"`
	IsRegistered *bool  `json:"is_registered"`
	HasKey       *bool  `json:"has_key"`
	AlgorithmID  *uint8 `json:"algorithm_id"`
	AlgID        *uint8 `json:"algorithm"`
	Pubkey       []byte `json:"pubkey"`
	PublicKey    []byte `json:"public_key"`
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
	return wire.toStatus(), nil
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
func (c *Client) Status() (Status, error) {
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
}

// EnsureResult reports the outcome of EnsurePQCRegistered.
type EnsureResult struct {
	// AlreadyRegistered is true when the address already had a PQC key and no
	// transaction was broadcast.
	AlreadyRegistered bool
	// TxHash is the registration tx hash. Empty when AlreadyRegistered is true.
	TxHash string
}

// registerMessage builds the MsgRegisterPQCKeyV2 for the signer.
func (c *Client) registerMessage(keyType string) (*pqcv1.MsgRegisterPQCKeyV2, error) {
	if len(c.signer.PQCKeypair.PublicKey) == 0 {
		return nil, fmt.Errorf("pqcdx: Signer.PQCKeypair.PublicKey is required to register")
	}
	if len(c.signer.Account.PublicKey) == 0 {
		return nil, fmt.Errorf("pqcdx: Signer.Account.PublicKey is required to register")
	}
	if keyType == "" {
		keyType = DefaultKeyType
	}
	return messages.Pqc.RegisterKeyV2(
		c.signer.Account.Address,
		c.signer.PQCKeypair.PublicKey,
		pqcv1.AlgorithmID(pqc.AlgorithmDilithium5),
		c.signer.Account.PublicKey,
		keyType,
	), nil
}

// EnsurePQCRegistered ensures the signer's PQC key is registered on chain. It is
// idempotent: unless RegisterOptions.Force is set, it first checks
// qor_getPQCKeyStatus and returns AlreadyRegistered without broadcasting when a
// key is present; otherwise it builds and broadcasts a MsgRegisterPQCKeyV2
// carrying the signer's Dilithium and ECDSA public keys.
func (c *Client) EnsurePQCRegistered(opts RegisterOptions) (EnsureResult, error) {
	if !opts.Force {
		s, err := c.Status()
		if err != nil {
			return EnsureResult{}, err
		}
		if s.Registered {
			return EnsureResult{AlreadyRegistered: true}, nil
		}
	}
	msg, err := c.registerMessage(opts.KeyType)
	if err != nil {
		return EnsureResult{}, err
	}
	res, err := c.broadcast([]sdk.Msg{msg})
	if err != nil {
		return EnsureResult{}, err
	}
	return EnsureResult{TxHash: res.TxHash}, nil
}

// BuildRegister builds and signs the MsgRegisterPQCKeyV2 WITHOUT broadcasting,
// returning the BuiltTx. It does not check current status.
func (c *Client) BuildRegister(opts RegisterOptions) (*tx.BuiltTx, error) {
	msg, err := c.registerMessage(opts.KeyType)
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
	// OldSignature proves control of the old key (signature over the migration
	// challenge with the old secret key).
	OldSignature []byte
	// NewSignature proves control of the new key (signature over the migration
	// challenge with the new secret key).
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

// MigratePQCKey builds, signs, and broadcasts a MsgMigratePQCKey, rotating the
// account's registered PQC key to a new key (and optionally a new algorithm).
func (c *Client) MigratePQCKey(o MigrateOptions) (*tx.TxResult, error) {
	msg, err := c.migrateMessage(o)
	if err != nil {
		return nil, err
	}
	return c.broadcast([]sdk.Msg{msg})
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
}

// MigrateToHybrid is the one-call "go quantum-safe" path: it ensures the signer's
// PQC key is registered, then builds and broadcasts the given messages as a
// hybrid (classical + ML-DSA-87) transaction using the signer's PQC keypair.
//
// The messages are any module messages (e.g. a bank send from the composers);
// they are sent under the hybrid signature so the account's first hybrid tx and
// its registration can be sequenced without hand-wiring tx.BuildHybridMessages.
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
	built, err := tx.BuildHybridMessages(tx.BuildHybridMessagesParams{
		Account:             c.signer.Account,
		PQCKeypair:          c.signer.PQCKeypair,
		Messages:            msgs,
		Fee:                 c.signer.Fee,
		ChainID:             c.signer.ChainID,
		AccountNumber:       c.signer.AccountNumber,
		Sequence:            sequence,
		IncludePQCPublicKey: opts.IncludePQCPublicKey,
	})
	if err != nil {
		return nil, err
	}
	res, err := c.broadcastBuilt(built)
	if err != nil {
		return nil, err
	}
	return &MigrateToHybridResult{
		AlreadyRegistered: ensure.AlreadyRegistered,
		RegisterTxHash:    ensure.TxHash,
		Result:            res,
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
