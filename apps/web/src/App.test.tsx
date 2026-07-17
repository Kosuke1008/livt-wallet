import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { App } from './App'

describe('App', () => {
  it('ウォレット作成ボタンを表示する', () => {
    const markup = renderToStaticMarkup(<App />)

    expect(markup).toContain('Wallet')
    expect(markup).toContain('ウォレットを作成して暗号化')
    expect(markup).toContain('type="password"')
  })
})
