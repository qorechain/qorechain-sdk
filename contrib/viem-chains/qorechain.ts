import { defineChain } from '../../utils/chain/defineChain.js'

export const qorechain = /*#__PURE__*/ defineChain({
  id: 9801,
  name: 'QoreChain',
  nativeCurrency: { name: 'QOR', symbol: 'QOR', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['https://evm.qore.host'],
    },
  },
  blockExplorers: {
    default: {
      name: 'QoreChain Explorer',
      url: 'https://explore.qore.network',
    },
  },
})
