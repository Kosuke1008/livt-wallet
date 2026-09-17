// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Address, Hash } from 'viem'
import { LivtPaymentPanel } from '../../../src/app/LivtPaymentPanel'
import {
  LivtPaymentApiError,
  savePaymentAccessToken,
  type LivtPaymentApiClient,
  type LivtPaymentDetails,
  type PaymentTokenStorage,
} from '../../../src/payments/livtPaymentApi'
import { saveKnownPaymentTransactionHash } from '../../../src/payments/livtPaymentProgress'
import type { LivtPaymentTransferExecutor } from '../../../src/payments/livtPaymentFlow'
import type { LivtFeeDelegatedTransferExecutor } from '../../../src/payments/livtPaymentFlow'
import type { JpycTransferResult } from '../../../src/tokens/jpycTransfer'
import { TransferConfirmationTimeoutError } from '../../../src/tokens/jpycTransfer'

const sender = '0x3333333333333333333333333333333333333333' as Address
const transactionHash = `0x${'a'.repeat(64)}` as Hash
const fixedNow = () => new Date('2026-07-18T03:00:00+00:00')

const details: LivtPaymentDetails = {
  id: 42,
  amount: 125,
  display_amount: '125',
  atomic_amount: '125000000000000000000',
  status: 'pending',
  store_name: 'Panel Test Store',
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

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})

afterEach(() => {
  if (root !== null) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.restoreAllMocks()
})

describe('LivtPaymentPanel', () => {
  it('authoritative detailsを固定表示し、支払わずに戻れる', async () => {
    const onBack = vi.fn()
    const transferExecutor = vi.fn<LivtPaymentTransferExecutor>()
    const view = await renderPanel({ onBack, transferExecutor })

    expect(view.textContent).toContain('Panel Test Store')
    expect(view.textContent).toContain('125 JPYC')
    expect(view.textContent).toContain(details.recipient_address)
    expect(view.textContent).toContain(details.token_contract)
    expect(view.textContent).toContain('Kaia Kairos Testnet')

    await act(async () => {
      findButton(view, '支払わずに戻る').click()
    })

    expect(onBack).toHaveBeenCalledOnce()
    expect(transferExecutor).not.toHaveBeenCalled()
  })

  it('二重clickでもblockchain transferを一度しか開始しない', async () => {
    let resolveTransfer: ((value: JpycTransferResult) => void) | null = null
    const transferExecutor = vi.fn<LivtPaymentTransferExecutor>(
      () =>
        new Promise((resolve) => {
          resolveTransfer = resolve
        }) as ReturnType<LivtPaymentTransferExecutor>,
    )
    const apiClient = createApiClient()
    const view = await renderPanel({ transferExecutor, apiClient })
    const passwordInput = view.querySelector<HTMLInputElement>(
      '#livt-payment-signing-password',
    )
    expect(passwordInput).not.toBeNull()

    await act(async () => {
      if (passwordInput === null) return
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.call(passwordInput, 'wallet-password')
      passwordInput.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const submit = findButton(view, '内容を確認してJPYCを送る')
    expect(submit.disabled).toBe(false)
    await act(async () => {
      submit.click()
      submit.click()
      await Promise.resolve()
    })

    expect(transferExecutor).toHaveBeenCalledOnce()

    await act(async () => {
      resolveTransfer?.({
        status: 'success',
        transactionHash,
        sender,
        recipient: details.recipient_address as Address,
        enteredAmount: '125',
        normalizedAmount: '125',
        estimatedGas: 50_000n,
        gasPrice: 25_000_000_000n,
      })
      await flushPromises()
    })

    expect(apiClient.confirmPayment).toHaveBeenCalledOnce()
    expect(view.textContent).toContain('お支払いが確認されました')
  })

  it('unsupported chainを表示して署名操作を提供しない', async () => {
    const apiClient = createApiClient({ ...details, chain_id: 1 })
    const transferExecutor = vi.fn<LivtPaymentTransferExecutor>()
    const view = await renderPanel({ apiClient, transferExecutor })

    expect(view.textContent).toContain(
      '指定したネットワークはこのWalletで利用できません',
    )
    expect(
      Array.from(view.querySelectorAll('button')).some((button) =>
        button.textContent?.includes('JPYCを送る'),
      ),
    ).toBe(false)
    expect(transferExecutor).not.toHaveBeenCalled()
  })

  it('署名click直前に期限を再取得・再検証して送金を止める', async () => {
    let currentTime = new Date('2026-07-18T03:00:00+00:00')
    const transferExecutor = vi.fn<LivtPaymentTransferExecutor>()
    const view = await renderPanel({
      transferExecutor,
      now: () => currentTime,
    })

    await enterSigningPassword(view)
    currentTime = new Date('2026-07-18T04:00:01+00:00')

    await act(async () => {
      findButton(view, '内容を確認してJPYCを送る').click()
      await flushPromises()
    })

    expect(transferExecutor).not.toHaveBeenCalled()
    expect(view.textContent).toContain('期限切れ')
  })

  it('保存済みhashの復旧後はtransferせずconfirmだけ再試行する', async () => {
    const storage = createTokenStorage()
    saveKnownPaymentTransactionHash('42', sender, transactionHash, storage)
    const transferExecutor = vi.fn<LivtPaymentTransferExecutor>()
    const apiClient = createApiClient()
    const view = await renderPanel({
      storage,
      transferExecutor,
      apiClient,
    })

    expect(view.textContent).toContain('保存済みの取引番号')
    expect(view.textContent).toContain(transactionHash)

    await act(async () => {
      findButton(view, '送金せず確認だけ再試行').click()
      await flushPromises()
    })

    expect(transferExecutor).not.toHaveBeenCalled()
    expect(apiClient.confirmPayment).toHaveBeenCalledWith(
      '42',
      transactionHash,
      '1|short-lived-token',
    )
    expect(view.textContent).toContain('お支払いが確認されました')
  })

  it('receipt timeoutで既知hashをconfirmしtransferを再実行しない', async () => {
    const transferExecutor = vi
      .fn<LivtPaymentTransferExecutor>()
      .mockRejectedValue(
        new TransferConfirmationTimeoutError(transactionHash),
      )
    const apiClient = createApiClient()
    const view = await renderPanel({ transferExecutor, apiClient })

    await enterSigningPassword(view)
    await act(async () => {
      findButton(view, '内容を確認してJPYCを送る').click()
      await flushPromises()
    })

    expect(transferExecutor).toHaveBeenCalledOnce()
    expect(apiClient.confirmPayment).toHaveBeenCalledOnce()
    expect(view.textContent).toContain('お支払いが確認されました')
  })

  it('fee delegation有効時は送金元KAIAがなくてもLivT負担で支払える', async () => {
    const apiClient = createApiClient(details, true)
    const directExecutor = vi.fn<LivtPaymentTransferExecutor>()
    const feeDelegatedTransferExecutor = vi
      .fn<LivtFeeDelegatedTransferExecutor>()
      .mockResolvedValue({
        status: 'success',
        transactionHash,
        sender,
        recipient: details.recipient_address as Address,
        enteredAmount: '125',
        normalizedAmount: '125',
        estimatedGas: 50_000n,
        gasPrice: 25_000_000_000n,
      })
    const view = await renderPanel({
      apiClient,
      transferExecutor: directExecutor,
      feeDelegatedTransferExecutor,
      hasNativeBalance: false,
    })

    expect(view.textContent).toContain('決済手数料はLivTが負担します')
    expect(view.textContent).not.toContain('KAIA残高が不足しています')
    expect(findButton(view, '内容を確認してJPYCを送る').disabled).toBe(true)
    await enterSigningPassword(view)
    expect(findButton(view, '内容を確認してJPYCを送る').disabled).toBe(false)

    await act(async () => {
      findButton(view, '内容を確認してJPYCを送る').click()
      await flushPromises()
    })

    expect(directExecutor).not.toHaveBeenCalled()
    expect(feeDelegatedTransferExecutor).toHaveBeenCalledOnce()
    expect(apiClient.confirmPayment).toHaveBeenCalledWith(
      '42',
      transactionHash,
      '1|short-lived-token',
    )
  })

  it('Kairos直接払いでは送金元KAIA残高が必要', async () => {
    const view = await renderPanel({ hasNativeBalance: false })
    await enterSigningPassword(view)

    expect(view.textContent).toContain('手数料に必要なKAIA残高が不足しています。')
    expect(findButton(view, '内容を確認してJPYCを送る').disabled).toBe(true)
  })

  it('fee delegation有効時も署名前に既存の直接送信を選べる', async () => {
    const apiClient = createApiClient(details, true)
    const directExecutor = vi
      .fn<LivtPaymentTransferExecutor>()
      .mockResolvedValue({
        status: 'success',
        transactionHash,
        sender,
        recipient: details.recipient_address as Address,
        enteredAmount: '125',
        normalizedAmount: '125',
        estimatedGas: 50_000n,
        gasPrice: 25_000_000_000n,
      })
    const feeDelegatedTransferExecutor =
      vi.fn<LivtFeeDelegatedTransferExecutor>()
    const view = await renderPanel({
      apiClient,
      transferExecutor: directExecutor,
      feeDelegatedTransferExecutor,
    })

    await act(async () => {
      findButton(view, '自分のKAIAで手数料を支払う').click()
    })
    expect(view.textContent).toContain('手数料はKAIAで支払います')

    await enterSigningPassword(view)
    await act(async () => {
      findButton(view, '内容を確認してJPYCを送る').click()
      await flushPromises()
    })

    expect(directExecutor).toHaveBeenCalledOnce()
    expect(feeDelegatedTransferExecutor).not.toHaveBeenCalled()
    expect(apiClient.confirmPayment).toHaveBeenCalledWith(
      '42',
      transactionHash,
      '1|short-lived-token',
    )
  })

  it('Fee Payer結果不明時は再署名ボタンを出さない', async () => {
    const apiClient = createApiClient(details, true)
    const feeDelegatedTransferExecutor = vi
      .fn<LivtFeeDelegatedTransferExecutor>()
      .mockRejectedValue(
        new LivtPaymentApiError('sponsorship-unknown', 503),
      )
    const view = await renderPanel({
      apiClient,
      feeDelegatedTransferExecutor,
      hasNativeBalance: false,
    })
    await enterSigningPassword(view)

    await act(async () => {
      findButton(view, '内容を確認してJPYCを送る').click()
      await flushPromises()
    })

    expect(view.textContent).toContain('Fee Payerの結果を確認できません')
    expect(view.textContent).toContain('再度署名・送信しないでください')
    expect(
      Array.from(view.querySelectorAll('button')).some((button) =>
        button.textContent?.includes('内容確認へ戻る'),
      ),
    ).toBe(false)
    expect(apiClient.confirmPayment).not.toHaveBeenCalled()
  })
})

async function renderPanel(overrides: {
  readonly apiClient?: LivtPaymentApiClient
  readonly transferExecutor?: LivtPaymentTransferExecutor
  readonly feeDelegatedTransferExecutor?: LivtFeeDelegatedTransferExecutor
  readonly onBack?: () => void
  readonly storage?: PaymentTokenStorage
  readonly now?: () => Date
  readonly hasNativeBalance?: boolean
}): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const storage = overrides.storage ?? createTokenStorage()
  savePaymentAccessToken('1|short-lived-token', storage)

  await act(async () => {
    root?.render(
      <LivtPaymentPanel
        request={{ paymentId: '42' }}
        sender={sender}
        availableJpycBalance={1_000_000_000_000_000_000_000n}
        hasNativeBalance={overrides.hasNativeBalance ?? true}
        apiClient={overrides.apiClient ?? createApiClient()}
        onConfirmed={vi.fn().mockResolvedValue(undefined)}
        onBack={overrides.onBack ?? vi.fn()}
        tokenStorage={storage}
        transferExecutor={overrides.transferExecutor}
        feeDelegatedTransferExecutor={overrides.feeDelegatedTransferExecutor}
        now={overrides.now ?? fixedNow}
      />,
    )
    await flushPromises()
  })

  return container
}

function createApiClient(
  paymentDetails: LivtPaymentDetails = details,
  feeDelegationAvailable = false,
): LivtPaymentApiClient {
  return {
    getPaymentDetails: vi.fn().mockResolvedValue(paymentDetails),
    getPaymentSponsorshipAvailability: vi
      .fn()
      .mockResolvedValue(feeDelegationAvailable),
    login: vi.fn(),
    getCurrentUser: vi.fn().mockResolvedValue({
      id: 7,
      name: 'Panel User',
    }),
    sponsorPayment: vi.fn().mockResolvedValue(transactionHash),
    confirmPayment: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
  }
}

async function enterSigningPassword(view: HTMLDivElement): Promise<void> {
  const passwordInput = view.querySelector<HTMLInputElement>(
    '#livt-payment-signing-password',
  )
  expect(passwordInput).not.toBeNull()

  await act(async () => {
    if (passwordInput === null) return
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set?.call(passwordInput, 'wallet-password')
    passwordInput.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function createTokenStorage(): PaymentTokenStorage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

function findButton(view: HTMLDivElement, text: string): HTMLButtonElement {
  const button = Array.from(view.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.includes(text),
  )
  if (button === undefined) throw new Error(`Button not found: ${text}`)
  return button
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
