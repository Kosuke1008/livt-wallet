import type { Address, Hash } from 'viem'

const paymentIdPattern = /^[1-9]\d{0,18}$/
const addressPattern = /^0x[0-9a-fA-F]{40}$/
const transactionHashPattern = /^0x[0-9a-fA-F]{64}$/
const storagePrefix = 'livt-wallet:payment-transaction:'
const attemptPrefix = 'livt-wallet:payment-attempt:'

export type PaymentProgressStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
>

export function loadKnownPaymentTransactionHash(
  paymentId: string,
  sender: Address,
  storage: PaymentProgressStorage = sessionStorage,
): Hash | null {
  const key = progressKey(paymentId, sender)
  const value = storage.getItem(key)

  if (value === null) return null
  if (!transactionHashPattern.test(value)) {
    storage.removeItem(key)
    return null
  }

  return value.toLowerCase() as Hash
}

export function saveKnownPaymentTransactionHash(
  paymentId: string,
  sender: Address,
  transactionHash: Hash,
  storage: PaymentProgressStorage = sessionStorage,
): void {
  if (!transactionHashPattern.test(transactionHash)) {
    throw new Error('Invalid payment transaction hash')
  }

  storage.setItem(
    progressKey(paymentId, sender),
    transactionHash.toLowerCase(),
  )
}

export function clearKnownPaymentTransactionHash(
  paymentId: string,
  sender: Address,
  storage: PaymentProgressStorage = sessionStorage,
): void {
  storage.removeItem(progressKey(paymentId, sender))
}

export function loadUnknownPaymentAttempt(
  paymentId: string,
  sender: Address,
  storage: PaymentProgressStorage = sessionStorage,
): boolean {
  return storage.getItem(attemptKey(paymentId, sender)) === 'unknown'
}

export function saveUnknownPaymentAttempt(
  paymentId: string,
  sender: Address,
  storage: PaymentProgressStorage = sessionStorage,
): void {
  const key = attemptKey(paymentId, sender)
  storage.setItem(key, 'unknown')
  if (storage.getItem(key) !== 'unknown') {
    throw new Error('Payment attempt storage is unavailable')
  }
}

export function clearUnknownPaymentAttempt(
  paymentId: string,
  sender: Address,
  storage: PaymentProgressStorage = sessionStorage,
): void {
  storage.removeItem(attemptKey(paymentId, sender))
}

function progressKey(paymentId: string, sender: Address): string {
  if (!paymentIdPattern.test(paymentId) || !addressPattern.test(sender)) {
    throw new Error('Invalid payment progress scope')
  }

  return `${storagePrefix}${paymentId}:${sender.toLowerCase()}`
}

function attemptKey(paymentId: string, sender: Address): string {
  if (!paymentIdPattern.test(paymentId) || !addressPattern.test(sender)) {
    throw new Error('Invalid payment attempt scope')
  }

  return `${attemptPrefix}${paymentId}:${sender.toLowerCase()}`
}
