import { describe, expect, it } from 'vitest'
import { getAddress, isAddress } from 'viem'
import {
  approvedJpycToken,
  approvedTokens,
  defineApprovedToken,
  InvalidTokenContractAddressError,
  UnsupportedTokenChainError,
} from '../../../src/tokens/tokenRegistry'

describe('approved token registry', () => {
  it('Kairos JPYCだけをchecksum正規化して登録する', () => {
    expect(approvedTokens).toHaveLength(1)
    expect(approvedJpycToken.id).toBe('jpyc')
    expect(approvedJpycToken.chainId).toBe(1001)
    expect(isAddress(approvedJpycToken.contractAddress)).toBe(true)
    expect(getAddress(approvedJpycToken.contractAddress)).toBe(
      approvedJpycToken.contractAddress,
    )
    expect(approvedJpycToken.displayName).toBe('JPYC')
    expect(approvedJpycToken.expectedSymbol).toBe('JPYC')
    expect(approvedJpycToken.expectedDecimals).toBe(18)
  })

  it('Kairos以外のtoken設定を拒否する', () => {
    expect(() =>
      defineApprovedToken({ ...approvedJpycToken, chainId: 1 }),
    ).toThrow(UnsupportedTokenChainError)
  })

  it('不正なcontract addressをRPC前に拒否する', () => {
    expect(() =>
      defineApprovedToken({ ...approvedJpycToken, contractAddress: '0x1234' }),
    ).toThrow(InvalidTokenContractAddressError)
  })
})
