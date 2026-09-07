import { ACTIVE_NETWORK_PROFILE } from './networkProfiles'
import { activeNetworkPublicClient } from './networkClient'
import { KairosRpcError, toKairosRpcError } from './kairosRpcError'

export interface ChainIdentityClient {
  getChainId(): Promise<number>
}

export class RpcChainMismatchError extends Error {
  readonly name = 'RpcChainMismatchError'
  readonly expectedChainId = ACTIVE_NETWORK_PROFILE.chainId
  readonly receivedChainId: number

  constructor(receivedChainId: number) {
    super(
      `RPC chain ID mismatch: expected ${ACTIVE_NETWORK_PROFILE.chainId}, received ${receivedChainId}`,
    )
    this.receivedChainId = receivedChainId
  }
}

export async function verifyActiveNetworkChain(
  client: ChainIdentityClient = activeNetworkPublicClient,
): Promise<void> {
  let chainId: number
  try {
    chainId = await client.getChainId()
  } catch (error) {
    if (error instanceof KairosRpcError) throw error
    throw toKairosRpcError(error)
  }

  if (chainId !== ACTIVE_NETWORK_PROFILE.chainId) {
    throw new RpcChainMismatchError(chainId)
  }
}
