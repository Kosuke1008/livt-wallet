import { describe, expect, it } from 'vitest'
import { toHex } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import {
  createEncryptedWalletBackup,
  decryptMnemonic,
  encryptMnemonic,
  hasEncryptedWallet,
  IncorrectPasswordError,
  InvalidStoredWalletError,
  InvalidWalletBackupError,
  restoreEncryptedWalletBackup,
  saveEncryptedWallet,
  WalletAddressMismatchError,
  WalletAlreadyExistsError,
  type WalletStorage,
} from '../../../src/wallet/encryptedWallet'
import { recoverAddress } from '../../../src/wallet/wallet'

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

  it('暗号文だけをversion付きbackupとしてexportして別storageへ復元する', async () => {
    const source = createStorage()
    const target = createStorage()
    const payload = await encryptMnemonic(mnemonic, 'backup-password')
    saveEncryptedWallet(payload, source)

    const backup = await createEncryptedWalletBackup(
      'backup-password',
      payload.address,
      source,
    )
    const restoredAddress = await restoreEncryptedWalletBackup(
      backup,
      'backup-password',
      target,
    )

    expect(restoredAddress).toBe(payload.address)
    expect(hasEncryptedWallet(target)).toBe(true)
    expect(backup).not.toContain(mnemonic)
    expect(backup).toContain('livt-wallet-encrypted-backup')
  })

  it('export時に現在のWallet addressと一致しない保存データを拒否する', async () => {
    const storage = createStorage()
    const payload = await encryptMnemonic(mnemonic, 'backup-password')
    saveEncryptedWallet(payload, storage)

    await expect(
      createEncryptedWalletBackup(
        'backup-password',
        '0x0000000000000000000000000000000000000001',
        storage,
      ),
    ).rejects.toThrow(WalletAddressMismatchError)
  })

  it('誤passwordや改ざんbackupではstorageへ何も保存しない', async () => {
    const source = createStorage()
    const target = createStorage()
    const payload = await encryptMnemonic(mnemonic, 'backup-password')
    saveEncryptedWallet(payload, source)
    const backup = await createEncryptedWalletBackup(
      'backup-password',
      payload.address,
      source,
    )

    await expect(
      restoreEncryptedWalletBackup(backup, 'wrong-password', target),
    ).rejects.toThrow(IncorrectPasswordError)
    expect(hasEncryptedWallet(target)).toBe(false)

    const parsed = JSON.parse(backup) as {
      wallet: { address: string }
    }
    parsed.wallet.address = '0x0000000000000000000000000000000000000001'
    await expect(
      restoreEncryptedWalletBackup(
        JSON.stringify(parsed),
        'backup-password',
        target,
      ),
    ).rejects.toThrow(InvalidWalletBackupError)
    expect(hasEncryptedWallet(target)).toBe(false)
  })

  it('既存Walletをbackup importで上書きしない', async () => {
    const source = createStorage()
    const target = createStorage()
    const payload = await encryptMnemonic(mnemonic, 'backup-password')
    saveEncryptedWallet(payload, source)
    saveEncryptedWallet(payload, target)
    const backup = await createEncryptedWalletBackup(
      'backup-password',
      payload.address,
      source,
    )

    await expect(
      restoreEncryptedWalletBackup(backup, 'backup-password', target),
    ).rejects.toThrow(WalletAlreadyExistsError)
  })

  it('巨大または余分なfieldを持つbackupを復号前に拒否する', async () => {
    const storage = createStorage()

    await expect(
      restoreEncryptedWalletBackup('x'.repeat(16_385), 'password', storage),
    ).rejects.toThrow(InvalidWalletBackupError)
    await expect(
      restoreEncryptedWalletBackup(
        JSON.stringify({
          format: 'livt-wallet-encrypted-backup',
          version: 1,
          wallet: {},
          unexpected: true,
        }),
        'password',
        storage,
      ),
    ).rejects.toThrow(InvalidWalletBackupError)
  })
})

function createStorage(): WalletStorage {
  const values = new Map<string, string>()

  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}
