# pqc-hybrid-sign

Post-quantum signing on QoreChain with ML-DSA-87 (Dilithium-5, NIST FIPS 204).

**This example runs fully offline — no node required.**

- **Part 1** generates a PQC keypair and signs/verifies a message with
  `pqcSign` / `pqcVerify`, including a tamper check.
- **Part 2** builds a *hybrid* transaction with `buildHybridTx`: it carries the
  usual classical secp256k1 signature **plus** an ML-DSA-87 signature attached
  as a `PQCHybridSignature` extension, then verifies the PQC half locally.

## On-chain prerequisite (for actually broadcasting hybrid txs)

The signer's PQC public key must be registered on-chain via the chain's
`MsgRegisterPQCKey` before a hybrid tx will PQC-verify — **unless** you set
`includePqcPublicKey: true` (as this example does), which embeds the key in the
extension so the chain can auto-register it on first use. Broadcasting also
requires a reachable node and a funded, sequence-correct account. This example
only builds and locally verifies the bytes.

## Run

```bash
pnpm install
pnpm start
```

Expected tail of the output:

```
SUCCESS: all PQC checks passed.
```
