import { z } from 'zod'
import { kairosErc20ReadClient, type Erc20ReadClient } from './erc20Client'
import {
  isKairosRpcTransportError,
  toKairosRpcError,
} from '../blockchain/kairosRpcError'
import {
  defineApprovedToken,
  type Erc20TokenConfiguration,
} from './tokenRegistry'

const symbolSchema = z.string().min(1).max(32)
export const tokenDecimalsSchema = z.number().int().min(0).max(255)

export interface ValidatedTokenMetadata {
  readonly symbol: string
  readonly decimals: number
}

export class InvalidTokenContractError extends Error {
  readonly name = 'InvalidTokenContractError'

  constructor() {
    super('No ERC-20 contract bytecode exists at the configured address')
  }
}

export class TokenMetadataError extends Error {
  readonly name: string = 'TokenMetadataError'

  constructor(message = 'ERC-20 metadata is missing or malformed', options?: ErrorOptions) {
    super(message, options)
  }
}

export class TokenDecimalsMismatchError extends TokenMetadataError {
  readonly name = 'TokenDecimalsMismatchError'

  constructor() {
    super('ERC-20 decimals do not match the approved configuration')
  }
}

export class TokenSymbolMismatchError extends TokenMetadataError {
  readonly name = 'TokenSymbolMismatchError'

  constructor() {
    super('ERC-20 symbol does not match the approved configuration')
  }
}

async function readTokenMetadata(
  token: Erc20TokenConfiguration,
  client: Erc20ReadClient,
): Promise<ValidatedTokenMetadata> {
  let symbolValue: unknown
  let decimalsValue: unknown
  try {
    ;[symbolValue, decimalsValue] = await Promise.all([
      client.readSymbol(token.contractAddress),
      client.readDecimals(token.contractAddress),
    ])
  } catch (error) {
    if (isKairosRpcTransportError(error)) throw toKairosRpcError(error)
    throw new TokenMetadataError('ERC-20 metadata contract call failed', {
      cause: error,
    })
  }

  const symbol = symbolSchema.safeParse(symbolValue)
  const decimals = tokenDecimalsSchema.safeParse(decimalsValue)
  if (!symbol.success || !decimals.success) throw new TokenMetadataError()
  if (symbol.data !== token.expectedSymbol) throw new TokenSymbolMismatchError()
  if (decimals.data !== token.expectedDecimals) {
    throw new TokenDecimalsMismatchError()
  }
  return { symbol: symbol.data, decimals: decimals.data }
}

//ERC-20トークンの検証
export async function validateErc20Token(
  token: Erc20TokenConfiguration,
  client: Erc20ReadClient = kairosErc20ReadClient,
): Promise<ValidatedTokenMetadata> {
  const validatedToken = defineApprovedToken(token)
  let bytecode
  try {
    bytecode = await client.getBytecode(validatedToken.contractAddress)
  } catch (error) {
    throw toKairosRpcError(error)
  }
  if (bytecode === undefined || bytecode === '0x') {
    throw new InvalidTokenContractError()
  }
  return readTokenMetadata(validatedToken, client)
}
