import { defineChain } from 'viem'
import {
  DEFAULT_KAIROS_RPC_URL,
  NETWORK_PROFILE_DEFINITIONS,
  resolveRpcUrl,
} from './networkProfiles'

export { DEFAULT_KAIROS_RPC_URL }

export function resolveKairosRpcUrl(configuredValue: unknown): string {
  if (configuredValue === undefined || configuredValue === '') {
    return DEFAULT_KAIROS_RPC_URL
  }
  try {
    return resolveRpcUrl(configuredValue, 'Kairos')
  } catch {
    throw new Error('Invalid Kairos RPC URL')
  }
}

const configuredKairosRpcUrl =
  import.meta.env?.VITE_BLOCKCHAIN_KAIROS_RPC_URL ??
  import.meta.env?.VITE_KAIROS_RPC_URL
const kairosProfile = NETWORK_PROFILE_DEFINITIONS.kairos

export const KAIROS_NETWORK = {
  name: kairosProfile.chainName,
  chainId: kairosProfile.chainId,
  chainIdHex: kairosProfile.chainIdHex,
  nativeCurrency: kairosProfile.nativeCurrency,
  rpcUrl: resolveKairosRpcUrl(configuredKairosRpcUrl),
  blockExplorerUrl: kairosProfile.explorerUrl,
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
