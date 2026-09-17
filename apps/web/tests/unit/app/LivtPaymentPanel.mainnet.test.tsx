// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Address } from 'viem'
import type { LivtPaymentApiClient, LivtPaymentDetails, PaymentTokenStorage } from '../../../src/payments/livtPaymentApi'
import type { LivtFeeDelegatedTransferExecutor } from '../../../src/payments/livtPaymentFlow'

const sender = '0x3333333333333333333333333333333333333333' as Address
const merchant = '0x2222222222222222222222222222222222222222'
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
  mainnet_pilot: {
    payment_id: 42,
    store_id: 1,
    user_id: 7,
    merchant_address: merchant,
    sender_address: sender,
  },
  expires_at: '2026-09-15 01:00:00',
  expires_at_iso: '2026-09-15T01:00:00Z',
}

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('VITE_BLOCKCHAIN_NETWORK', 'kaia-mainnet')
  vi.stubEnv('VITE_BLOCKCHAIN_KAIA_MAINNET_RPC_URL', 'https://mainnet.example.test')
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})

afterEach(() => {
  if (root !== null) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('LivtPaymentPanel Mainnet fee delegation UI', () => {
  it('Fee Payer利用不可ならKAIA残高UIを出さず支払いを無効化する', async () => {
    const view = await renderMainnetPanel(false)

    expect(view.textContent).toContain('Mainnet pilotのFee Payer経路を確認できません。')
    expect(view.textContent).not.toContain('手数料に必要なKAIA残高が不足しています。')
    expect(view.textContent).not.toContain('KAIA残高を確認しています')
    expect(view.textContent).not.toContain('native balance error')
    expect(view.textContent).not.toContain('手数料はKAIAで支払います。')
    expect(findPaymentButton(view).disabled).toBe(true)
    expect(view.textContent).not.toContain('自分のKAIAで手数料を支払う')
  })

  it('Fee Payer利用可能なら送金元KAIA残高を要求しない', async () => {
    const view = await renderMainnetPanel(true)

    expect(view.textContent).not.toContain('KAIA残高が不足しています')
    expect(view.textContent).not.toContain('native balance error')
    expect(view.textContent).not.toContain('KAIA残高を確認しています')
    expect(view.textContent).toContain('決済手数料はLivTが負担します。')
    expect(view.textContent).not.toContain('自分のKAIAで手数料を支払う')
    await enterSigningPassword(view)
    expect(findPaymentButton(view).disabled).toBe(false)
  })

  it('署名前のclient-side失敗は送信結果不明と表示しない', async () => {
    const { loadUnknownPaymentAttempt } = await import('../../../src/payments/livtPaymentProgress')
    const storage = createTokenStorage()
    const executor = vi.fn<LivtFeeDelegatedTransferExecutor>().mockRejectedValue(new Error('signing failed'))
    const view = await renderMainnetPanel(true, { storage, executor })

    await enterSigningPassword(view)
    await clickPayment(view)

    expect(executor).toHaveBeenCalledOnce()
    expect(view.textContent).toContain('お支払い処理を完了できませんでした。')
    expect(view.textContent).not.toContain('Fee Payerの結果を確認できません')
    expect(loadUnknownPaymentAttempt('42', sender, storage)).toBe(false)
  })

  it('署名前のpayment details再取得失敗も送信結果不明にしない', async () => {
    const { LivtPaymentApiError } = await import('../../../src/payments/livtPaymentApi')
    const { loadUnknownPaymentAttempt } = await import('../../../src/payments/livtPaymentProgress')
    const storage = createTokenStorage()
    const apiClient = createApiClient(true)
    vi.mocked(apiClient.getPaymentDetails)
      .mockResolvedValueOnce(details)
      .mockRejectedValueOnce(new LivtPaymentApiError('backend-unavailable'))
    const executor = vi.fn<LivtFeeDelegatedTransferExecutor>()
    const view = await renderMainnetPanel(true, { storage, apiClient, executor })

    await enterSigningPassword(view)
    await clickPayment(view)

    expect(view.textContent).toContain('LivTへ接続できませんでした。')
    expect(view.textContent).not.toContain('Fee Payerの結果を確認できません')
    expect(loadUnknownPaymentAttempt('42', sender, storage)).toBe(false)
    expect(executor).not.toHaveBeenCalled()
    expect(apiClient.sponsorPayment).not.toHaveBeenCalled()
  })

  it('Laravelの明示的な4xx拒否は失敗扱いとし、同じ画面で再送させない', async () => {
    const { LivtPaymentApiError } = await import('../../../src/payments/livtPaymentApi')
    const { loadUnknownPaymentAttempt } = await import('../../../src/payments/livtPaymentProgress')
    const storage = createTokenStorage()
    const apiClient = createApiClient(true)
    vi.mocked(apiClient.sponsorPayment).mockRejectedValue(
      new LivtPaymentApiError('sponsorship-rejected', 400),
    )
    const executor = vi.fn<LivtFeeDelegatedTransferExecutor>(async (options) => {
      options.onPhase?.({ phase: 'broadcasting' })
      await options.sponsorTransaction('0x3101')
      throw new Error('unreachable')
    })
    const view = await renderMainnetPanel(true, { storage, apiClient, executor })

    await enterSigningPassword(view)
    await clickPayment(view)

    expect(view.textContent).toContain('Fee Payerに決済を受け付けてもらえませんでした。')
    expect(view.textContent).not.toContain('Fee Payerの結果を確認できません')
    expect(view.textContent).not.toContain('内容確認へ戻る')
    expect(loadUnknownPaymentAttempt('42', sender, storage)).toBe(true)
    expect(apiClient.sponsorPayment).toHaveBeenCalledOnce()
  })

  it('sponsor requestのtransport失敗は結果不明として保持し、自動・手動再送しない', async () => {
    const { LivtPaymentApiError } = await import('../../../src/payments/livtPaymentApi')
    const { loadUnknownPaymentAttempt } = await import('../../../src/payments/livtPaymentProgress')
    const storage = createTokenStorage()
    const apiClient = createApiClient(true)
    vi.mocked(apiClient.sponsorPayment).mockRejectedValue(
      new LivtPaymentApiError('sponsorship-unknown', null),
    )
    const executor = vi.fn<LivtFeeDelegatedTransferExecutor>(async (options) => {
      options.onPhase?.({ phase: 'broadcasting' })
      await options.sponsorTransaction('0x3101')
      throw new Error('unreachable')
    })
    const view = await renderMainnetPanel(true, { storage, apiClient, executor })

    await enterSigningPassword(view)
    await clickPayment(view)

    expect(view.textContent).toContain('Fee Payerの結果を確認できません')
    expect(view.textContent).not.toContain('内容確認へ戻る')
    expect(loadUnknownPaymentAttempt('42', sender, storage)).toBe(true)
    expect(apiClient.sponsorPayment).toHaveBeenCalledOnce()
    expect(executor).toHaveBeenCalledOnce()

    await act(async () => root?.unmount())
    container?.remove()
    root = null
    container = null
    const reopened = await renderMainnetPanel(true, { storage, apiClient, executor })
    expect(reopened.textContent).toContain('Fee Payerの結果を確認できません')
    expect(reopened.textContent).not.toContain('内容を確認してJPYCを送る')
    expect(executor).toHaveBeenCalledOnce()
  })
})

async function renderMainnetPanel(
  feeDelegationAvailable: boolean,
  overrides: {
    storage?: PaymentTokenStorage
    apiClient?: LivtPaymentApiClient
    executor?: LivtFeeDelegatedTransferExecutor
  } = {},
): Promise<HTMLDivElement> {
  const { LivtPaymentPanel } = await import('../../../src/app/LivtPaymentPanel')
  const { savePaymentAccessToken } = await import('../../../src/payments/livtPaymentApi')
  const tokenStorage = overrides.storage ?? createTokenStorage()
  savePaymentAccessToken('1|short-lived-token', tokenStorage)
  const apiClient = overrides.apiClient ?? createApiClient(feeDelegationAvailable)

  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      <LivtPaymentPanel
        request={{ paymentId: '42' }}
        sender={sender}
        availableJpycBalance={2_000_000_000_000_000_000n}
        hasNativeBalance={false}
        nativeBalanceError="native balance error"
        isNativeBalanceLoading
        apiClient={apiClient}
        feeDelegatedTransferExecutor={overrides.executor}
        onConfirmed={vi.fn().mockResolvedValue(undefined)}
        onBack={vi.fn()}
        tokenStorage={tokenStorage}
        now={() => new Date('2026-09-14T00:00:00Z')}
      />,
    )
    await Promise.resolve()
    await Promise.resolve()
  })
  return container
}

function createTokenStorage(): PaymentTokenStorage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: (key) => { values.delete(key) },
  }
}

function createApiClient(feeDelegationAvailable: boolean): LivtPaymentApiClient {
  return {
    getPaymentDetails: vi.fn().mockResolvedValue(details),
    getPaymentSponsorshipAvailability: vi.fn().mockResolvedValue(feeDelegationAvailable),
    getCurrentUser: vi.fn().mockResolvedValue({ id: 7, name: 'Pilot User' }),
    sponsorPayment: vi.fn(),
  } as unknown as LivtPaymentApiClient
}

async function clickPayment(view: HTMLDivElement): Promise<void> {
  await act(async () => {
    findPaymentButton(view).click()
    await Promise.resolve()
    await Promise.resolve()
  })
}

function findPaymentButton(view: HTMLDivElement): HTMLButtonElement {
  const button = Array.from(view.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.includes('内容を確認してJPYCを送る'),
  )
  if (button === undefined) throw new Error('Payment button not found')
  return button
}

async function enterSigningPassword(view: HTMLDivElement): Promise<void> {
  const input = view.querySelector<HTMLInputElement>('#livt-payment-signing-password')
  if (input === null) throw new Error('Signing password input not found')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'wallet-password')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
