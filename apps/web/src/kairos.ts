import { defineChain } from 'viem'

export const KAIROS_NETWORK = {
  name: 'Kaia Kairos',
  chainId: 1001,
  chainIdHex: '0x3e9',
  nativeCurrency: {
    name: 'KAIA',
    symbol: 'KAIA',
    decimals: 18,
  },
  rpcUrl: 'https://public-en-kairos.node.kaia.io',
  blockExplorerUrl: 'https://kairos.kaiascan.io',
} as const

export const kairosChain = defineChain({
  id: KAIROS_NETWORK.chainId,
  name: KAIROS_NETWORK.name,
  nativeCurrency: KAIROS_NETWORK.nativeCurrency,
  rpcUrls: {
    default: { http: [KAIROS_NETWORK.rpcUrl] },
  },
  blockExplorers: {
    default: {
      name: 'Kaiascan',
      url: KAIROS_NETWORK.blockExplorerUrl,
    },
  },
  testnet: true,
})

