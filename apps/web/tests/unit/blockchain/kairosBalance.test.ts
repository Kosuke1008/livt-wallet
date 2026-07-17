import { describe, expect, it, vi } from 'vitest'
import {
  formatKairosBalance,
  getKairosNativeBalance,
  KairosRpcError,
  type NativeBalanceClient,
} from '../../../src/blockchain/kairosBalance'

const address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

describe('Kairos native balance', () => {
  it('残高をbigintのまま保持する', async () => {
    const client: NativeBalanceClient = {
      getBalance: vi.fn().mockResolvedValue(1_234_000_000_000_000_000n),
    }

    const balance = await getKairosNativeBalance(address, client)
    expect(balance).toBe(1_234_000_000_000_000_000n)
    expect(typeof balance).toBe('bigint')
  })

  it('18桁のpebをKAIA文字列へ変換する', () => {
    expect(formatKairosBalance(1_234_000_000_000_000_000n)).toBe('1.234')
    expect(formatKairosBalance(1n)).toBe('0.000000000000000001')
  })

  it('不正なRPC応答を明示的なエラーへ変換する', async () => {
    const client = {
      getBalance: vi.fn().mockResolvedValue('0x1234'),
    } as unknown as NativeBalanceClient

    await expect(getKairosNativeBalance(address, client)).rejects.toMatchObject({
      name: 'KairosRpcError',
      reason: 'malformed-response',
      retryable: true,
    })
  })

  it('RPC障害をretry可能なアプリケーションエラーへ変換する', async () => {
    const client: NativeBalanceClient = {
      getBalance: vi.fn().mockRejectedValue(new Error('offline')),
    }

    await expect(getKairosNativeBalance(address, client)).rejects.toBeInstanceOf(
      KairosRpcError,
    )
  })
})
