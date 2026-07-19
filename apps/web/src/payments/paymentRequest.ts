export interface LivtPaymentRequest {
  readonly paymentId: string
}

export type InvalidPaymentRequestReason =
  | 'duplicate-id'
  | 'malformed-id'

export class InvalidPaymentRequestError extends Error {
  readonly name = 'InvalidPaymentRequestError'
  readonly reason: InvalidPaymentRequestReason

  constructor(reason: InvalidPaymentRequestReason) {
    super(`Invalid LivT payment request: ${reason}`)
    this.reason = reason
  }
}

export function parseLivtPaymentRequest(
  url: URL,
): LivtPaymentRequest | null {
  const paymentIds = url.searchParams.getAll('payment_id')

  if (paymentIds.length === 0) return null
  if (paymentIds.length !== 1) {
    throw new InvalidPaymentRequestError('duplicate-id')
  }

  const paymentId = paymentIds[0]
  if (!/^[1-9]\d{0,18}$/.test(paymentId)) {
    throw new InvalidPaymentRequestError('malformed-id')
  }

  return Object.freeze({ paymentId })
}
