import {
  formatUnits,
  HttpRequestError,
  ParseRpcError,
  TimeoutError,
  type Address,
} from 'viem'
import { normalizeEvmAddress } from './address'
import { KAIROS_NETWORK } from './kairos'
import { kairosPublicClient } from './kairosClient'

export interface NativeBalanceClient {
  getBalance(parameters: { address: Address }): Promise<bigint>
}

export type KairosRpcFailureReason = 'malformed-response' | 'timeout' | 'unavailable'

export class KairosRpcError extends Error {
  readonly name = 'KairosRpcError'
  readonly retryable = true
  readonly reason: KairosRpcFailureReason

  constructor(reason: KairosRpcFailureReason, options?: ErrorOptions) {
    super(`Kaia Kairos RPC ${reason}`, options)
    this.reason = reason
  }
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
    if (error instanceof TimeoutError) {
      throw new KairosRpcError('timeout', { cause: error })
    }
    if (error instanceof ParseRpcError) {
      throw new KairosRpcError('malformed-response', { cause: error })
    }
    if (error instanceof HttpRequestError) {
      throw new KairosRpcError('unavailable', { cause: error })
    }
    throw new KairosRpcError('unavailable', { cause: error })
  }
}

export function formatKairosBalance(balanceInPeb: bigint): string {
  return formatUnits(balanceInPeb, KAIROS_NETWORK.nativeCurrency.decimals)
}

