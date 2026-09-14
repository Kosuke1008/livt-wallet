import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Address } from 'viem'
import type { LivtPaymentDetails } from '../../../src/payments/livtPaymentApi'

const sender = '0x3333333333333333333333333333333333333333' as Address
const merchant = '0x2222222222222222222222222222222222222222'
const pilot = {
  payment_id: 42,
  store_id: 1,
  user_id: 1,
  merchant_address: merchant,
  sender_address: sender,
}

const details: LivtPaymentDetails = {
  id: 42,
  amount: 1,
  display_amount: '1',
  atomic_amount: '1000000000000000000',
  status: 'pending',
  store_name: 'Pilot Store',
  recipient_address: merchant,
  network: 'kaia-mainnet',
  chain_name: 'Kaia Mainnet',
  chain_id: 8217,
  token_contract: '0xe7c3d8c9a439fede00d2600032d5db0be71c3c29',
  token_symbol: 'JPYC',
  token_decimals: 18,
  network_profile_version: 1,
  mainnet_pilot: pilot,
  expires_at: '2026-09-09 01:00:00',
  expires_at_iso: '2026-09-09T01:00:00Z',
}

describe('Mainnet pilot payment intent', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('VITE_BLOCKCHAIN_NETWORK', 'kaia-mainnet')
    vi.stubEnv('VITE_BLOCKCHAIN_KAIA_MAINNET_RPC_URL', 'https://mainnet.example.test')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('exact approved 1 JPYC snapshotを受け付けるがexecution gateは閉じたまま', async () => {
    const { createLivtPaymentIntent } = await import('../../../src/payments/livtPaymentIntent')
    const { ACTIVE_NETWORK_PROFILE } = await import('../../../src/blockchain/networkProfiles')
    expect(createLivtPaymentIntent({ requestedPaymentId: '42', details, sender,
      availableBalance: 2_000_000_000_000_000_000n, now: new Date('2026-09-09T00:00:00Z') }).intent.rawAmount)
      .toBe(1_000_000_000_000_000_000n)
    expect(ACTIVE_NETWORK_PROFILE.paymentExecutionEnabled).toBe(false)
    expect(ACTIVE_NETWORK_PROFILE.feeDelegationExecutionEnabled).toBe(false)
  })

  it.each([
    { network_profile_version: 2 },
    { mainnet_pilot: null },
    { mainnet_pilot: { ...pilot, payment_id: 43 } },
    { mainnet_pilot: { ...pilot, sender_address: merchant } },
    { mainnet_pilot: { ...pilot, merchant_address: sender } },
    { amount: 2, display_amount: '2', atomic_amount: '2000000000000000000' },
  ])('approval/snapshot driftを署名前に拒否する', async (override) => {
    const { createLivtPaymentIntent, MainnetPilotApprovalMismatchError } =
      await import('../../../src/payments/livtPaymentIntent')
    expect(() => createLivtPaymentIntent({ requestedPaymentId: '42', details: { ...details, ...override }, sender,
      availableBalance: 3_000_000_000_000_000_000n, now: new Date('2026-09-09T00:00:00Z') }))
      .toThrow(MainnetPilotApprovalMismatchError)
  })
})
