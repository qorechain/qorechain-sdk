package query

import (
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"strings"
)

// AuthNonce is a linked authenticator key's sequence (chain v3.2.4), from
// GetAuthNonce.
type AuthNonce struct {
	// Nonce is the nonce the next MsgExecuteEVM / MsgExecuteCosmos from this
	// key must carry. A key that never executed reads 0.
	Nonce uint64
	// Linked reports whether the key is currently linked (present and not
	// revoked); the counter is kept either way.
	Linked bool
}

// AuthNoncePath is the REST route of one key's authenticator sequence. pubkeyHex
// is sent as given.
func AuthNoncePath(address, pubkeyHex string) string {
	return "/qorechain/abstractaccount/v1/auth_nonce/" + url.PathEscape(address) + "/" + pubkeyHex
}

// GetAuthNonce reads the sequence the linked authenticator key pubkey must sign
// next for address (qor1…). This is the nonce of
// authenticator.EVMAuthSignBytes / EVMAuthSignBytesV2 / CosmosAuthSignBytes:
// the key's own counter, not the account's EVM nonce.
func (c *RestClient) GetAuthNonce(address string, pubkey []byte) (*AuthNonce, error) {
	if len(pubkey) == 0 {
		return nil, errors.New("auth_nonce: pubkey must be bytes or a hex string")
	}
	return c.getAuthNonce(address, hex.EncodeToString(pubkey))
}

// GetAuthNonceHex is GetAuthNonce with the public key as hex (0x optional). A
// key that is empty, not hex or of odd length is refused before any request.
func (c *RestClient) GetAuthNonceHex(address, pubkeyHex string) (*AuthNonce, error) {
	h := strings.TrimPrefix(strings.TrimPrefix(pubkeyHex, "0x"), "0X")
	if _, err := hex.DecodeString(h); err != nil || h == "" {
		return nil, errors.New("auth_nonce: pubkey must be bytes or a hex string")
	}
	return c.getAuthNonce(address, h)
}

func (c *RestClient) getAuthNonce(address, pubkeyHex string) (*AuthNonce, error) {
	raw, err := c.Get(AuthNoncePath(address, pubkeyHex), nil)
	if err != nil {
		return nil, err
	}
	return ParseAuthNonce(raw)
}

// ParseAuthNonce decodes an auth_nonce response body. An answer without a
// nonce is an error, never a zero.
func ParseAuthNonce(raw []byte) (*AuthNonce, error) {
	const route = "auth_nonce"
	f, err := decodeFields(raw, route)
	if err != nil {
		return nil, err
	}
	if n, ok := f["nonce"]; !ok || string(n) == "null" {
		return nil, fmt.Errorf("auth_nonce: no nonce in the answer")
	}
	r := &fieldReader{f: f, route: route}
	out := &AuthNonce{Nonce: r.u64("nonce"), Linked: r.boolean("linked")}
	if r.err != nil {
		return nil, r.err
	}
	return out, nil
}
