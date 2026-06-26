# QoreChain Java SDK

Java SDK for QoreChain with full native-chain parity to the TypeScript, Python,
Go, and Rust SDKs:

- **networks** — `Networks.get("testnet" | "mainnet")` presets (`qorechain-diana`
  / `qorechain-vladi`), bech32 prefixes, `QOR`/`uqor` coin, and per-VM endpoints.
- **denom / address** — exact `BigInteger` `toBase`/`fromBase`, bech32 ↔ hex,
  EIP-55 checksum, EVM/SVM address validators.
- **accounts** — HD derivation for native (secp256k1, `m/44'/118'/0'/0/i`), EVM
  (secp256k1, `m/44'/60'/0'/0/i`), and SVM (ed25519 SLIP-0010,
  `m/44'/501'/i'/0'`). BIP-39 mnemonic generation/validation/seed.
- **pqc** — ML-DSA-87 (FIPS-204) keygen / sign / verify via BouncyCastle, plus
  the hybrid-signature extension builder.
- **messages** — committed `protobuf-java` classes for all QoreChain modules, a
  `typeUrl → parser` registry covering all 49 custom `Msg` types, typed composers,
  and Cosmos-style `Any` pack/unpack.
- **tx** — native `bankSend` builder, hybrid (classical + PQC) transaction
  signing, gas/fee helpers, ABCI error decoding, broadcast, and `waitForTx`.
- **query** — `RestClient` (Cosmos + 8 custom routes), `JsonRpcClient`
  (EVM `eth_*`), `QorClient` (25 `qor_*` methods).
- **subscribe** — WebSocket `subscribeNewBlocks` / `subscribeTx`.

## Coordinates

```
io.github.qorechain:qorechain-sdk:0.3.0
```

Base Java package: `io.github.qorechain` (sub-packages `networks`, `accounts`,
`pqc`, `denom`, `address`, `tx`, `query`, `messages`, `subscribe`, `utils`).
Generated protobuf classes live under the `qorechain.*` / `cosmos.*` packages.

## Build & test

```bash
export JAVA_HOME="$(/usr/libexec/java_home -v 21 2>/dev/null || echo /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home)"
./gradlew build test            # compile + run the JUnit 5 suite
./gradlew publishToMavenLocal   # validate packaging (main + sources + javadoc jars)
```

## Regenerating the protobuf classes

The generated protobuf-java classes are **committed**, so consumers need neither
`buf` nor `protoc`. To regenerate after the vendored protos change (requires
`buf` and network access to the public schema registry):

```bash
../../scripts/codegen-java.sh
```

## Publishing to Maven Central (controller only)

Publishing uses the
[`com.vanniktech.maven.publish`](https://github.com/vanniktech/gradle-maven-publish-plugin)
plugin targeting the **Central Portal**. Do **not** commit credentials. The
controller supplies them via `~/.gradle/gradle.properties` or environment, then
runs:

```bash
./gradlew publishAndReleaseToMavenCentral   # or: publishToMavenCentral (no auto-release)
```

Required properties (Gradle property names; the `ORG_GRADLE_PROJECT_<name>` env
form works too):

| Property | Purpose |
| --- | --- |
| `mavenCentralUsername` | Central Portal token username |
| `mavenCentralPassword` | Central Portal token password |
| `signingInMemoryKey` | ASCII-armored PGP private key (in-memory signing) |
| `signingInMemoryKeyPassword` | passphrase for the signing key |

Signing is enabled automatically when a signing key property is present;
`publishToMavenLocal` still succeeds without a key so packaging can be validated.
