// @vitest-environment happy-dom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Address } from 'viem'
import { AddressCopyButton } from '../../../src/app/AddressCopyButton'
import {
  AddressCopyError,
  copyWalletAddress,
  shortenWalletAddress,
} from '../../../src/app/addressCopy'

const address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address

let root: Root | null = null
let container: HTMLDivElement | null = null

function render(component: ReactNode): HTMLDivElement {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(component))
  return container
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})

afterEach(() => {
  if (root !== null) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('AddressCopyButton', () => {
  it('表示用アドレスだけを短縮する', () => {
    expect(shortenWalletAddress(address)).toBe('0xf39F…2266')
  })

  it('完全なアドレスをClipboard APIへ渡す', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)

    await copyWalletAddress(address, { writeText })

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith(address)
  })

  it('Clipboard APIの拒否を制御されたエラーへ変換する', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('raw browser error'))

    await expect(copyWalletAddress(address, { writeText })).rejects.toThrow(
      AddressCopyError,
    )
  })

  it('コピー成功を一時的に表示する', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const view = render(<AddressCopyButton address={address} />)
    const button = view.querySelector<HTMLButtonElement>(
      'button[aria-label="Copy address"]',
    )

    await act(async () => button?.click())
    expect(view.querySelector('[role="status"]')?.textContent).toContain(
      'アドレスをコピーしました',
    )

    act(() => vi.advanceTimersByTime(2_500))
    expect(view.querySelector('[role="status"]')).toBeNull()
  })

  it('コピー拒否では生のブラウザエラーを表示しない', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError raw'))
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const view = render(<AddressCopyButton address={address} />)
    const button = view.querySelector<HTMLButtonElement>(
      'button[aria-label="Copy address"]',
    )

    await act(async () => button?.click())

    expect(view.querySelector('[role="alert"]')?.textContent).toContain(
      'アドレスをコピーできませんでした',
    )
    expect(view.textContent).not.toContain('NotAllowedError raw')
  })
})
