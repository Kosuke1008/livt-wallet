import { useState } from 'react'
import type { Address } from 'viem'
import { ACTIVE_NETWORK_PROFILE } from '../blockchain/networkProfiles'

interface SettingsPanelProps {
  readonly address: Address
  readonly onBack: () => void
  readonly onExportBackup: (password: string) => Promise<void>
}

export function SettingsPanel({
  address,
  onBack,
  onExportBackup,
}: SettingsPanelProps) {
  const [password, setPassword] = useState('')
  const [isExporting, setIsExporting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const handleExport = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsExporting(true)
    setMessage(null)
    try {
      await onExportBackup(password)
      setPassword('')
      setMessage('暗号化バックアップを保存しました。')
    } catch {
      setMessage('バックアップを作成できませんでした。パスワードを確認してください。')
    } finally {
      setIsExporting(false)
    }
  }

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
        バックアップには暗号文だけが含まれます。復元には現在のWalletパスワードが必要です。
      </p>

      <section aria-labelledby="backup-title">
        <h3 id="backup-title">暗号化バックアップ</h3>
        <form onSubmit={handleExport}>
          <label htmlFor="backup-password">Walletパスワードを再入力</label>
          <input
            id="backup-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
          <button type="submit" disabled={isExporting}>
            暗号化バックアップを保存
          </button>
        </form>
        {message && <p role="status">{message}</p>}
      </section>
    </section>
  )
}
