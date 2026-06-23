/**
 * Bundled ABIs used by the QoreChain EVM adapter.
 *
 * These are declared `as const` so viem can infer fully typed argument and
 * return types from them. The QoreChain precompile ABIs mirror the chain's
 * published Solidity interfaces exactly.
 */

/** Minimal ERC-20 ABI covering the helpers this package exposes. */
export const ERC20_ABI = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "Approval",
    inputs: [
      { indexed: true, name: "owner", type: "address" },
      { indexed: true, name: "spender", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
    ],
  },
] as const;

/**
 * Post-quantum cryptography precompile interface (`IQorePQC`).
 *
 * Exposes signature verification and on-chain key registration status for
 * QoreChain's quantum-resistant key material (Dilithium / ML-DSA family).
 */
export const IQORE_PQC_ABI = [
  {
    type: "function",
    name: "pqcVerify",
    stateMutability: "view",
    inputs: [
      { name: "pubkey", type: "bytes" },
      { name: "signature", type: "bytes" },
      { name: "message", type: "bytes" },
    ],
    outputs: [{ name: "valid", type: "bool" }],
  },
  {
    type: "function",
    name: "pqcKeyStatus",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [
      { name: "registered", type: "bool" },
      { name: "algorithmId", type: "uint8" },
      { name: "pubkey", type: "bytes" },
    ],
  },
] as const;

/**
 * On-chain risk/anomaly intelligence precompile interface (`IQoreAI`).
 */
export const IQORE_AI_ABI = [
  {
    type: "function",
    name: "aiRiskScore",
    stateMutability: "view",
    inputs: [{ name: "txData", type: "bytes" }],
    outputs: [
      { name: "score", type: "uint256" },
      { name: "level", type: "uint8" },
    ],
  },
  {
    type: "function",
    name: "aiAnomalyCheck",
    stateMutability: "view",
    inputs: [
      { name: "sender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [
      { name: "anomalyScore", type: "uint256" },
      { name: "flagged", type: "bool" },
    ],
  },
] as const;

/**
 * Consensus parameters precompile interface (`IQoreConsensus`).
 *
 * Surfaces live, adaptively-tuned consensus parameters from the network.
 */
export const IQORE_CONSENSUS_ABI = [
  {
    type: "function",
    name: "rlConsensusParams",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "blockTime", type: "uint256" },
      { name: "baseGasPrice", type: "uint256" },
      { name: "validatorSetSize", type: "uint256" },
      { name: "epoch", type: "uint256" },
    ],
  },
] as const;
