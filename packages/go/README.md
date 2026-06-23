# qorechain-sdk (Go)

Idiomatic Go SDK for QoreChain — network presets, denomination/address utilities,
HD account derivation (native / EVM / SVM), post-quantum (ML-DSA-87) signing, and
read clients for the REST (LCD) and `qor_*` JSON-RPC surfaces.

This is a self-contained Go module within the `qorechain-sdk` monorepo. It mirrors
the TypeScript and Python SDK surfaces. Native transaction building/broadcast is a
follow-up (consistent with the Python SDK).

## Install

```sh
go get github.com/qorechain/qorechain-sdk/packages/go@latest
```

Requires Go 1.22+.

## Packages

| Package | Purpose |
|---|---|
| `qorechain/networks` | Network presets (`testnet` live, `mainnet` placeholder), `GetNetwork`. |
| `qorechain/denom` | `ToBase` / `FromBase` exact big.Int money math. |
| `qorechain/address` | bech32 ⇄ hex conversion and validation. |
| `qorechain/accounts` | BIP-39 mnemonics + HD derivation (native, EVM, SVM). |
| `qorechain/pqc` | ML-DSA-87 (FIPS 204) keygen / sign / verify + hybrid extension. |
| `qorechain/query` | REST client, JSON-RPC client, `qor_*` typed client. |
| `qorechain/client` | `CreateClient` factory composing the read clients + fees. |

## Quickstart

### Create a client

```go
import "github.com/qorechain/qorechain-sdk/packages/go/qorechain/client"

c, err := client.CreateClient(client.Options{}) // defaults to "testnet"
if err != nil {
    panic(err)
}
fmt.Println(c.Network.ChainID) // qorechain-diana

balances, err := c.REST.GetAllBalances("qor15yk64u7zc9g9k2yr2wmzeva5qgwxps6yjecvvu")
stats, err := c.Qor.GetAIStats()
fee, err := c.Fees.Estimate("fast")
```

For a network without built-in endpoints (e.g. mainnet), pass overrides:

```go
c, err := client.CreateClient(client.Options{
    Network: "mainnet",
    Endpoints: client.EndpointOverrides{
        REST:   "https://rest.example",
        EVMRPC: "https://evm.example",
    },
    ChainID: "qorechain-1",
})
```

### Derive accounts

```go
import "github.com/qorechain/qorechain-sdk/packages/go/qorechain/accounts"

mnemonic, _ := accounts.GenerateMnemonic(128)

native, _ := accounts.DeriveNativeAccount(mnemonic, 0) // qor1...
evm, _    := accounts.DeriveEVMAccount(mnemonic, 0)    // 0x... (EIP-55)
svm, _    := accounts.DeriveSVMAccount(mnemonic, 0)    // base58 ed25519
```

Derivation paths: native `m/44'/118'/0'/0/{i}`, EVM `m/44'/60'/0'/0/{i}`,
SVM `m/44'/501'/{i}'/0'`. Invalid mnemonics (wrong checksum) return an error.

### Post-quantum signing

```go
import "github.com/qorechain/qorechain-sdk/packages/go/qorechain/pqc"

kp, _ := pqc.GeneratePQCKeypair()                 // ML-DSA-87: 2592 / 4896
sig, _ := pqc.PQCSign(kp.SecretKey, []byte("..."))// 4627-byte signature
ok := pqc.PQCVerify(kp.PublicKey, []byte("..."), sig)

ext, _ := pqc.BuildHybridSignatureExtension(pqc.AlgorithmDilithium5, sig, kp.PublicKey)
// ext marshals to {"algorithm_id":1,"pqc_signature":"<base64>","pqc_public_key":"<base64>"}
```

### Denomination math

```go
import "github.com/qorechain/qorechain-sdk/packages/go/qorechain/denom"

base, _    := denom.ToBase("1.5", 6)      // "1500000"
display, _ := denom.FromBase("1500000", 6) // "1.5"
```

## Development

```sh
cd packages/go
go build ./...
go test ./...
go vet ./...
gofmt -l .
```
