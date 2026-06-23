/**
 * Compiled artifact for `contracts/Counter.sol`.
 *
 * Generated with solc 0.8.24 (`--optimize`). To regenerate after editing the
 * contract, see the README ("Compiling the contract"). The ABI is exported as a
 * `const` tuple so viem can infer fully-typed read/write calls.
 */
import type { Hex } from "viem";

export const counterAbi = [
  {
    inputs: [{ internalType: "uint256", name: "initial", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: false, internalType: "uint256", name: "newCount", type: "uint256" },
    ],
    name: "CountChanged",
    type: "event",
  },
  {
    inputs: [],
    name: "count",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "increment",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "value", type: "uint256" }],
    name: "set",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

/** Creation bytecode (`0x`-prefixed). */
export const counterBytecode: Hex =
  "0x608060405234801561000f575f80fd5b5060405161020238038061020283398101604081905261002e9161006b565b5f8190556040518181527f0ef4482aceb854636f33f9cd319f9e1cd6fe3aa2e60523f3583c287b893824459060200160405180910390a150610082565b5f6020828403121561007b575f80fd5b5051919050565b6101738061008f5f395ff3fe608060405234801561000f575f80fd5b506004361061003f575f3560e01c806306661abd1461004357806360fe47b11461005d578063d09de08a14610072575b5f80fd5b61004b5f5481565b60405190815260200160405180910390f35b61007061006b366004610101565b61007a565b005b6100706100b4565b5f8190556040518181527f0ef4482aceb854636f33f9cd319f9e1cd6fe3aa2e60523f3583c287b893824459060200160405180910390a150565b60015f808282546100c59190610118565b90915550505f546040519081527f0ef4482aceb854636f33f9cd319f9e1cd6fe3aa2e60523f3583c287b893824459060200160405180910390a1565b5f60208284031215610111575f80fd5b5035919050565b8082018082111561013757634e487b7160e01b5f52601160045260245ffd5b9291505056fea26469706673582212200d27ca0dce27dfdb771aff6a0f1cd5401d4e0460ff87431bac1a13e5f774066a64736f6c63430008180033";
