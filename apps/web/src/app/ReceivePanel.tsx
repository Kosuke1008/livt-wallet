import type { Address } from 'viem'
import { KAIROS_NETWORK } from '../blockchain/kairos'
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
          Kaia Kairos上のJPYCを、次のウォレットアドレスへ送ってください。
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
          <dd>{KAIROS_NETWORK.name}</dd>
        </div>
        <div>
          <dt>チェーンID</dt>
          <dd>{KAIROS_NETWORK.chainId}</dd>
        </div>
      </dl>

      <p className="warning">
        異なるネットワークから送ると、このウォレットに表示されない場合があります。必ずKaia
        Kairos（チェーンID 1001）を選んでください。
      </p>
    </section>
  )
}
