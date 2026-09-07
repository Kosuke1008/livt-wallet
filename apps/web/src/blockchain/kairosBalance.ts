import { formatUnits, type Address } from 'viem'
import { normalizeEvmAddress } from './address'
import { ACTIVE_NETWORK_PROFILE } from './networkProfiles'
import { activeNetworkPublicClient } from './networkClient'
import { KairosRpcError, toKairosRpcError } from './kairosRpcError'

export interface NativeBalanceClient {
  getBalance(parameters: { address: Address }): Promise<bigint>
}

export async function getKairosNativeBalance( //KAIA残高取得
  address: unknown,
  client: NativeBalanceClient = activeNetworkPublicClient,
): Promise<bigint> {
  const normalizedAddress = normalizeEvmAddress(address) //正しいEVMアドレスへ整形

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
  return formatUnits(balanceInPeb, ACTIVE_NETWORK_PROFILE.nativeCurrency.decimals)
}
