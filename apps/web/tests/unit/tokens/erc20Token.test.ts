import { describe, expect, it, vi } from 'vitest'
import type { Erc20ReadClient } from '../../../src/tokens/erc20Client'
import {
  getErc20TokenBalance,
  TokenBalanceError,
} from '../../../src/tokens/tokenBalance'
import { formatErc20Balance } from '../../../src/tokens/tokenFormatting'
import {
  InvalidTokenContractError,
  TokenDecimalsMismatchError,
  TokenMetadataError,
  TokenSymbolMismatchError,
  validateErc20Token,
} from '../../../src/tokens/tokenMetadata'
import { KairosRpcError } from '../../../src/blockchain/kairosRpcError'
import { approvedJpycToken } from '../../../src/tokens/tokenRegistry'

const owner = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'

function createClient(
  overrides: Partial<Erc20ReadClient> = {},
): Erc20ReadClient {
  return {
    getBytecode: vi.fn().mockResolvedValue('0x6000'),
    readSymbol: vi.fn().mockResolvedValue('JPYC'),
    readDecimals: vi.fn().mockResolvedValue(18),
    readBalance: vi.fn().mockResolvedValue(1_500_000_000_000_000_000n),
    ...overrides,
  }
}

describe('ERC-20 token validation and balance', () => {
  it('bytecode、symbol、decimalsを検証する', async () => {
    const client = createClient()
    await expect(validateErc20Token(approvedJpycToken, client)).resolves.toEqual({
      symbol: 'JPYC',
      decimals: 18,
    })
    expect(client.getBytecode).toHaveBeenCalledWith(
      approvedJpycToken.contractAddress,
    )
  })

  it('bytecodeがないアドレスを拒否する', async () => {
    const client = createClient({ getBytecode: vi.fn().mockResolvedValue('0x') })
    await expect(validateErc20Token(approvedJpycToken, client)).rejects.toThrow(
      InvalidTokenContractError,
    )
  })

  it('balanceOfを呼びraw bigintとformatted balanceを分離する', async () => {
    const client = createClient()
    const result = await getErc20TokenBalance(approvedJpycToken, owner, client)

    expect(result.rawBalance).toBe(1_500_000_000_000_000_000n)
    expect(typeof result.rawBalance).toBe('bigint')
    expect(result.formattedBalance).toBe('1.5')
    expect(client.readBalance).toHaveBeenCalledWith(
      approvedJpycToken.contractAddress,
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    )
  })

  it('0nをloadingやerrorと区別して0と表示する', async () => {
    const result = await getErc20TokenBalance(
      approvedJpycToken,
      owner,
      createClient({ readBalance: vi.fn().mockResolvedValue(0n) }),
    )
    expect(result.rawBalance).toBe(0n)
    expect(result.formattedBalance).toBe('0')
  })

  it('18桁を浮動小数点なしでformatする', () => {
    expect(formatErc20Balance(1n, 18)).toBe('0.000000000000000001')
  })

  it('symbol不一致を拒否する', async () => {
    const client = createClient({ readSymbol: vi.fn().mockResolvedValue('FAKE') })
    await expect(validateErc20Token(approvedJpycToken, client)).rejects.toThrow(
      TokenSymbolMismatchError,
    )
  })

  it('decimals不一致を拒否しhard-coded fallbackを使わない', async () => {
    const client = createClient({ readDecimals: vi.fn().mockResolvedValue(6) })
    await expect(validateErc20Token(approvedJpycToken, client)).rejects.toThrow(
      TokenDecimalsMismatchError,
    )
  })

  it('malformed metadataを拒否する', async () => {
    const client = createClient({ readDecimals: vi.fn().mockResolvedValue('18') })
    await expect(validateErc20Token(approvedJpycToken, client)).rejects.toThrow(
      TokenMetadataError,
    )
  })

  it('metadata contract revertを明示的に拒否する', async () => {
    const client = createClient({
      readSymbol: vi.fn().mockRejectedValue(new Error('execution reverted')),
    })
    await expect(validateErc20Token(approvedJpycToken, client)).rejects.toThrow(
      TokenMetadataError,
    )
  })

  it('balanceOf revertをTokenBalanceErrorへ変換する', async () => {
    const client = createClient({
      readBalance: vi.fn().mockRejectedValue(new Error('execution reverted')),
    })
    await expect(
      getErc20TokenBalance(approvedJpycToken, owner, client),
    ).rejects.toThrow(TokenBalanceError)
  })

  it('RPC障害をretryable errorとして維持する', async () => {
    const client = createClient({
      readSymbol: vi.fn().mockRejectedValue(
        new Error('wrapped contract error', {
          cause: new KairosRpcError('timeout'),
        }),
      ),
    })
    await expect(
      getErc20TokenBalance(approvedJpycToken, owner, client),
    ).rejects.toMatchObject({ retryable: true, reason: 'timeout' })
  })
})
