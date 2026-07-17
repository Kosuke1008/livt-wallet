import { describe, expect, it } from 'vitest'
import { toHex } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import {
  decryptMnemonic,
  encryptMnemonic,
  IncorrectPasswordError,
  InvalidStoredWalletError,
} from './encryptedWallet'
import { recoverAddress } from './wallet'

const mnemonic = 'test test test test test test test test test test test junk'

describe('encrypted wallet cryptography', () => {
  it('保存可能なペイロードに平文のニーモニックや秘密鍵を含めない', async () => {
    const payload = await encryptMnemonic(mnemonic, 'password')
    const privateKey = mnemonicToAccount(mnemonic).getHdKey().privateKey
    const serialized = JSON.stringify(payload)

    if (privateKey === null) throw new Error('Expected a derived private key')
    expect(serialized).not.toContain(mnemonic)
    expect(serialized).not.toContain(toHex(privateKey))
  })

  it('正しいパスワードで復号して元のアドレスを導出する', async () => {
    const payload = await encryptMnemonic(mnemonic, 'correct horse battery staple')

    const decrypted = await decryptMnemonic(
      payload,
      'correct horse battery staple',
    )

    expect(decrypted).toBe(mnemonic)
    expect(recoverAddress(decrypted)).toBe(payload.address)
  })

  it('暗号化ごとにランダムなsaltとIVを使用する', async () => {
    const first = await encryptMnemonic(mnemonic, 'password')
    const second = await encryptMnemonic(mnemonic, 'password')

    expect(first.salt).not.toBe(second.salt)
    expect(first.iv).not.toBe(second.iv)
    expect(first.ciphertext).not.toBe(second.ciphertext)
  })

  it('誤ったパスワードを明示的なエラーで拒否する', async () => {
    const payload = await encryptMnemonic(mnemonic, 'correct-password')

    await expect(decryptMnemonic(payload, 'wrong-password')).rejects.toThrow(
      IncorrectPasswordError,
    )
  })

  it('改ざんされた暗号文を拒否する', async () => {
    const payload = await encryptMnemonic(mnemonic, 'password')
    const corrupted = {
      ...payload,
      ciphertext: `${payload.ciphertext.slice(0, -4)}AAAA`,
    }

    await expect(decryptMnemonic(corrupted, 'password')).rejects.toThrow(
      IncorrectPasswordError,
    )
  })

  it('不正な形式のペイロードを拒否する', async () => {
    const malformed = { version: 1, ciphertext: 'plaintext' }

    await expect(
      decryptMnemonic(malformed as never, 'password'),
    ).rejects.toThrow(InvalidStoredWalletError)
  })
})
