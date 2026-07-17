import { describe, expect, it } from 'vitest'
import { validateMnemonic } from '@scure/bip39'
import { english } from 'viem/accounts'
import {
  createWallet,
  InvalidMnemonicError,
  isValidWalletAddress,
  recoverAddress,
} from './wallet'

const knownMnemonic =
  'test test test test test test test test test test test junk'

describe('wallet', () => {
  it('有効なBIP39ニーモニックとEVMアドレスを生成する', () => {
    const wallet = createWallet()

    expect(validateMnemonic(wallet.mnemonic, english)).toBe(true)
    expect(isValidWalletAddress(wallet.address)).toBe(true)
  })

  it('同じニーモニックから同じアドレスを復元する', () => {
    const firstAddress = recoverAddress(knownMnemonic)
    const secondAddress = recoverAddress(knownMnemonic)

    expect(firstAddress).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266')
    expect(secondAddress).toBe(firstAddress)
  })

  it('無効なニーモニックを拒否する', () => {
    expect(() => recoverAddress('not a valid mnemonic')).toThrow(
      InvalidMnemonicError,
    )
  })
})
