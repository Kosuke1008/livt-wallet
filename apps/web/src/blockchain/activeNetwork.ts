import { kaia, kairos } from '@kaiachain/viem-ext'
import { defineChain, type Chain } from 'viem'
import {
  ACTIVE_NETWORK_PROFILE,
  assertFeeDelegationExecutionAllowed,
  assertPaymentExecutionAllowed,
  type NetworkProfile,
} from './networkProfiles'

export class UnsupportedChainError extends Error {
  readonly name = 'UnsupportedChainError'
  readonly chainId: number

  constructor(chainId: number) {
    super(`Unsupported chain ID: ${chainId}`)
    this.chainId = chainId
  }
}

export const activeNetworkChain = defineChain({
  id: ACTIVE_NETWORK_PROFILE.chainId,
  name: ACTIVE_NETWORK_PROFILE.chainName,
  nativeCurrency: ACTIVE_NETWORK_PROFILE.nativeCurrency,
  rpcUrls: {
    default: { http: [ACTIVE_NETWORK_PROFILE.rpcUrl] },
  },
  blockExplorers: {
    default: {
      name: 'Kaiascan',
      url: ACTIVE_NETWORK_PROFILE.explorerUrl,
    },
  },
  testnet: ACTIVE_NETWORK_PROFILE.isTestnet,
})

export function getActiveNetwork(): Chain {
  return activeNetworkChain
}

export function getActiveNetworkProfile(): NetworkProfile {
  return ACTIVE_NETWORK_PROFILE
}

export function assertActiveNetworkExecutionAllowed(): void {
  assertPaymentExecutionAllowed(ACTIVE_NETWORK_PROFILE)
}

export function assertActiveFeeDelegationExecutionAllowed(): void {
  assertFeeDelegationExecutionAllowed(ACTIVE_NETWORK_PROFILE)
}

export function getActiveKaiaSdkChain(): typeof kairos | typeof kaia {
  switch (ACTIVE_NETWORK_PROFILE.id) {
    case 'kairos':
      return kairos
    case 'kaia-mainnet':
      return kaia
  }
}

export function selectActiveNetwork(chainId: number): Chain {
  if (chainId !== ACTIVE_NETWORK_PROFILE.chainId) {
    throw new UnsupportedChainError(chainId)
  }
  return activeNetworkChain
}
