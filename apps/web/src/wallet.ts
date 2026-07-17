import { isAddress, type Address } from 'viem'
import { validateMnemonic } from '@scure/bip39'
import {
  english,
  generateMnemonic,
  mnemonicToAccount,
} from 'viem/accounts'
import { z } from 'zod'

const addressSchema = z
  .string()
  .refine(isAddress, { message: 'Invalid EVM address' })
  .transform((address): Address => address)

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

export function recoverAddress(mnemonic: string): Address {
  if (!validateMnemonic(mnemonic, english)) {
    throw new InvalidMnemonicError()
  }

  const account = mnemonicToAccount(mnemonic)
  return addressSchema.parse(account.address)
}

export function createWallet(): GeneratedWallet {
  const mnemonic = generateMnemonic(english)

  return {
    mnemonic,
    address: recoverAddress(mnemonic),
  }
}

export function isValidWalletAddress(value: string): value is Address {
  return addressSchema.safeParse(value).success
}
