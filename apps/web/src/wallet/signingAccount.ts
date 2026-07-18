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

//秘密鍵を使って署名するための関数
// この境界では復元用の単語列や秘密鍵を画面へ渡さず、署名処理にだけ口座を使う
export async function withStoredSigningAccount<Result>(
  password: string,
  expectedAddress: Address,
  operation: (account: LocalAccount) => Promise<Result>,
  storage: WalletStorage = localStorage,
): Promise<Result> {
  // 1. 解除中の公開アドレスを比較できる同じ形式へ整える
  const normalizedExpectedAddress = normalizeEvmAddress(expectedAddress)
  // 2. 暗号化済みデータを読み、保存された公開アドレスを先に確認する
  const encryptedWallet = loadEncryptedWallet(storage)
  if (encryptedWallet.address !== normalizedExpectedAddress) {
    throw new SigningAccountMismatchError()
  }

  // 3. 署名が必要になった時点でだけ復元用の単語列を復号する
  const mnemonic = await decryptMnemonic(
    encryptedWallet,
    password,
  )
  // 4. 復元用の単語列から署名用口座を作り、公開アドレスをもう一度確認する
  const account = mnemonicToAccount(mnemonic)
  if (normalizeEvmAddress(account.address) !== normalizedExpectedAddress) {
    throw new SigningAccountMismatchError()
  }
  // 5. 復元した口座で指定された処理を行い、その処理結果だけを返す
  return operation(account)
}
