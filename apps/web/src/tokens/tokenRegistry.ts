import type { Address } from 'viem'
import {
  InvalidAddressError,
  normalizeEvmAddress,
} from '../blockchain/address'
import { KAIROS_NETWORK } from '../blockchain/kairos'

export interface Erc20TokenConfiguration {
  readonly id: string
  readonly chainId: number
  readonly contractAddress: Address
  readonly displayName: string
  readonly expectedSymbol: string
  readonly expectedDecimals: number
}

export type Erc20TokenConfigurationInput = Omit<
  Erc20TokenConfiguration,
  'contractAddress'
> & {
  readonly contractAddress: string
}

export class UnsupportedTokenChainError extends Error {
  readonly name = 'UnsupportedTokenChainError'

  constructor(chainId: number) {
    super(`Unsupported token chain ID: ${chainId}`)
  }
}

export class InvalidTokenContractAddressError extends Error {
  readonly name = 'InvalidTokenContractAddressError'

  constructor(options?: ErrorOptions) {
    super('Invalid ERC-20 contract address', options)
  }
}

export function defineApprovedToken(
  input: Erc20TokenConfigurationInput,
): Erc20TokenConfiguration {
  if (input.chainId !== KAIROS_NETWORK.chainId) {
    throw new UnsupportedTokenChainError(input.chainId)
  }

  try {
    return { ...input, contractAddress: normalizeEvmAddress(input.contractAddress) }
  } catch (error) {
    if (error instanceof InvalidAddressError) {
      throw new InvalidTokenContractAddressError({ cause: error })
    }
    throw error
  }
}

export const approvedTokens = [
  defineApprovedToken({
    id: 'jpyc',
    chainId: KAIROS_NETWORK.chainId,
    contractAddress: '0xe7c3d8c9a439fede00d2600032d5db0be71c3c29',
    displayName: 'JPYC',
    expectedSymbol: 'JPYC',
    expectedDecimals: 18,
  }),
] as const

export const approvedJpycToken = approvedTokens[0]
