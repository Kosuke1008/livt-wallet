import { defineChain } from 'viem'

export const DEFAULT_KAIROS_RPC_URL =
  'https://public-en-kairos.node.kaia.io'

export function resolveKairosRpcUrl(configuredValue: unknown): string {
  if (configuredValue === undefined || configuredValue === '') {
    return DEFAULT_KAIROS_RPC_URL
  }
  if (typeof configuredValue !== 'string') {
    throw new Error('Invalid Kairos RPC URL')
  }

  let url: URL
  try {
    url = new URL(configuredValue)
  } catch {
    throw new Error('Invalid Kairos RPC URL')
  }

  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
  const allowedProtocol =
    url.protocol === 'https:' ||
    (url.protocol === 'http:' && localHosts.has(url.hostname))

  if (
    !allowedProtocol ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== ''
  ) {
    throw new Error('Invalid Kairos RPC URL')
  }

  return url.href
}

const configuredKairosRpcUrl = import.meta.env?.VITE_KAIROS_RPC_URL

export const KAIROS_NETWORK = {
  name: 'Kaia Kairos',
  chainId: 1001,
  chainIdHex: '0x3e9',
  nativeCurrency: {
    name: 'KAIA',
    symbol: 'KAIA',
    decimals: 18,
  },
  rpcUrl: resolveKairosRpcUrl(configuredKairosRpcUrl),
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
