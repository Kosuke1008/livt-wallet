import { KAIROS_NETWORK } from './kairos'
import { kairosPublicClient } from './kairosClient'
import { KairosRpcError, toKairosRpcError } from './kairosRpcError'

export interface ChainIdentityClient {
  getChainId(): Promise<number>
}

export class RpcChainMismatchError extends Error {
  readonly name = 'RpcChainMismatchError'
  readonly expectedChainId = KAIROS_NETWORK.chainId
  readonly receivedChainId: number

  constructor(receivedChainId: number) {
    super(
      `RPC chain ID mismatch: expected ${KAIROS_NETWORK.chainId}, received ${receivedChainId}`,
    )
    this.receivedChainId = receivedChainId
  }
}

export async function verifyKairosChain(
  client: ChainIdentityClient = kairosPublicClient,
): Promise<void> {
  let chainId: number
  try {
    chainId = await client.getChainId()
  } catch (error) {
    if (error instanceof KairosRpcError) throw error
    throw toKairosRpcError(error)
  }

  if (chainId !== KAIROS_NETWORK.chainId) {
    throw new RpcChainMismatchError(chainId)
  }
}
