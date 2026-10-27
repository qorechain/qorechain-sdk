import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { qorechain, qorechainTestnet } from "@qorechain/evm";
import { qorexWallet } from "@qorechain/qorex-rainbowkit";
import { createConfig, http } from "wagmi";

// QoreX first, then any other injected (EIP-1193) wallet. Neither uses
// WalletConnect, so the project id is only a placeholder unless you add a
// WalletConnect-based wallet.
const connectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      wallets: [() => qorexWallet({ pollAccountsOnFocus: true }), injectedWallet],
    },
  ],
  {
    appName: "QoreChain dApp",
    projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "unused",
  },
);

// The testnet is listed first, so a fresh connection lands there.
export const config = createConfig({
  chains: [qorechainTestnet, qorechain],
  connectors,
  transports: {
    [qorechainTestnet.id]: http(),
    [qorechain.id]: http(),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
