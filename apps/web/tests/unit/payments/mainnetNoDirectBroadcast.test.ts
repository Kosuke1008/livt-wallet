import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Mainnet pilot has no direct broadcast fallback', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('VITE_BLOCKCHAIN_NETWORK', 'kaia-mainnet')
    vi.stubEnv('VITE_BLOCKCHAIN_KAIA_MAINNET_RPC_URL', 'https://mainnet.example.test')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('rejects direct submission before invoking an injected broadcaster', async () => {
    const { executeLivtPayment } = await import('../../../src/payments/livtPaymentFlow')
    const transferExecutor = vi.fn()
    const apiClient = {
      sponsorPayment: vi.fn(),
      confirmPayment: vi.fn(),
    }

    await expect(executeLivtPayment({
      paymentId: '1',
      intent: {} as never,
      password: 'test-only-password',
      accessToken: 'test-only-token',
      apiClient: apiClient as never,
      submissionMode: 'direct',
      transferExecutor,
    })).rejects.toThrow('Mainnet direct payment execution is disabled')
    expect(transferExecutor).not.toHaveBeenCalled()
    expect(apiClient.sponsorPayment).not.toHaveBeenCalled()
  })
})
