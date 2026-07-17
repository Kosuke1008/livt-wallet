import { formatUnits, type Address } from 'viem'
import { normalizeEvmAddress } from './address'
import { KAIROS_NETWORK } from './kairos'
import { kairosPublicClient } from './kairosClient'
import { KairosRpcError, toKairosRpcError } from './kairosRpcError'

export interface NativeBalanceClient {
  getBalance(parameters: { address: Address }): Promise<bigint>
}

export async function getKairosNativeBalance(
  address: unknown,
  client: NativeBalanceClient = kairosPublicClient,
): Promise<bigint> {
  const normalizedAddress = normalizeEvmAddress(address)

  try {
    const balance: unknown = await client.getBalance({ address: normalizedAddress })
    if (typeof balance !== 'bigint') {
      throw new KairosRpcError('malformed-response')
    }
    return balance
  } catch (error) {
    if (error instanceof KairosRpcError) throw error
    throw toKairosRpcError(error)
  }
}

export { KairosRpcError }

export function formatKairosBalance(balanceInPeb: bigint): string {
  return formatUnits(balanceInPeb, KAIROS_NETWORK.nativeCurrency.decimals)
}
