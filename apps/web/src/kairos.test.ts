import { describe, expect, it } from 'vitest'
import { kairosChain, KAIROS_NETWORK } from './kairos'

describe('Kaia Kairos chain', () => {
  it('chain IDが正確に1001である', () => {
    expect(kairosChain.id).toBe(1001)
    expect(KAIROS_NETWORK.chainIdHex).toBe('0x3e9')
  })

  it('ネイティブ通貨KAIAが18桁である', () => {
    expect(kairosChain.nativeCurrency).toEqual({
      name: 'KAIA',
      symbol: 'KAIA',
      decimals: 18,
    })
  })

  it('公式Kairos RPCだけを使用しfallbackを持たない', () => {
    expect(kairosChain.rpcUrls.default.http).toEqual([KAIROS_NETWORK.rpcUrl])
    expect(Object.keys(kairosChain.rpcUrls)).toEqual(['default'])
  })
})
