/**
 * viem chain definitions for the two public QoreChain EVM networks.
 *
 * Pass them to viem (`createPublicClient({ chain: qorechain, ... })`), wagmi or
 * RainbowKit (`chains: [qorechain, qorechainTestnet]`). They carry the public
 * endpoints; pass your own transport to use another node.
 *
 * QOR has 18 decimals on the EVM lane and 6 (`uqor`) on the native lane. The
 * two are the same balance: 1 uqor = 10^12 wei.
 */

import { defineChain } from "viem";

const nativeCurrency = { name: "QOR", symbol: "QOR", decimals: 18 } as const;

const blockExplorers = {
  default: { name: "QoreChain Explorer", url: "https://explore.qore.network" },
} as const;

/** QoreChain mainnet (`qorechain-vladi`), EVM chain id 9801. */
export const qorechain = /*#__PURE__*/ defineChain({
  id: 9801,
  name: "QoreChain",
  nativeCurrency,
  rpcUrls: {
    default: { http: ["https://evm.qore.host"] },
  },
  blockExplorers,
});

/** QoreChain testnet (`qorechain-diana`), EVM chain id 9800. */
export const qorechainTestnet = /*#__PURE__*/ defineChain({
  id: 9800,
  name: "QoreChain Testnet",
  nativeCurrency,
  rpcUrls: {
    default: {
      http: ["https://evm-testnet.qore.host"],
      webSocket: ["wss://evm-ws-testnet.qore.host"],
    },
  },
  blockExplorers,
  testnet: true,
});

/** Both chains, mainnet first. Pass to wagmi or RainbowKit `chains`. */
export const QORECHAIN_CHAINS = [qorechain, qorechainTestnet] as const;

/** The native-lane (REST) endpoints that pair with each EVM chain id. */
export const QORECHAIN_REST_ENDPOINTS: Readonly<Record<number, string>> = {
  [qorechain.id]: "https://api.qore.host",
  [qorechainTestnet.id]: "https://api-testnet.qore.host",
};
