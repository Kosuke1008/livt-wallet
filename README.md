# LivT Wallet

LivT Walletは、React・TypeScript・viemで開発している非カストディ型ブラウザWalletです。

Walletの作成、暗号化保存、解除、JPYC残高確認、送受金、LivT決済をブラウザ内で行います。
実行可能な決済networkは現在もKaia Kairosと承認済みJPYCだけです。

> Kairos実証・学習用です。Mainnetや実資産には対応していません。

## 主な機能

- mnemonicからのWallet作成と暗号化保存
- パスワードによるWallet解除
- KAIA・JPYC残高表示
- 承認済みJPYCの受取・直接送金
- LivTのpayment ID/URLから支払い内容を取得
- LivT利用者の決済限定ログイン
- ブラウザ内でのtransaction署名
- LivT Fee Payerを利用したgas代不要のJPYC決済
- Fee Payerを使わない既存の直接送信
- receipt確認後だけ成功表示

## 対応ネットワーク

| 項目 | 設定 |
|:---|:---|
| Network | Kaia Kairos |
| Chain ID | `1001`（`0x3e9`） |
| Native token | KAIA（18 decimals） |
| ERC-20 | JPYC（18 decimals） |
| JPYC contract | `0xe7c3d8c9a439fede00d2600032d5db0be71c3c29` |
| Explorer | `https://kairos.kaiascan.io` |

任意トークンのimportやcontract address入力はサポートしません。bytecode、`symbol()`、
`decimals()`をKairosから読み取り、承認済み設定と一致した場合だけ利用します。

`kairos`と`kaia-mainnet`を共通profileとして定義していますが、Mainnet profileは
Phase 1の設定検証・read-only準備専用です。Mainnetの直接送信、署名、Fee
Delegationは常に拒否します。networkはbuild modeから推測せず、次のように指定します。

```dotenv
VITE_BLOCKCHAIN_NETWORK=kairos
VITE_BLOCKCHAIN_KAIROS_RPC_URL=https://public-en-kairos.node.kaia.io
VITE_MAINNET_PAYMENTS_ENABLED=false
```

移行前Walletとの互換性のため、selector未指定時だけKairosを安全な既定値とします。
`VITE_KAIROS_RPC_URL`も移行期間中は利用できます。Mainnetが暗黙選択されることは
ありません。

## LivT決済フロー

```text
LivT Laravelから決済正本を取得
  ↓
chain・token・送金先・金額・期限をWalletで確認
  ↓
利用者がWalletパスワードを入力
  ↓
ブラウザ内でsender署名
  ├─ 直接送信: WalletがKairosへbroadcast
  └─ Fee Delegated: Laravel経由でLivT Fee Payerが追加署名・broadcast
  ↓
Laravelの共通verifierがreceiptとJPYC Transferを再検証
  ↓
確認成功後だけ支払い完了を表示
```

Fee Delegated決済では、送信元WalletにKAIAは不要です。JPYC transferのgasはLivTの
Fee Payerが負担します。失敗時に直接送信へ自動切替はせず、利用者が明示的に選択します。

## セキュリティ境界

- mnemonic、秘密鍵、Walletパスワード、復号済みWallet情報をLaravelへ送りません。
- 署名用アカウントは処理中だけ復元し、保存領域へ追加しません。
- chain ID、JPYC contract、送金先、金額、残高を署名前に検証します。
- transactionを自動再送しません。
- Fee Payerへ渡すのはsender署名済みtransactionであり、Wallet秘密鍵ではありません。
- backendの共通verifierが確認するまで決済成功と扱いません。
- 金額と残高は浮動小数点ではなく`bigint`のatomic unitsで扱います。

## 開発

```bash
corepack pnpm install
corepack pnpm dev
```

## テスト

```bash
corepack pnpm test
corepack pnpm test:integration
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
```

## Kairos手動レビュー

通常のLivT Wallet決済:

```bash
corepack pnpm review:kairos-live
```

LivT Fee Payerを利用する決済:

```bash
corepack pnpm review:kairos-fee-delegated-live
```

Fee Delegated runnerはLaravel、Wallet、Fee Payerをまとめて起動し、内部Bearerを毎回
自動生成します。外部API keyの取得は不要です。

## Repository構成

```text
apps/web/src/app          UI・画面遷移
apps/web/src/wallet       Wallet生成・暗号化・保存・解除
apps/web/src/blockchain   network profileとRPC境界
apps/web/src/tokens       JPYC検証・署名・送信
apps/web/src/payments     LivT決済APIとフロー
apps/web/tests            unit / integration test
apps/web/e2e              browser testと手動review runner
docs                      設計・レビュー手順
```

## 現在サポートしないもの

- Kaia Mainnetでの署名・送信・Fee Delegation
- 任意トークン
- NFT、swap、価格チャート、トークン購入
- 外部管理型Fee Delegation Service
- Mainnet相当の鍵管理・監査・利用上限
