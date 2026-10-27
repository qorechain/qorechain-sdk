import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

// Load .env (PRIVATE_KEY) when present. Hardhat resolves configuration
// variables from the environment or from `npx hardhat keystore set PRIVATE_KEY`.
try {
  process.loadEnvFile();
} catch {
  // No .env: rely on the environment or the keystore.
}

// Public QoreChain EVM endpoints.
export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: { version: "0.8.28" },
      production: {
        version: "0.8.28",
        settings: { optimizer: { enabled: true, runs: 200 } },
      },
    },
  },
  networks: {
    hardhatMainnet: { type: "edr-simulated", chainType: "l1" },
    qorechainTestnet: {
      type: "http",
      chainType: "l1",
      chainId: 9800,
      url: "https://evm-testnet.qore.host",
      accounts: [configVariable("PRIVATE_KEY")],
    },
    qorechain: {
      type: "http",
      chainType: "l1",
      chainId: 9801,
      url: "https://evm.qore.host",
      accounts: [configVariable("PRIVATE_KEY")],
    },
  },
});
