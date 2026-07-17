import type { Address } from 'viem'
import { validateMnemonic } from '@scure/bip39'
import {
  english,
  generateMnemonic,
  mnemonicToAccount,
} from 'viem/accounts'
import {
  isValidEvmAddress,
  normalizeEvmAddress,
} from '../blockchain/address'

export interface GeneratedWallet {
  readonly mnemonic: string
  readonly address: Address
}

export class InvalidMnemonicError extends Error {
  readonly name = 'InvalidMnemonicError'

  constructor() {
    super('Invalid BIP39 mnemonic')
  }
}

export function recoverAddress(mnemonic: string): Address { //12単語から口座番号の復元
  if (!validateMnemonic(mnemonic, english)) {
    throw new InvalidMnemonicError()
  }

  const account = mnemonicToAccount(mnemonic)
  return normalizeEvmAddress(account.address)
}

export function createWallet(): GeneratedWallet { // １．２．wallet作成
  const mnemonic = generateMnemonic(english)

  return {
    mnemonic,
    address: recoverAddress(mnemonic),
  }
}

export function isValidWalletAddress(value: string): value is Address {
  return isValidEvmAddress(value)
}
