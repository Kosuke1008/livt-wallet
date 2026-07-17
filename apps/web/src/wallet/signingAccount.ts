import type { Address, LocalAccount } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { normalizeEvmAddress } from '../blockchain/address'
import {
  decryptMnemonic,
  loadEncryptedWallet,
  type WalletStorage,
} from './encryptedWallet'

export class SigningAccountMismatchError extends Error {
  readonly name = 'SigningAccountMismatchError'

  constructor() {
    super('The signing account does not match the unlocked wallet address')
  }
}

export async function withStoredSigningAccount<Result>(
  password: string,
  expectedAddress: Address,
  operation: (account: LocalAccount) => Promise<Result>,
  storage: WalletStorage = localStorage,
): Promise<Result> {
  const normalizedExpectedAddress = normalizeEvmAddress(expectedAddress)
  const encryptedWallet = loadEncryptedWallet(storage)
  if (encryptedWallet.address !== normalizedExpectedAddress) {
    throw new SigningAccountMismatchError()
  }

  const mnemonic = await decryptMnemonic(
    encryptedWallet,
    password,
  )
  const account = mnemonicToAccount(mnemonic)
  if (normalizeEvmAddress(account.address) !== normalizedExpectedAddress) {
    throw new SigningAccountMismatchError()
  }
  return operation(account)
}
