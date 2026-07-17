import { describe, expect, it, vi } from 'vitest'
import {
  RpcChainMismatchError,
  verifyKairosChain,
  type ChainIdentityClient,
} from '../../../src/blockchain/kairosChainVerification'
import { KairosRpcError } from '../../../src/blockchain/kairosRpcError'

describe('Kairos RPC chain identity verification', () => {
  it('RPCがchain ID 1001を返す場合だけ許可する', async () => {
    const client: ChainIdentityClient = {
      getChainId: vi.fn().mockResolvedValue(1001),
    }

    await expect(verifyKairosChain(client)).resolves.toBeUndefined()
    expect(client.getChainId).toHaveBeenCalledOnce()
  })

  it.each([1, 8217, 31337])(
    'chain ID %sを不一致として拒否する',
    async (chainId) => {
      const client: ChainIdentityClient = {
        getChainId: vi.fn().mockResolvedValue(chainId),
      }

      await expect(verifyKairosChain(client)).rejects.toMatchObject({
        name: 'RpcChainMismatchError',
        expectedChainId: 1001,
        receivedChainId: chainId,
      } satisfies Partial<RpcChainMismatchError>)
    },
  )

  it('RPC障害を制御されたKairosエラーへ変換する', async () => {
    const client: ChainIdentityClient = {
      getChainId: vi.fn().mockRejectedValue(new Error('offline')),
    }

    await expect(verifyKairosChain(client)).rejects.toBeInstanceOf(
      KairosRpcError,
    )
  })
})
