import { useRef, useState } from 'react'
import type { Address } from 'viem'
import { getActiveNetwork } from '../blockchain/activeNetwork'
import {
  formatKairosBalance,
  getKairosNativeBalance,
  KairosRpcError,
} from '../blockchain/kairosBalance'
import {
  type Erc20BalanceResult,
  getErc20TokenBalance,
} from '../tokens/tokenBalance'
import {
  InvalidTokenContractError,
  TokenMetadataError,
} from '../tokens/tokenMetadata'
import { approvedJpycToken } from '../tokens/tokenRegistry'
import {
  createAndSaveWallet,
  hasEncryptedWallet,
  IncorrectPasswordError,
  unlockStoredWalletAddress,
} from '../wallet/encryptedWallet'
import { JpycTransferPanel } from './JpycTransferPanel'
import { ReceivePanel } from './ReceivePanel'
import { SettingsPanel } from './SettingsPanel'
import { WalletHome } from './WalletHome'

const activeNetwork = getActiveNetwork()

type WalletView = 'home' | 'receive' | 'send' | 'settings'

export function App() {
  const [address, setAddress] = useState<Address | null>(null)
  const [password, setPassword] = useState('')
  const [walletExists, setWalletExists] = useState(
    () => typeof localStorage !== 'undefined' && hasEncryptedWallet(),
  )
  const [activeView, setActiveView] = useState<WalletView>('home')
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
    // 1. KAIA残高用の要求番号を進め、古い応答を見分けられるようにする
    const request = nativeBalanceRequest.current + 1
    nativeBalanceRequest.current = request
    setIsBalanceLoading(true)
    setBalanceError(null)
    try {
      // 2. 公開アドレスを使ってKairosからKAIA残高を取得する
      const nextBalance = await getKairosNativeBalance(walletAddress)
      // 3. 最新の要求だけをReactの状態へ反映する
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
    // 1. JPYC残高用の要求番号を進め、再試行前の応答を見分けられるようにする
    const request = jpycBalanceRequest.current + 1
    jpycBalanceRequest.current = request
    setIsJpycLoading(true)
    setJpycError(null)
    setIsJpycRetryable(false)
    try {
      // 2. 承認済みJPYCの残高を公開アドレスから取得する
      const nextBalance = await getErc20TokenBalance(
        approvedJpycToken,
        walletAddress,
      )
      // 3. 最新の要求だけをReactの状態へ反映する
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
    // 1. KAIAとJPYCを独立した状態のまま並行して読み込む
    await Promise.all([
      loadBalance(walletAddress),
      loadJpycBalance(walletAddress),
    ])
  }

  //１．１．Walletの保存状況を調べて、Walletが存在する場合は、パスワードを使ってWalletを復号化し、アドレスを取得する。
  //１．２．Walletが存在しない場合は、パスワードを使って新しいWalletを作成し、保存する。
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setIsWorking(true)

    try {
      // 1. 保存済みなら解除し、未作成なら新しいウォレットを作成する
      const walletAddress = walletExists
        ? await unlockStoredWalletAddress(password)
        : await createAndSaveWallet(password)
      // 2. 作成・解除処理から公開アドレスだけをReactへ受け取る
      setAddress(walletAddress)
      setWalletExists(true)
      setPassword('')
      // 3. ウォレットを作り直さず、表示する画面だけをホームへ戻す
      setActiveView('home')
      // 4. 解除した公開アドレスのKAIAとJPYC残高を読み込む
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

  // 画面切替は表示状態だけを変更し、同じウォレットを使い続ける
  return (
    <main className="shell">
      <div className="wallet-frame">
        <header className="app-header">
          <h1>LivT Wallet</h1>
          <p className="network-badge" aria-label="アクティブネットワーク">
            {activeNetwork.name}
          </p>
        </header>

        {address === null ? (
          <section className="auth-panel" aria-labelledby="auth-title">
            <p className="eyebrow">
              {walletExists ? 'ウォレットはロック中' : 'はじめての設定'}
            </p>
            <h2 id="auth-title">
              {walletExists ? 'ウォレットを解除' : 'ウォレットを作成'}
            </h2>
            <p className="description">
              秘密情報はこの端末内で暗号化します。パスワードは保存されません。
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
                {walletExists
                  ? 'ウォレットを解除'
                  : 'ウォレットを作成して暗号化'}
              </button>
            </form>
            {error && <p role="alert">{error}</p>}
          </section>
        ) : (
          <>
            {activeView === 'home' && (
              <WalletHome
                address={address}
                jpycBalance={jpycBalance}
                isJpycLoading={isJpycLoading}
                jpycError={jpycError}
                isJpycRetryable={isJpycRetryable}
                kaiaBalance={
                  balanceInPeb === null
                    ? null
                    : formatKairosBalance(balanceInPeb)
                }
                isKaiaLoading={isBalanceLoading}
                kaiaError={balanceError}
                onRetryJpyc={() => void loadJpycBalance(address)}
                onRetryKaia={() => void loadBalance(address)}
                onReceive={() => setActiveView('receive')}
                onSend={() => setActiveView('send')}
                onOpenSettings={() => setActiveView('settings')}
              />
            )}

            {activeView === 'receive' && (
              <ReceivePanel
                address={address}
                onBack={() => setActiveView('home')}
              />
            )}

            {activeView === 'settings' && (
              <SettingsPanel
                address={address}
                onBack={() => setActiveView('home')}
              />
            )}

            {activeView === 'send' && jpycBalance !== null && (
              <JpycTransferPanel
                key={address}
                sender={address}
                availableJpycBalance={jpycBalance.rawBalance}
                jpycDecimals={jpycBalance.decimals}
                hasNativeBalance={
                  balanceInPeb !== null && balanceInPeb > 0n
                }
                onConfirmed={() => refreshBalances(address)}
                onBack={() => setActiveView('home')}
              />
            )}
          </>
        )}
      </div>
    </main>
  )
}
