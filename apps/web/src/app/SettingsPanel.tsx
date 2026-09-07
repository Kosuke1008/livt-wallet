import type { Address } from 'viem'
import { ACTIVE_NETWORK_PROFILE } from '../blockchain/networkProfiles'

interface SettingsPanelProps {
  readonly address: Address
  readonly onBack: () => void
}

export function SettingsPanel({ address, onBack }: SettingsPanelProps) {
  return (
    <section className="subview" aria-labelledby="settings-title">
      <button
        type="button"
        className="back-button secondary"
        aria-label="Back to wallet"
        onClick={onBack}
      >
        ← ウォレットへ戻る
      </button>
      <header className="subview-heading">
        <p className="eyebrow">ウォレット情報</p>
        <h2 id="settings-title">設定</h2>
      </header>

      <dl className="settings-list">
        <div>
          <dt>ネットワーク</dt>
          <dd>{ACTIVE_NETWORK_PROFILE.chainName}</dd>
        </div>
        <div>
          <dt>チェーンID</dt>
          <dd>{ACTIVE_NETWORK_PROFILE.chainId}</dd>
        </div>
        <div>
          <dt>ウォレットアドレス</dt>
          <dd>{address}</dd>
        </div>
      </dl>

      <p className="security-notice">
        LivT Walletの決済実行は現在Kaia Kairos試験ネットワーク専用です。
      </p>
    </section>
  )
}
