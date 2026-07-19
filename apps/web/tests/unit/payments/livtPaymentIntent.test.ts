import { describe, expect, it } from 'vitest'
import type { Address } from 'viem'
import {
  assertLivtPaymentDetailsUnchanged,
  createLivtPaymentIntent,
  PaymentAmountMismatchError,
  PaymentDetailsChangedError,
  PaymentStateRejectionError,
  UnsupportedPaymentChainError,
  UnsupportedPaymentTokenError,
} from '../../../src/payments/livtPaymentIntent'
import { InvalidTransferRecipientError } from '../../../src/tokens/transferValidation'
import type { LivtPaymentDetails } from '../../../src/payments/livtPaymentApi'

const sender = '0x3333333333333333333333333333333333333333' as Address

const details: LivtPaymentDetails = {
  id: 42,
  amount: 125,
  display_amount: '125',
  atomic_amount: '125000000000000000000',
  status: 'pending',
  store_name: 'Intent Test Store',
  recipient_address: '0x2222222222222222222222222222222222222222',
  network: 'kairos',
  chain_name: 'Kaia Kairos Testnet',
  chain_id: 1001,
  token_contract: '0xe7c3d8c9a439fede00d2600032d5db0be71c3c29',
  token_symbol: 'JPYC',
  token_decimals: 18,
  expires_at: '2026-07-18 04:00:00',
  expires_at_iso: '2026-07-18T04:00:00+00:00',
}

describe('LivT payment intent', () => {
  it('server atomic amountをbigintのままexact transfer intentへ変換する', () => {
    const payment = createLivtPaymentIntent({
      requestedPaymentId: '42',
      details,
      sender,
      availableBalance: 1_000_000_000_000_000_000_000n,
      now: new Date('2026-07-18T03:00:00+00:00'),
    })

    expect(payment.intent.rawAmount).toBe(125_000_000_000_000_000_000n)
    expect(payment.intent.normalizedAmount).toBe('125')
    expect(payment.intent.recipient).toBe(
      '0x2222222222222222222222222222222222222222',
    )
  })

  it('unsupported chainを署名前に拒否する', () => {
    expect(() =>
      createIntent({ ...details, chain_id: 1, network: 'mainnet' }),
    ).toThrow(UnsupportedPaymentChainError)
  })

  it.each([
    { ...details, token_contract: '0x1111111111111111111111111111111111111111' },
    { ...details, token_symbol: 'OTHER' },
    { ...details, token_decimals: 6 },
  ])('unsupported token metadataを署名前に拒否する', (value) => {
    expect(() => createIntent(value)).toThrow(UnsupportedPaymentTokenError)
  })

  it('display amountとatomic amountの不一致を拒否する', () => {
    expect(() =>
      createIntent({
        ...details,
        atomic_amount: '124000000000000000000',
      }),
    ).toThrow(PaymentAmountMismatchError)
  })

  it('invalid recipientを既存recipient validationで明示拒否する', () => {
    expect(() =>
      createIntent({
        ...details,
        recipient_address: sender,
      }),
    ).toThrow(InvalidTransferRecipientError)
  })

  it('表示後にauthoritative detailsが変わった場合は拒否する', () => {
    expect(() =>
      assertLivtPaymentDetailsUnchanged(details, {
        ...details,
        atomic_amount: '126000000000000000000',
      }),
    ).toThrow(PaymentDetailsChangedError)
  })

  it.each([
    { ...details, status: 'confirmed' as const },
    { ...details, expires_at_iso: '2026-07-18T02:59:59+00:00' },
    { ...details, expires_at_iso: null },
  ])('支払えないpayment stateを拒否する', (value) => {
    expect(() => createIntent(value)).toThrow(PaymentStateRejectionError)
  })

  it('JPYC balance不足を既存transfer validationで拒否する', () => {
    expect(() =>
      createLivtPaymentIntent({
        requestedPaymentId: '42',
        details,
        sender,
        availableBalance: 1n,
        now: new Date('2026-07-18T03:00:00+00:00'),
      }),
    ).toThrowError(/exceeds-balance/)
  })
})

function createIntent(value: LivtPaymentDetails) {
  return createLivtPaymentIntent({
    requestedPaymentId: '42',
    details: value,
    sender,
    availableBalance: 1_000_000_000_000_000_000_000n,
    now: new Date('2026-07-18T03:00:00+00:00'),
  })
}
