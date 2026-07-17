import type { Address } from 'viem'
import { normalizeEvmAddress } from './address'
import { kairosErc20ReadClient, type Erc20ReadClient } from './erc20Client'
import {
  isKairosRpcTransportError,
  toKairosRpcError,
} from './kairosRpcError'
import { formatErc20Balance } from './tokenFormatting'
import {
  validateErc20Token,
  type ValidatedTokenMetadata,
} from './tokenMetadata'
import {
  defineApprovedToken,
  type Erc20TokenConfiguration,
} from './tokenRegistry'

export interface Erc20BalanceResult extends ValidatedTokenMetadata {
  readonly token: Erc20TokenConfiguration
  readonly ownerAddress: Address
  readonly rawBalance: bigint
  readonly formattedBalance: string
}

export class TokenBalanceError extends Error {
  readonly name = 'TokenBalanceError'

  constructor(options?: ErrorOptions) {
    super('ERC-20 balance retrieval failed', options)
  }
}

export async function getErc20TokenBalance(
  token: Erc20TokenConfiguration,
  ownerAddress: unknown,
  client: Erc20ReadClient = kairosErc20ReadClient,
): Promise<Erc20BalanceResult> {
  const validatedToken = defineApprovedToken(token)
  const normalizedOwnerAddress = normalizeEvmAddress(ownerAddress)
  const metadata = await validateErc20Token(validatedToken, client)

  let rawBalance: unknown
  try {
    rawBalance = await client.readBalance(
      validatedToken.contractAddress,
      normalizedOwnerAddress,
    )
  } catch (error) {
    if (isKairosRpcTransportError(error)) throw toKairosRpcError(error)
    throw new TokenBalanceError({ cause: error })
  }
  if (typeof rawBalance !== 'bigint') throw new TokenBalanceError()

  return {
    token: validatedToken,
    ownerAddress: normalizedOwnerAddress,
    rawBalance,
    formattedBalance: formatErc20Balance(rawBalance, metadata.decimals),
    ...metadata,
  }
}

