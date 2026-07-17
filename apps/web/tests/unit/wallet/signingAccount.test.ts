import { describe, expect, it, vi } from 'vitest'
import {
  encryptMnemonic,
  IncorrectPasswordError,
  saveEncryptedWallet,
} from '../../../src/wallet/encryptedWallet'
import {
  SigningAccountMismatchError,
  withStoredSigningAccount,
} from '../../../src/wallet/signingAccount'

const mnemonic = 'test test test test test test test test test test test junk'
const address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const otherAddress = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

async function createStorage(password: string): Promise<MemoryStorage> {
  const storage = new MemoryStorage()
  saveEncryptedWallet(await encryptMnemonic(mnemonic, password), storage)
  return storage
}

describe('temporary signing account reconstruction', () => {
  it('必要な処理中だけ復号したlocal accountを渡す', async () => {
    const storage = await createStorage('correct-password')
    const operation = vi.fn(async (account) => account.address)

    await expect(
      withStoredSigningAccount(
        'correct-password',
        address,
        operation,
        storage,
      ),
    ).resolves.toBe(address)
    expect(operation).toHaveBeenCalledOnce()
    expect(operation.mock.calls[0]?.[0]).toMatchObject({
      address,
      type: 'local',
    })
  })

  it('保存済みaddressと解除中addressの不一致を復号・署名前に拒否する', async () => {
    const storage = await createStorage('correct-password')
    const operation = vi.fn()

    await expect(
      withStoredSigningAccount(
        'correct-password',
        otherAddress,
        operation,
        storage,
      ),
    ).rejects.toBeInstanceOf(SigningAccountMismatchError)
    expect(operation).not.toHaveBeenCalled()
  })

  it('誤ったpasswordでは署名処理を一度も呼ばない', async () => {
    const storage = await createStorage('correct-password')
    const operation = vi.fn()

    await expect(
      withStoredSigningAccount(
        'wrong-password',
        address,
        operation,
        storage,
      ),
    ).rejects.toBeInstanceOf(IncorrectPasswordError)
    expect(operation).not.toHaveBeenCalled()
  })
})
