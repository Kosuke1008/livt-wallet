import { describe, expect, it } from 'vitest'
import { InvalidAddressError, normalizeEvmAddress } from './address'

describe('EVM address validation', () => {
  it('有効なアドレスをchecksum形式に正規化する', () => {
    expect(normalizeEvmAddress('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266')).toBe(
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    )
  })

  it('不正なアドレスを明示的に拒否する', () => {
    expect(() => normalizeEvmAddress('0x1234')).toThrow(InvalidAddressError)
  })
})

