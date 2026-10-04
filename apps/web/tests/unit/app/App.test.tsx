// @vitest-environment happy-dom

import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../../src/app/App'

afterEach(() => {
  vi.unstubAllEnvs()
  window.history.replaceState({}, '', '/')
})

describe('App', () => {
  it('ウォレット作成ボタンを表示する', () => {
    const markup = renderToStaticMarkup(<App />)

    expect(markup).toContain('LivT Wallet')
    expect(markup).toContain('ウォレットを作成して暗号化')
    expect(markup).toContain('暗号化バックアップから復元')
    expect(markup).toContain('type="file"')
    expect(markup).toContain('type="password"')
    expect(markup).not.toContain('JPYC残高')
  })

  it('payment URLでもunlock前にauthoritative payment値を表示しない', () => {
    vi.stubEnv('VITE_LIVT_API_BASE_URL', 'https://livt.example.test')
    window.history.replaceState({}, '', '/?payment_id=42')

    const markup = renderToStaticMarkup(<App />)

    expect(markup).toContain('ウォレットを作成して暗号化')
    expect(markup).not.toContain('LivTのお支払い')
    expect(markup).not.toContain('送金先')
  })
})
