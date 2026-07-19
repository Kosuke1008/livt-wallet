import { describe, expect, it } from 'vitest'
import {
  DEFAULT_KAIROS_RPC_URL,
  kairosChain,
  KAIROS_NETWORK,
  resolveKairosRpcUrl,
} from '../../../src/blockchain/kairos'

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

  it('未設定時は公式RPCを維持しlocal E2E RPCだけHTTPを許可する', () => {
    expect(resolveKairosRpcUrl(undefined)).toBe(DEFAULT_KAIROS_RPC_URL)
    expect(resolveKairosRpcUrl('http://127.0.0.1:18545')).toBe(
      'http://127.0.0.1:18545/',
    )

    for (const value of [
      'http://kairos.example.test',
      'https://user:secret@kairos.example.test',
      'not-a-url',
    ]) {
      expect(() => resolveKairosRpcUrl(value)).toThrow(
        'Invalid Kairos RPC URL',
      )
    }
  })
})
