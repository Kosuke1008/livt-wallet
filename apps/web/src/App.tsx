import { useState } from 'react'
import type { Address } from 'viem'
import {
  createAndSaveWallet,
  hasEncryptedWallet,
  IncorrectPasswordError,
  unlockStoredWalletAddress,
} from './encryptedWallet'

export function App() {
  const [address, setAddress] = useState<Address | null>(null)
  const [password, setPassword] = useState('')
  const [walletExists, setWalletExists] = useState(
    () => typeof localStorage !== 'undefined' && hasEncryptedWallet(),
  )
  const [error, setError] = useState<string | null>(null)
  const [isWorking, setIsWorking] = useState(false)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setIsWorking(true)

    try {
      const walletAddress = walletExists
        ? await unlockStoredWalletAddress(password)
        : await createAndSaveWallet(password)
      setAddress(walletAddress)
      setWalletExists(true)
      setPassword('')
    } catch (caughtError) {
      setError(
        caughtError instanceof IncorrectPasswordError
          ? 'パスワードが正しくありません'
          : 'ウォレットを処理できませんでした',
      )
    } finally {
      setIsWorking(false)
    }
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
        <form onSubmit={handleSubmit}>
          <label htmlFor="wallet-password">パスワード</label>
          <input
            id="wallet-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
          <button type="submit" disabled={isWorking}>
            {walletExists ? 'ウォレットを解除' : 'ウォレットを作成して暗号化'}
          </button>
        </form>
        {error && <p role="alert">{error}</p>}
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
