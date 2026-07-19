import { describe, expect, it } from 'vitest'
import {
  InvalidPaymentRequestError,
  parseLivtPaymentRequest,
} from '../../../src/payments/paymentRequest'

describe('LivT payment request', () => {
  it('HTTPS Wallet URLからpayment IDだけを取得する', () => {
    expect(
      parseLivtPaymentRequest(
        new URL('https://wallet.example.test/?payment_id=123'),
      ),
    ).toEqual({ paymentId: '123' })
  })

  it('payment requestがなければ通常Wallet modeを維持する', () => {
    expect(
      parseLivtPaymentRequest(new URL('https://wallet.example.test/')),
    ).toBeNull()
  })

  it.each([
    'https://wallet.example.test/?payment_id=',
    'https://wallet.example.test/?payment_id=0',
    'https://wallet.example.test/?payment_id=01',
    'https://wallet.example.test/?payment_id=-1',
    'https://wallet.example.test/?payment_id=1.5',
    'https://wallet.example.test/?payment_id=1%2Fconfirm',
  ])('不正なpayment IDを拒否する: %s', (url) => {
    expect(() => parseLivtPaymentRequest(new URL(url))).toThrow(
      InvalidPaymentRequestError,
    )
  })

  it('重複payment IDを曖昧なrequestとして拒否する', () => {
    expect(() =>
      parseLivtPaymentRequest(
        new URL(
          'https://wallet.example.test/?payment_id=1&payment_id=2',
        ),
      ),
    ).toThrow(InvalidPaymentRequestError)
  })
})
