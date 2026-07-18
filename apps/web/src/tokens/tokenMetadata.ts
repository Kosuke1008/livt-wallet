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

// トークンはchain IDと契約住所で識別し、symbolとdecimalsで設定の一致を確認する
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
    // 1. 契約からsymbolとdecimalsを並行して読み込む
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

  // 2. 契約の応答が扱える文字列と整数かZodで検査する
  const symbol = symbolSchema.safeParse(symbolValue)
  const decimals = tokenDecimalsSchema.safeParse(decimalsValue)
  if (!symbol.success || !decimals.success) throw new TokenMetadataError()
  // 3. 読み取った値が承認済み設定と一致しなければ拒否する
  if (symbol.data !== token.expectedSymbol) throw new TokenSymbolMismatchError()
  if (decimals.data !== token.expectedDecimals) {
    throw new TokenDecimalsMismatchError()
  }
  // 4. 検査済みの表示記号と小数桁数だけを返す
  return { symbol: symbol.data, decimals: decimals.data }
}

//ERC-20トークンの検証
export async function validateErc20Token(
  token: Erc20TokenConfiguration,
  client: Erc20ReadClient = kairosErc20ReadClient,
): Promise<ValidatedTokenMetadata> {
  // 1. chain IDがKairosで、契約住所の形式が有効か確認する
  const validatedToken = defineApprovedToken(token)
  let bytecode
  try {
    // 2. 設定された住所に契約コードが存在するか確認する
    bytecode = await client.getBytecode(validatedToken.contractAddress)
  } catch (error) {
    throw toKairosRpcError(error)
  }
  if (bytecode === undefined || bytecode === '0x') {
    throw new InvalidTokenContractError()
  }
  // 3. 契約のsymbolとdecimalsも承認済み設定と照合する
  return readTokenMetadata(validatedToken, client)
}
