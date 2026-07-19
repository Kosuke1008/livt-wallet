import { describe, expect, it } from 'vitest'
import type { Address, Hash } from 'viem'
import {
  clearKnownPaymentTransactionHash,
  loadKnownPaymentTransactionHash,
  saveKnownPaymentTransactionHash,
  type PaymentProgressStorage,
} from '../../../src/payments/livtPaymentProgress'

const sender = '0x3333333333333333333333333333333333333333' as Address
const otherSender = '0x4444444444444444444444444444444444444444' as Address
const transactionHash = `0x${'a'.repeat(64)}` as Hash

describe('LivT payment progress', () => {
  it('payment IDと送金元ごとに既知hashを保存・復旧・削除する', () => {
    const storage = createMemoryStorage()

    saveKnownPaymentTransactionHash('42', sender, transactionHash, storage)

    expect(loadKnownPaymentTransactionHash('42', sender, storage)).toBe(
      transactionHash,
    )
    expect(
      loadKnownPaymentTransactionHash('42', otherSender, storage),
    ).toBeNull()
    expect(loadKnownPaymentTransactionHash('43', sender, storage)).toBeNull()

    clearKnownPaymentTransactionHash('42', sender, storage)
    expect(loadKnownPaymentTransactionHash('42', sender, storage)).toBeNull()
  })

  it('壊れたhashを復旧せずstorageから除去する', () => {
    const storage = createMemoryStorage()
    storage.setItem(
      'livt-wallet:payment-transaction:42:0x3333333333333333333333333333333333333333',
      'not-a-hash',
    )

    expect(loadKnownPaymentTransactionHash('42', sender, storage)).toBeNull()
    expect(storage.values.size).toBe(0)
  })
})

function createMemoryStorage(): PaymentProgressStorage & {
  readonly values: Map<string, string>
} {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}
