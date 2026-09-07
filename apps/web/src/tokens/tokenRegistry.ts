import type { Address } from 'viem'
import {
  InvalidAddressError,
  normalizeEvmAddress,
} from '../blockchain/address'
import { ACTIVE_NETWORK_PROFILE } from '../blockchain/networkProfiles'

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

export class UnsupportedTokenError extends Error {
  readonly name = 'UnsupportedTokenError'

  constructor(tokenId: string) {
    super(`Unsupported token ID: ${tokenId}`)
  }
}

export function defineApprovedToken(
  input: Erc20TokenConfigurationInput,
): Erc20TokenConfiguration {
  if (input.chainId !== ACTIVE_NETWORK_PROFILE.chainId) {
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

//JPYCを読む
export const approvedJpycToken = Object.freeze(
  defineApprovedToken({
    id: 'jpyc',
    chainId: ACTIVE_NETWORK_PROFILE.chainId,
    contractAddress: ACTIVE_NETWORK_PROFILE.jpyc.contract,
    displayName: 'JPYC',
    expectedSymbol: ACTIVE_NETWORK_PROFILE.jpyc.symbol,
    expectedDecimals: ACTIVE_NETWORK_PROFILE.jpyc.decimals,
  }),
)

export const approvedTokens = Object.freeze([approvedJpycToken] as const)

export type ApprovedTokenId = (typeof approvedTokens)[number]['id']

export function resolveApprovedToken(tokenId: string): Erc20TokenConfiguration {
  const token = approvedTokens.find((candidate) => candidate.id === tokenId)
  if (token === undefined) throw new UnsupportedTokenError(tokenId)
  return token
}
