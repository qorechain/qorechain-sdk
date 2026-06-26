---
id: install
title: Install
sidebar_position: 2
---

# Install

Install the SDK for your language. The TypeScript core is published to npm; the
other language packages and the EVM/SVM adapters are publish-pending and listed
here for completeness. Until they are published, build them from the
[monorepo](https://github.com/qorechain/qorechain-sdk).

## TypeScript

The core package:

```bash
npm i @qorechain/sdk
```

It targets Node.js 20+ and ships ESM, CommonJS, and type definitions.

### EVM adapter

`@qorechain/evm` is a thin, type-safe adapter over [viem](https://viem.sh).
viem is a **peer dependency** — install it alongside:

```bash
npm i @qorechain/evm viem
```

> Publish-pending. Until published, build `packages/evm` from the monorepo.

### SVM adapter

`@qorechain/svm` is a thin adapter over
[`@solana/web3.js`](https://solana.com/docs/clients/javascript), which is a
**peer dependency**:

```bash
npm i @qorechain/svm @solana/web3.js
```

> Publish-pending. Until published, build `packages/svm` from the monorepo.

## Python

```bash
pip install qorechain-sdk
```

Requires Python 3.10+. The package ships type hints and a `py.typed` marker.

> Publish-pending.

## Go

```bash
go get github.com/qorechain/qorechain-sdk/packages/go/...
```

Requires Go 1.22+. Import the sub-packages you need, for example:

```go
import (
    "github.com/qorechain/qorechain-sdk/packages/go/qorechain/client"
    "github.com/qorechain/qorechain-sdk/packages/go/qorechain/accounts"
)
```

> Publish-pending.

## Rust

```bash
cargo add qorechain-sdk
```

Or in `Cargo.toml`:

```toml
[dependencies]
qorechain = "0.1"
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
```

Requires Rust 1.74+. The read clients are async (Tokio).

> Publish-pending.

## Next

Continue to the [Quickstart](quickstart.md) to connect and read on-chain state.
