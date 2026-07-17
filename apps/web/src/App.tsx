import { useState } from 'react'
import type { Address } from 'viem'
import { getActiveNetwork } from './activeNetwork'
import {
  createAndSaveWallet,
  hasEncryptedWallet,
  IncorrectPasswordError,
  unlockStoredWalletAddress,
} from './encryptedWallet'
import {
  formatKairosBalance,
  getKairosNativeBalance,
  KairosRpcError,
} from './kairosBalance'

const activeNetwork = getActiveNetwork()

export function App() {
  const [address, setAddress] = useState<Address | null>(null)
  const [password, setPassword] = useState('')
  const [walletExists, setWalletExists] = useState(
    () => typeof localStorage !== 'undefined' && hasEncryptedWallet(),
  )
  const [error, setError] = useState<string | null>(null)
  const [isWorking, setIsWorking] = useState(false)
  const [balanceInPeb, setBalanceInPeb] = useState<bigint | null>(null)
  const [isBalanceLoading, setIsBalanceLoading] = useState(false)
  const [balanceError, setBalanceError] = useState<string | null>(null)

  const loadBalance = async (walletAddress: Address) => {
    setIsBalanceLoading(true)
    setBalanceError(null)
    try {
      setBalanceInPeb(await getKairosNativeBalance(walletAddress))
    } catch (caughtError) {
      setBalanceInPeb(null)
      setBalanceError(
        caughtError instanceof KairosRpcError
          ? 'Kairos RPCに接続できませんでした'
          : '残高を取得できませんでした',
      )
    } finally {
      setIsBalanceLoading(false)
    }
  }

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
      await loadBalance(walletAddress)
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
        <p className="network" aria-label="アクティブネットワーク">
          {activeNetwork.name}
        </p>
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
            <output aria-label="ウォレットアドレス値">{address}</output>
            <div className="balance" aria-live="polite">
              <span>KAIA残高</span>
              {isBalanceLoading && <p>残高を読み込み中…</p>}
              {balanceInPeb !== null && !isBalanceLoading && (
                <output aria-label="KAIA残高値">
                  {formatKairosBalance(balanceInPeb)}{' '}
                  {activeNetwork.nativeCurrency.symbol}
                </output>
              )}
              {balanceError && (
                <div>
                  <p role="alert">{balanceError}</p>
                  <button type="button" onClick={() => void loadBalance(address)}>
                    再試行
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  )
}
