import { describe, expect, it, vi } from 'vitest'
import type { Erc20ReadClient } from './erc20Client'
import {
  getErc20TokenBalance,
} from './tokenBalance'
import {
  InvalidTokenContractError,
  TokenDecimalsMismatchError,
  TokenSymbolMismatchError,
} from './tokenMetadata'
import { getKairosNativeBalance, type NativeBalanceClient } from './kairosBalance'
import { KairosRpcError } from './kairosRpcError'
import { approvedJpycToken } from './tokenRegistry'

const localWallet = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'
const fundedPublicAddress = '0x65B66fdeD7b7Ff2ab328De9E6964c79aDCd95Ac0'
const testStoreAddress = '0x923bFce1ac4D318441700f26Ad4ECaF39522e32A'

function tokenClient(balance: bigint): Erc20ReadClient {
  return {
    getBytecode: vi.fn().mockResolvedValue('0x6000'),
    readSymbol: vi.fn().mockResolvedValue('JPYC'),
    readDecimals: vi.fn().mockResolvedValue(18),
    readBalance: vi.fn().mockResolvedValue(balance),
  }
}

describe('Kairos JPYC integration', () => {
  it('local walletからmock contract残高をformatする', async () => {
    const result = await getErc20TokenBalance(
      approvedJpycToken,
      localWallet,
      tokenClient(25_000_000_000_000_000_000n),
    )
    expect(result.formattedBalance).toBe('25')
    expect(result.symbol).toBe('JPYC')
  })

  it('funded public addressをlive残高に依存せずmock検証する', async () => {
    const result = await getErc20TokenBalance(
      approvedJpycToken,
      fundedPublicAddress,
      tokenClient(9_000_000_000_000_000_000_000n),
    )
    expect(result.formattedBalance).toBe('9000')
  })

  it('test store addressのzero balanceを保持する', async () => {
    const result = await getErc20TokenBalance(
      approvedJpycToken,
      testStoreAddress,
      tokenClient(0n),
    )
    expect(result.rawBalance).toBe(0n)
    expect(result.formattedBalance).toBe('0')
  })

  it('bytecode、decimals、symbol異常を個別に拒否する', async () => {
    await expect(
      getErc20TokenBalance(
        approvedJpycToken,
        localWallet,
        { ...tokenClient(0n), getBytecode: vi.fn().mockResolvedValue(undefined) },
      ),
    ).rejects.toThrow(InvalidTokenContractError)
    await expect(
      getErc20TokenBalance(
        approvedJpycToken,
        localWallet,
        { ...tokenClient(0n), readDecimals: vi.fn().mockResolvedValue(6) },
      ),
    ).rejects.toThrow(TokenDecimalsMismatchError)
    await expect(
      getErc20TokenBalance(
        approvedJpycToken,
        localWallet,
        { ...tokenClient(0n), readSymbol: vi.fn().mockResolvedValue('OTHER') },
      ),
    ).rejects.toThrow(TokenSymbolMismatchError)
  })

  it('JPYC RPC timeoutでもnative KAIA取得を壊さない', async () => {
    const nativeClient: NativeBalanceClient = {
      getBalance: vi.fn().mockResolvedValue(2_000_000_000_000_000_000n),
    }
    const failedTokenClient = {
      ...tokenClient(0n),
      getBytecode: vi.fn().mockRejectedValue(new KairosRpcError('timeout')),
    }

    const [nativeResult, tokenResult] = await Promise.allSettled([
      getKairosNativeBalance(localWallet, nativeClient),
      getErc20TokenBalance(approvedJpycToken, localWallet, failedTokenClient),
    ])
    expect(nativeResult).toEqual({
      status: 'fulfilled',
      value: 2_000_000_000_000_000_000n,
    })
    expect(tokenResult.status).toBe('rejected')
  })
})
