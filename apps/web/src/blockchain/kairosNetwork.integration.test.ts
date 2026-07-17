import { describe, expect, it, vi } from 'vitest'
import { getActiveNetwork } from './activeNetwork'
import {
  getKairosNativeBalance,
  KairosRpcError,
  type NativeBalanceClient,
} from './kairosBalance'

const address = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'

describe('Kairos network integration', () => {
  it('検証済みアドレスからmock RPCで残高を取得する', async () => {
    const getBalance = vi.fn().mockResolvedValue(42n)
    const client: NativeBalanceClient = { getBalance }

    await expect(getKairosNativeBalance(address, client)).resolves.toBe(42n)
    expect(getBalance).toHaveBeenCalledWith({
      address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    })
  })

  it('RPC障害をretry可能なエラーにする', async () => {
    const client: NativeBalanceClient = {
      getBalance: vi.fn().mockRejectedValue(new Error('connection refused')),
    }

    await expect(getKairosNativeBalance(address, client)).rejects.toMatchObject({
      name: 'KairosRpcError',
      retryable: true,
    } satisfies Partial<KairosRpcError>)
  })

  it('再読み込み相当の再解決でもKairosだけを返す', () => {
    expect(getActiveNetwork().id).toBe(1001)
    expect(getActiveNetwork().id).toBe(1001)
  })
})

