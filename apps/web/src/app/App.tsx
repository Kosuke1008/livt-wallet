import { useState } from 'react'
import type { Address } from 'viem'
import { getActiveNetwork } from '../blockchain/activeNetwork'
import {
  type Erc20BalanceResult,
  getErc20TokenBalance,
} from '../tokens/tokenBalance'
import {
  InvalidTokenContractError,
  TokenMetadataError,
} from '../tokens/tokenMetadata'
import {
  createAndSaveWallet,
  hasEncryptedWallet,
  IncorrectPasswordError,
  unlockStoredWalletAddress,
} from '../wallet/encryptedWallet'
import {
  formatKairosBalance,
  getKairosNativeBalance,
  KairosRpcError,
} from '../blockchain/kairosBalance'
import { approvedJpycToken } from '../tokens/tokenRegistry'

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
  const [jpycBalance, setJpycBalance] = useState<Erc20BalanceResult | null>(null)
  const [isJpycLoading, setIsJpycLoading] = useState(false)
  const [jpycError, setJpycError] = useState<string | null>(null)
  const [isJpycRetryable, setIsJpycRetryable] = useState(false)

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

  const loadJpycBalance = async (walletAddress: Address) => {
    setIsJpycLoading(true)
    setJpycError(null)
    setIsJpycRetryable(false)
    try {
      setJpycBalance(
        await getErc20TokenBalance(approvedJpycToken, walletAddress),
      )
    } catch (caughtError) {
      setJpycBalance(null)
      if (caughtError instanceof KairosRpcError) {
        setJpycError('JPYC残高の取得中にKairos RPCへ接続できませんでした')
        setIsJpycRetryable(true)
      } else if (
        caughtError instanceof InvalidTokenContractError ||
        caughtError instanceof TokenMetadataError
      ) {
        setJpycError('承認済みJPYCコントラクトを検証できませんでした')
      } else {
        setJpycError('JPYC残高を取得できませんでした')
      }
    } finally {
      setIsJpycLoading(false)
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
      await Promise.all([
        loadBalance(walletAddress),
        loadJpycBalance(walletAddress),
      ])
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
            <div className="balance token-balance" aria-live="polite">
              <span>{approvedJpycToken.displayName}残高</span>
              {isJpycLoading && <p>JPYC残高を読み込み中…</p>}
              {jpycBalance !== null && !isJpycLoading && (
                <output aria-label="JPYC残高値">
                  {jpycBalance.formattedBalance} {jpycBalance.symbol}
                </output>
              )}
              {jpycError && (
                <div>
                  <p role="alert">{jpycError}</p>
                  {isJpycRetryable && (
                    <button
                      type="button"
                      onClick={() => void loadJpycBalance(address)}
                    >
                      JPYCを再試行
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  )
}
