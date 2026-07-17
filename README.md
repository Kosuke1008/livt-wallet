# livt-wallet

React、TypeScript、Vite を使用した自己管理型ウォレットUIのモノレポです。
現在サポートするネットワークはテストネットの **Kaia Kairosのみ** です。

## 対応ネットワーク

- ネットワーク: Kaia Kairos
- Chain ID: `1001`（`0x3e9`）
- ネイティブ通貨: KAIA（18 decimals）
- Public RPC: `https://public-en-kairos.node.kaia.io`
- Block explorer: `https://kairos.kaiascan.io`

Public RPCは公開情報であるネイティブKAIA残高の取得にだけ使います。ニーモニック、
秘密鍵、パスワード、暗号鍵をRPCへ送信することはありません。

EVMアドレスは複数のEVM互換チェーンで同じ形式を利用できますが、残高はネットワーク
ごとに異なります。このアプリが表示する残高はKairos上の残高だけです。

残高の内部値には`number`ではなく`bigint`を使います。JavaScriptの`number`では、
18桁の最小単位pebを含む大きな整数を正確に表現できないためです。

## 開発

```sh
corepack pnpm install
corepack pnpm dev
```

## 構成

- `apps/web`: Web アプリケーション
- `packages`: 共有パッケージ用
- `docs`: ドキュメント
