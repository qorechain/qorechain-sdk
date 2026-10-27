// QoreChain chain definitions come from @qorechain/evm until viem/chains lists them.
export const preContent = `import { qorechain, qorechainTestnet } from "@qorechain/evm";`;

export const configOverrides = {
  targetNetworks: ["$$qorechainTestnet$$", "$$qorechain$$"],
  // QoreChain testnet blocks arrive about every 1.3 s, mainnet about every 3.1 s.
  pollingInterval: 3000,
};

// Keep the local chain (Hardhat or Anvil) first in targetNetworks for development.
export const skipLocalChainInTargetNetworks = false;
