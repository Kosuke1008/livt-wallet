import type { Address } from 'viem'
import type { Erc20BalanceResult } from '../tokens/tokenBalance'
import { AddressCopyButton } from './AddressCopyButton'
import { shortenWalletAddress } from './addressCopy'

interface WalletHomeProps {
  readonly address: Address
  readonly jpycBalance: Erc20BalanceResult | null
  readonly isJpycLoading: boolean
  readonly jpycError: string | null
  readonly isJpycRetryable: boolean
  readonly kaiaBalance: string | null
  readonly isKaiaLoading: boolean
  readonly kaiaError: string | null
  readonly onRetryJpyc: () => void
  readonly onRetryKaia: () => void
  readonly onReceive: () => void
  readonly onSend: () => void
  readonly onOpenSettings: () => void
}

export function WalletHome({
  address,
  jpycBalance,
  isJpycLoading,
  jpycError,
  isJpycRetryable,
  kaiaBalance,
  isKaiaLoading,
  kaiaError,
  onRetryJpyc,
  onRetryKaia,
  onReceive,
  onSend,
  onOpenSettings,
}: WalletHomeProps) {
  return (
    <section className="wallet-home" aria-labelledby="wallet-home-title">
      <h2 id="wallet-home-title" className="visually-hidden">
        ウォレットホーム
      </h2>

      <section className="primary-balance" aria-labelledby="jpyc-balance-title">
        <p id="jpyc-balance-title" className="balance-label">
          JPYC残高
        </p>
        {isJpycLoading && (
          <p role="status" aria-live="polite">
            JPYC残高を読み込み中…
          </p>
        )}
        {jpycBalance !== null && !isJpycLoading && (
          <output aria-label="JPYC残高値" className="primary-balance-value">
            {jpycBalance.formattedBalance}{' '}
            <span>{jpycBalance.symbol}</span>
          </output>
        )}
        {jpycError !== null && (
          <div className="balance-message">
            <p role="alert">{jpycError}</p>
            {isJpycRetryable && (
              <button
                type="button"
                className="secondary compact-button"
                onClick={onRetryJpyc}
              >
                JPYCを再試行
              </button>
            )}
          </div>
        )}
      </section>

      <div className="primary-actions" aria-label="ウォレットの主な操作">
        <button type="button" aria-label="Receive JPYC" onClick={onReceive}>
          <span aria-hidden="true">↓</span>
          受け取る
        </button>
        <button
          type="button"
          aria-label="Send JPYC"
          onClick={onSend}
          disabled={jpycBalance === null || isJpycLoading}
        >
          <span aria-hidden="true">↑</span>
          送る
        </button>
      </div>

      <section className="wallet-address" aria-labelledby="wallet-address-title">
        <div>
          <p id="wallet-address-title" className="section-label">
            ウォレットアドレス
          </p>
          <output
            aria-label="ウォレットアドレス値"
            className="short-address"
            title={address}
          >
            {shortenWalletAddress(address)}
          </output>
          <span className="visually-hidden">完全なアドレス: {address}</span>
        </div>
        <AddressCopyButton address={address} />
      </section>

      <section className="gas-balance" aria-labelledby="gas-balance-title">
        <div>
          <p id="gas-balance-title" className="section-label">
            取引手数料用の残高
          </p>
          {isKaiaLoading && (
            <p role="status" aria-live="polite">
              KAIA残高を読み込み中…
            </p>
          )}
          {kaiaBalance !== null && !isKaiaLoading && (
            <output aria-label="KAIA残高値">{kaiaBalance} KAIA</output>
          )}
          {kaiaError !== null && <p role="alert">{kaiaError}</p>}
        </div>
        {kaiaError !== null && (
          <button
            type="button"
            className="secondary compact-button"
            onClick={onRetryKaia}
          >
            KAIA残高を再試行
          </button>
        )}
      </section>

      <button
        type="button"
        className="settings-entry secondary"
        aria-label="Open settings"
        onClick={onOpenSettings}
      >
        <span>設定</span>
        <span aria-hidden="true">›</span>
      </button>
    </section>
  )
}
