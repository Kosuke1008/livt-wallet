import { describe, expect, it } from 'vitest'
import {
  createAndSaveWallet,
  hasEncryptedWallet,
  InvalidStoredWalletError,
  loadEncryptedWallet,
  unlockStoredWalletAddress,
} from './encryptedWallet'

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  serializedValue(): string {
    return [...this.values.values()].join('')
  }
}

describe('encrypted wallet storage', () => {
  it('暗号化ペイロードだけを保存し、再読み込み後も復号できる', async () => {
    const storage = new MemoryStorage()
    const password = 'user-provided-password'
    const originalAddress = await createAndSaveWallet(password, storage)
    const persisted = storage.serializedValue()

    expect(hasEncryptedWallet(storage)).toBe(true)
    expect(persisted).not.toContain('mnemonic')
    expect(persisted).not.toContain('privateKey')
    expect(persisted).not.toContain(password)
    expect(loadEncryptedWallet(storage).address).toBe(originalAddress)

    const reloadedAddress = await unlockStoredWalletAddress(password, storage)
    expect(reloadedAddress).toBe(originalAddress)
  })

  it('破損した保存データを拒否する', () => {
    const storage = new MemoryStorage()
    storage.setItem('livt-wallet:encrypted-wallet', '{broken json')

    expect(() => loadEncryptedWallet(storage)).toThrow(InvalidStoredWalletError)
  })
})

