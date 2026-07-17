import { formatUnits } from 'viem'
import { TokenMetadataError, tokenDecimalsSchema } from './tokenMetadata'

export function formatErc20Balance(rawBalance: bigint, decimals: number): string {
  const validatedDecimals = tokenDecimalsSchema.safeParse(decimals)
  if (!validatedDecimals.success) throw new TokenMetadataError()
  return formatUnits(rawBalance, validatedDecimals.data)
}

