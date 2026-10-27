import { defineChain } from '../../utils/chain/defineChain.js'

export const qorechainTestnet = /*#__PURE__*/ defineChain({
  id: 9800,
  name: 'QoreChain Testnet',
  nativeCurrency: { name: 'QOR', symbol: 'QOR', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['https://evm-testnet.qore.host'],
      webSocket: ['wss://evm-ws-testnet.qore.host'],
    },
  },
  blockExplorers: {
    default: {
      name: 'QoreChain Explorer',
      url: 'https://explore.qore.network',
    },
  },
  testnet: true,
})
