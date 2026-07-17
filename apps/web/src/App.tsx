import { useState } from 'react'
import type { Address } from 'viem'
import { createWallet, isValidWalletAddress } from './wallet'

export function App() {
  const [address, setAddress] = useState<Address | null>(null)

  const handleCreateWallet = () => {
    const wallet = createWallet()

    if (!isValidWalletAddress(wallet.address)) {
      throw new Error('Generated wallet address is invalid')
    }

    setAddress(wallet.address)
  }

  return (
    <main className="shell">
      <section className="card" aria-labelledby="page-title">
        <p className="eyebrow">LIVT</p>
        <h1 id="page-title">Wallet</h1>
        <p className="status">ローカルウォレット</p>
        <p className="description">
          ネットワークへ接続せず、この端末内でウォレットを生成します。
        </p>
        <button type="button" onClick={handleCreateWallet}>
          ウォレットを作成
        </button>
        {address && (
          <div className="address-panel" aria-live="polite">
            <span>ウォレットアドレス</span>
            <output>{address}</output>
          </div>
        )}
      </section>
    </main>
  )
}
