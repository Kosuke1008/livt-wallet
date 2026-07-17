import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { App } from './App'

describe('App', () => {
  it('ウォレットが準備中であることを表示する', () => {
    const markup = renderToStaticMarkup(<App />)

    expect(markup).toContain('Wallet')
    expect(markup).toContain('準備中です')
  })
})

