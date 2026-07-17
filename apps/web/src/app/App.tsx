import { useRef, useState } from 'react'
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
import { JpycTransferPanel } from './JpycTransferPanel'

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
  const nativeBalanceRequest = useRef(0)
  const jpycBalanceRequest = useRef(0)

  const loadBalance = async (walletAddress: Address) => {
    const request = nativeBalanceRequest.current + 1
    nativeBalanceRequest.current = request
    setIsBalanceLoading(true)
    setBalanceError(null)
    try {
      const nextBalance = await getKairosNativeBalance(walletAddress)
      if (nativeBalanceRequest.current === request) {
        setBalanceInPeb(nextBalance)
      }
    } catch (caughtError) {
      if (nativeBalanceRequest.current === request) {
        setBalanceInPeb(null)
        setBalanceError(
          caughtError instanceof KairosRpcError
            ? 'Kairos RPCに接続できませんでした'
            : '残高を取得できませんでした',
        )
      }
    } finally {
      if (nativeBalanceRequest.current === request) {
        setIsBalanceLoading(false)
      }
    }
  }

  const loadJpycBalance = async (walletAddress: Address) => {
    const request = jpycBalanceRequest.current + 1
    jpycBalanceRequest.current = request
    setIsJpycLoading(true)
    setJpycError(null)
    setIsJpycRetryable(false)
    try {
      const nextBalance = await getErc20TokenBalance(
        approvedJpycToken,
        walletAddress,
      )
      if (jpycBalanceRequest.current === request) {
        setJpycBalance(nextBalance)
      }
    } catch (caughtError) {
      if (jpycBalanceRequest.current === request) {
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
      }
    } finally {
      if (jpycBalanceRequest.current === request) {
        setIsJpycLoading(false)
      }
    }
  }

  const refreshBalances = async (walletAddress: Address) => {
    await Promise.all([
      loadBalance(walletAddress),
      loadJpycBalance(walletAddress),
    ])
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
      await refreshBalances(walletAddress)
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
          秘密情報はこの端末内に暗号化して保存し、残高と取引だけをKairosへ問い合わせます。
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
            {jpycBalance !== null && (
              <JpycTransferPanel
                key={address}
                sender={address}
                availableJpycBalance={jpycBalance.rawBalance}
                jpycDecimals={jpycBalance.decimals}
                hasNativeBalance={
                  balanceInPeb !== null && balanceInPeb > 0n
                }
                onConfirmed={() => refreshBalances(address)}
              />
            )}
          </div>
        )}
      </section>
    </main>
  )
}
