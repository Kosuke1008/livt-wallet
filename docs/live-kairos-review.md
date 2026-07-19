# 実Kairos・実DB payment review

このmodeは、Laravelが現在設定しているdatabaseとKaia Kairosの公式public RPCを使い、実際のJPYC transactionをLivT Walletから送信します。隔離E2E database、RPC stub、fixture seederは使用しません。

## 実行

WSL上のLivT Wallet repository rootで実行します。

```bash
corepack pnpm review:kairos-live
```

開始時に現在のdatabaseとKairosをread-onlyで検査した後、`LIVE KAIROS`の入力を要求します。launcher自身はpayment作成やtransaction送信を行いません。database書き込みとbroadcastはEdge上の既存画面をユーザーが操作した時だけ発生します。

## 事前条件

- Laravelの現在の設定で既存databaseへ接続できる
- 有効な店舗staff、店舗Wallet、LivT利用者がdatabaseに存在する
- 店舗staffの店舗コード、staff ID、PINをユーザーが把握している
- LivT利用者のメールアドレスとパスワードをユーザーが把握している
- payer WalletへKairos KAIAと1 JPYC以上を用意できる
- 固定port `18000`と`14173`が空いている

認証情報をterminalへ入力したり、Codexへ渡したりする必要はありません。すべてEdge上の既存LivT画面だけで入力します。

## 手順

1. EdgeでLivT Walletを作成または解除する
2. 表示された公開アドレスへ必要最小限のKairos KAIAとJPYCを用意する
3. terminalでEnterを押し、EdgeのLaravel `/login`へ移動する
4. 既存staffでログインし、POSで金額`1`のpaymentを作成する
5. `/pay/{id}`の数字だけをterminalへ入力する
6. launcherが実database由来のpayment、chain、token、recipient、amount、期限を検査する
7. EdgeでLivT Walletへ進み、既存LivT利用者としてログインする
8. Walletパスワードでローカル署名し、実Kairosへ一度だけbroadcastする
9. 画面がconfirmedになったらterminalでEnterを押す
10. launcherが実databaseの`status`、`tx_hash`、`user_id`、`paid_at`と実Kairos receipt・Transfer logを再検査する

## Wallet profile

Edgeは通常profileとは別の`EdgeKairosLiveReview` profileを使用します。このprofileは終了時に削除しません。Walletの暗号化済みmnemonicはこのprofileのWallet originへ保存されます。

現状のWallet UIにはmnemonic export/importがないため、Walletパスワードを忘れたりprofileを削除したりすると復元できません。Kairos確認に必要な最小量だけを入れ、mainnetの秘密情報や実価値を持つWalletを使用しないでください。

固定originは次のとおりです。

- Laravel: `http://127.0.0.1:18000`
- LivT Wallet: `http://127.0.0.1:14173`

このためlauncherを再実行しても、同じEdge profileから暗号化済みWalletを解除できます。

## databaseへの影響

launcherはmigration、seed、reset、fixture投入、database schema変更を行いません。既存application操作によって次の通常データだけが作成・更新されます。

- staff loginによるSanctum token
- `POST /api/payments/create`による1 JPYCのpending payment
- payment loginによる短時間Sanctum token
- backend verification成功後の`status`、`tx_hash`、`user_id`、`paid_at`

途中で中止した場合、作成済みpaymentやbroadcast済みtransactionは自動rollbackされません。

## network

- RPC: `https://public-en-kairos.node.kaia.io`
- Chain ID: `1001`
- Explorer: `https://kairos.kaiascan.io`
- JPYC contract: `0xe7c3d8c9a439fede00d2600032d5db0be71c3c29`

launcherは開始時にchain ID、contract code、symbol、decimalsを実RPCから再確認します。終了時にはreceipt成功とrecipient・amountが一致するJPYC Transfer logを再確認します。
