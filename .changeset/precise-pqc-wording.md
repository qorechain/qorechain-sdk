---
"@qorechain/sdk": patch
"@qorechain/evm": patch
"@qorechain/svm": patch
"@qorechain/react": patch
"create-qorechain-dapp": patch
---

Docs and wording: describe post-quantum signing precisely (hybrid secp256k1 +
ML-DSA-87 on the native lane, a bounded authorisation window on the EVM lane,
SVM lane not open yet), drop superiority claims, and use plain hyphens in docs,
comments and messages.

`@qorechain/react`: new `PqcStatusBadge` component (`PqcStatusBadgeProps`,
`PqcStatusRenderState`). `QuantumSafeBadge`, `QuantumSafeBadgeProps` and
`QuantumSafeRenderState` stay exported as deprecated aliases of the same
component and types. The default badge labels are now "PQC key registered" and
"No PQC key" (override them with `safeLabel` / `unsafeLabel`). The root element
keeps `data-quantum-safe` and also carries `data-pqc-status` with the same
values.
