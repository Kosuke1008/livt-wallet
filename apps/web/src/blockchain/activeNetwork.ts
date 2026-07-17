import { kairosChain, KAIROS_NETWORK } from './kairos'

export class UnsupportedChainError extends Error {
  readonly name = 'UnsupportedChainError'
  readonly chainId: number

  constructor(chainId: number) {
    super(`Unsupported chain ID: ${chainId}`)
    this.chainId = chainId
  }
}

export function getActiveNetwork(): typeof kairosChain {
  return kairosChain
}

export function selectActiveNetwork(chainId: number): typeof kairosChain {
  if (chainId !== KAIROS_NETWORK.chainId) {
    throw new UnsupportedChainError(chainId)
  }
  return kairosChain
}

