// @vitest-environment happy-dom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Address } from 'viem'
import { KAIROS_NETWORK } from '../../../src/blockchain/kairos'
import { ReceivePanel } from '../../../src/app/ReceivePanel'
import { SettingsPanel } from '../../../src/app/SettingsPanel'
import { WalletHome } from '../../../src/app/WalletHome'
import { approvedJpycToken } from '../../../src/tokens/tokenRegistry'
import type { Erc20BalanceResult } from '../../../src/tokens/tokenBalance'

const address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address
const jpycBalance: Erc20BalanceResult = {
  token: approvedJpycToken,
  ownerAddress: address,
  rawBalance: 9_000_000_000_000_000_000_000n,
  formattedBalance: '9000',
  symbol: 'JPYC',
  decimals: 18,
}

let root: Root | null = null
let container: HTMLDivElement | null = null

function render(component: ReactNode): HTMLDivElement {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(component))
  return container
}

function createHome(overrides: Partial<Parameters<typeof WalletHome>[0]> = {}) {
  return (
    <WalletHome
      address={address}
      jpycBalance={jpycBalance}
      isJpycLoading={false}
      jpycError={null}
      isJpycRetryable={false}
      kaiaBalance="1.25"
      isKaiaLoading={false}
      kaiaError={null}
      onRetryJpyc={vi.fn()}
      onRetryKaia={vi.fn()}
      onReceive={vi.fn()}
      onSend={vi.fn()}
      onOpenSettings={vi.fn()}
      {...overrides}
    />
  )
}

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

describe('wallet views', () => {
  it('ホームではJPYCを主残高、KAIAを手数料残高として表示する', () => {
    const view = render(createHome())
    const jpyc = view.querySelector('[aria-label="JPYC残高値"]')
    const kaia = view.querySelector('[aria-label="KAIA残高値"]')

    expect(jpyc?.textContent).toContain('9000 JPYC')
    expect(kaia?.textContent).toBe('1.25 KAIA')
    expect(view.textContent?.indexOf('JPYC残高')).toBeLessThan(
      view.textContent?.indexOf('取引手数料用の残高') ?? 0,
    )
  })

  it('ホームでは短縮アドレスを表示し、完全なアドレスへアクセスできる', () => {
    const view = render(createHome())
    const output = view.querySelector('[aria-label="ウォレットアドレス値"]')

    expect(output?.textContent).toBe('0xf39F…2266')
    expect(output?.getAttribute('title')).toBe(address)
    expect(view.textContent).toContain(`完全なアドレス: ${address}`)
  })

  it('0 JPYCを読み込み中やエラーと区別して表示する', () => {
    const view = render(
      createHome({
        jpycBalance: {
          ...jpycBalance,
          rawBalance: 0n,
          formattedBalance: '0',
        },
      }),
    )

    expect(view.querySelector('[aria-label="JPYC残高値"]')?.textContent).toContain(
      '0 JPYC',
    )
  })

  it('JPYCとKAIAのエラーを独立して表示する', () => {
    const view = render(
      createHome({
        jpycBalance: null,
        jpycError: 'JPYCを取得できません',
        isJpycRetryable: true,
        kaiaBalance: null,
        kaiaError: 'KAIAを取得できません',
      }),
    )

    expect(view.textContent).toContain('JPYCを取得できません')
    expect(view.textContent).toContain('KAIAを取得できません')
    expect(view.textContent).toContain('JPYCを再試行')
    expect(view.textContent).toContain('KAIA残高を再試行')
  })

  it('ホームの操作からそれぞれの画面を開ける', () => {
    const onReceive = vi.fn()
    const onSend = vi.fn()
    const onOpenSettings = vi.fn()
    const view = render(
      createHome({ onReceive, onSend, onOpenSettings }),
    )

    act(() =>
      view
        .querySelector<HTMLButtonElement>('button[aria-label="Receive JPYC"]')
        ?.click(),
    )
    act(() =>
      view
        .querySelector<HTMLButtonElement>('button[aria-label="Send JPYC"]')
        ?.click(),
    )
    act(() =>
      view
        .querySelector<HTMLButtonElement>('button[aria-label="Open settings"]')
        ?.click(),
    )

    expect(onReceive).toHaveBeenCalledOnce()
    expect(onSend).toHaveBeenCalledOnce()
    expect(onOpenSettings).toHaveBeenCalledOnce()
  })

  it('受取画面で完全なアドレス、Kairos、1001を示して戻れる', () => {
    const onBack = vi.fn()
    const view = render(<ReceivePanel address={address} onBack={onBack} />)

    expect(
      view.querySelector('[aria-label="受取用ウォレットアドレス値"]')
        ?.textContent,
    ).toBe(address)
    expect(view.textContent).toContain(KAIROS_NETWORK.name)
    expect(view.textContent).toContain(KAIROS_NETWORK.chainId.toString())
    expect(view.textContent).toContain('異なるネットワーク')

    act(() =>
      view
        .querySelector<HTMLButtonElement>('button[aria-label="Back to wallet"]')
        ?.click(),
    )
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('設定画面には安全な既存情報だけを表示して戻れる', () => {
    const onBack = vi.fn()
    const view = render(<SettingsPanel address={address} onBack={onBack} />)

    expect(view.textContent).toContain(KAIROS_NETWORK.name)
    expect(view.textContent).toContain(KAIROS_NETWORK.chainId.toString())
    expect(view.textContent).toContain(address)
    expect(view.textContent).not.toMatch(
      /Mainnet|RPC編集|秘密鍵|シードフレーズ|トークン追加|NFT|スワップ/,
    )

    act(() =>
      view
        .querySelector<HTMLButtonElement>('button[aria-label="Back to wallet"]')
        ?.click(),
    )
    expect(onBack).toHaveBeenCalledOnce()
  })
})
