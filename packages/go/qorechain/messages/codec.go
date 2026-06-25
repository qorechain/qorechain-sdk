package messages

import (
	"fmt"

	"cosmossdk.io/x/tx/signing"
	"github.com/cosmos/cosmos-sdk/client"
	"github.com/cosmos/cosmos-sdk/codec"
	"github.com/cosmos/cosmos-sdk/codec/address"
	codectypes "github.com/cosmos/cosmos-sdk/codec/types"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/cosmos/cosmos-sdk/x/auth/tx"
	"github.com/cosmos/gogoproto/proto"
)

// Bech32 human-readable prefixes used by QoreChain addresses, mirrored here so
// the signing-aware InterfaceRegistry can decode signer addresses.
const (
	accountPrefix   = "qor"
	validatorPrefix = "qorvaloper"
)

// NewInterfaceRegistry builds an InterfaceRegistry with the QoreChain bech32
// address codecs and registers every QoreChain + standard Cosmos Msg
// implementation into it.
func NewInterfaceRegistry() codectypes.InterfaceRegistry {
	reg, err := codectypes.NewInterfaceRegistryWithOptions(codectypes.InterfaceRegistryOptions{
		ProtoFiles: proto.HybridResolver,
		SigningOptions: signing.Options{
			AddressCodec:          address.NewBech32Codec(accountPrefix),
			ValidatorAddressCodec: address.NewBech32Codec(validatorPrefix),
		},
	})
	if err != nil {
		// The options above are static and valid; a failure indicates a build-time
		// programming error rather than a runtime condition.
		panic(fmt.Errorf("build interface registry: %w", err))
	}
	RegisterInterfaces(reg)
	return reg
}

// NewProtoCodec builds a ProtoCodec over a fully-populated InterfaceRegistry.
func NewProtoCodec() *codec.ProtoCodec {
	return codec.NewProtoCodec(NewInterfaceRegistry())
}

// defaultRegistry is the process-wide default registry used by the convenience
// helpers (PackAny / UnpackAny) and by the tx package. It carries every
// registered QoreChain and Cosmos message.
var defaultRegistry = NewInterfaceRegistry()

// DefaultInterfaceRegistry returns the process-wide default InterfaceRegistry.
func DefaultInterfaceRegistry() codectypes.InterfaceRegistry { return defaultRegistry }

// DefaultProtoCodec returns a ProtoCodec over the default InterfaceRegistry.
func DefaultProtoCodec() *codec.ProtoCodec { return codec.NewProtoCodec(defaultRegistry) }

// NewTxConfig builds a cosmos-sdk TxConfig wired to the default codec, with
// SIGN_MODE_DIRECT enabled. It is used to decode broadcast responses and
// (optionally) to build txs through the standard builder.
func NewTxConfig() client.TxConfig {
	return tx.NewTxConfig(DefaultProtoCodec(), tx.DefaultSignModes)
}

// PackAny packs an sdk.Msg into an Any using the default registry's typeURL
// resolution.
func PackAny(msg sdk.Msg) (*codectypes.Any, error) {
	return codectypes.NewAnyWithValue(msg)
}

// UnpackAny decodes an Any back into a concrete registered sdk.Msg via the
// default registry.
func UnpackAny(any *codectypes.Any) (sdk.Msg, error) {
	var msg sdk.Msg
	if err := defaultRegistry.UnpackAny(any, &msg); err != nil {
		return nil, err
	}
	return msg, nil
}
