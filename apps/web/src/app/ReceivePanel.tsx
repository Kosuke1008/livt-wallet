import type { Address } from 'viem'
import { ACTIVE_NETWORK_PROFILE } from '../blockchain/networkProfiles'
import { AddressCopyButton } from './AddressCopyButton'

interface ReceivePanelProps {
  readonly address: Address
  readonly onBack: () => void
}

export function ReceivePanel({ address, onBack }: ReceivePanelProps) {
  return (
    <section className="subview" aria-labelledby="receive-title">
      <button
        type="button"
        className="back-button secondary"
        aria-label="Back to wallet"
        onClick={onBack}
      >
        ← ウォレットへ戻る
      </button>
      <header className="subview-heading">
        <p className="eyebrow">受け取り</p>
        <h2 id="receive-title">JPYCを受け取る</h2>
        <p>
          {ACTIVE_NETWORK_PROFILE.chainName}上のJPYCを、次のウォレットアドレスへ送ってください。
        </p>
      </header>

      <div className="full-address-panel">
        <span className="section-label">受取用ウォレットアドレス</span>
        <output aria-label="受取用ウォレットアドレス値">{address}</output>
        <AddressCopyButton address={address} />
      </div>

      <dl className="network-details">
        <div>
          <dt>ネットワーク</dt>
          <dd>{ACTIVE_NETWORK_PROFILE.chainName}</dd>
        </div>
        <div>
          <dt>チェーンID</dt>
          <dd>{ACTIVE_NETWORK_PROFILE.chainId}</dd>
        </div>
      </dl>

      <p className="warning">
        異なるネットワークから送ると、このウォレットに表示されない場合があります。必ず
        {ACTIVE_NETWORK_PROFILE.chainName}（チェーンID {ACTIVE_NETWORK_PROFILE.chainId}）を選んでください。
      </p>
    </section>
  )
}
