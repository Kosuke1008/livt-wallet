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

## Kairos JPYC

UIに表示するERC-20は、承認済みのKairos JPYCテストトークンだけです。

- Contract: `0xe7c3d8c9a439fede00d2600032d5db0be71c3c29`
- Expected symbol: `JPYC`
- Expected decimals: `18`

コントラクトにbytecodeが存在することを確認し、`symbol()`と`decimals()`をチェーンから
読み取って承認済み設定と照合してから`balanceOf()`を利用します。有効なEVMアドレスでも、
ERC-20コントラクトであるとは限りません。

ERC-20のraw balanceも`bigint`で保持します。decimalsは表示位置を決める情報であり、raw
balance自体を変更するものではありません。任意トークンのimportやcontract address入力は
意図的にサポートしていません。

既知のfunded addressは、任意のoptional read-only確認にだけ利用できます。残高照会には
秘密鍵やニーモニックは不要であり、このプロジェクトがそれらを要求することはありません。

## 開発

```sh
corepack pnpm install
corepack pnpm dev
```

## 構成

- `apps/web`: Web アプリケーション
- `packages`: 共有パッケージ用
- `docs`: ドキュメント

`apps/web/src` の構成:

- `app`: アプリケーションのentry point、UI、スタイル
- `wallet`: ウォレット生成、暗号化、保存、unlock
- `blockchain`: Kairos RPC接続とnative KAIA読み取り
- `tokens`: 承認token設定、検証、残高読み取り、表示format

テストの構成:

- `src`: production application code
- `tests/unit`: 独立した関数とcomponentのテスト
- `tests/integration`: 複数moduleとmock RPC境界を通すテスト
- `e2e`: browser levelのPlaywrightテスト
