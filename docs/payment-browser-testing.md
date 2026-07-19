# LivT決済のブラウザテスト環境

Laravelの支払画面からLivT Walletを開き、ローカル署名、JPYC Transfer、Laravelによるreceipt検証、決済確定までをPlaywrightで追跡するための環境です。Kairosの実RPCには接続しません。

## 実行方法

リポジトリルートで次のいずれかを実行します。

```bash
corepack pnpm test:e2e:payment
corepack pnpm test:e2e:payment:headed
corepack pnpm test:e2e:payment:ui
corepack pnpm test:e2e:payment:edge-review
```

- `test:e2e:payment`: Chromiumをheadlessで起動し、3シナリオを自動検証します。
- `test:e2e:payment:headed`: 実ブラウザを表示しながら同じシナリオを実行します。
- `test:e2e:payment:ui`: Playwright UIで各stepを選びながら実行します。
- `test:e2e:payment:edge-review`: WSLからWindows版Microsoft Edgeを開き、checkpointごとに手動確認します。

## Microsoft Edge手動レビュー

WSL上のリポジトリrootから次を実行します。Windows側に既存のMicrosoft Edgeが必要ですが、Linux版Edgeや追加packageは不要です。

```bash
corepack pnpm test:e2e:payment:edge-review
```

起動時に、隔離環境だけで使う次の2つのtest用パスワードをterminalへ非表示入力します。値は自分で決め、レビュー中だけ覚えておきます。

1. LivT review user password
2. Wallet review password

値はterminal、ファイル、Playwright artifactへ出力されません。Edgeでは入力した値をそれぞれLivTログインとWallet作成・解除・署名に使用します。

Edgeは通常profileと分離した一時profileで起動し、DevToolsも自動的に開きます。terminalの案内に従い、次の順に確認します。

1. 正常系: LaravelのMetaMask/LivT Wallet導線、決済内容、認証、ローカル署名、backend確定
2. receipt回復: 最初のbackend確認を既存retry上限までpendingにし、reload後に送金せず確認だけ再試行
3. 期限切れ: ログイン・simulation・署名・broadcast前の安全停止

各画面の確認後にterminalでEnterを押すと、専用DBの決済状態とRPC stubのbroadcast・receipt回数を検査して次へ進みます。条件が未達ならEdgeは閉じず、同じcheckpointで操作を続けられます。

EdgeのDevToolsでは主に次を照合します。

- Network: `/api/payments/{id}`、`/api/payment/login`、`/api/payment/session`、`/api/payments/{id}/confirm`
- Application: Wallet originの暗号化済みlocalStorageと、tab単位の決済session
- 画面: backend由来の店舗・金額・chain ID・token contract・送金先・期限
- terminal checkpoint: DBの`pending`/`confirmed`とRPC broadcast回数

終了時またはCtrl+C時に、Edgeのreview専用processと一時profile、一時MySQL、Laravel、Wallet、RPC stubを停止・削除します。通常のEdge profileには触れません。

Linux上の`mysqld`、`mysql`、`mysqladmin`、PHP、既存のPlaywright Chromiumが必要です。依存関係の追加や設定ファイルの変更は行いません。

この作業環境ではChromiumの共有ライブラリが隔離directoryにあるため、次のように実行します。通常の開発端末で共有ライブラリがsystemに入っている場合、このprefixは不要です。

```bash
env LD_LIBRARY_PATH=/tmp/livt-wallet-playwright-libs/usr/lib/x86_64-linux-gnu \
  corepack pnpm test:e2e:payment:ui
```

Laravelリポジトリが標準の隣接位置にない場合だけ、絶対パスを指定できます。

```bash
LIVT_E2E_BACKEND_DIRECTORY=/absolute/path/to/jpyc-web3-payment-platform \
  corepack pnpm test:e2e:payment
```

## 追跡できるプロセス

1. Laravelの既存`/pay/{id}`を開き、MetaMask導線が残っていることを確認する
2. 「LivT Walletで支払う」から`payment_id`だけを渡す
3. WalletがLaravelの公開APIから店舗、金額、chain、token、送金先、期限を取得する
4. 決済専用の短時間Sanctum tokenでユーザーを認証する
5. Wallet内で復号し、JPYC Transferをローカル署名する
6. 署名済みtransactionだけをローカルRPCへ一度送信する
7. Laravelが同じRPCからchain ID、receipt、Transferログを独立検証する
8. 検証成功後だけLaravelの決済が`confirmed`になる

ブラウザ側の成功表示だけでなく、テスト用DBの`status`、`tx_hash`、`user_id`、`paid_at`と、RPC stubの送信回数も照合します。

## シナリオ

- 正常系: Laravel画面からWalletを開き、Transferを1回だけ送信し、backend検証で確定する
- receipt反映待ち: Laravelの既存retry上限までは未検出とし、reload後も保存済みtxHashだけを再確認して、transactionを再送しない
- 期限切れ: backendの期限を信頼し、ログイン・署名・送信を開始しない

fixtureの決済IDは正常系`910001`、receipt反映待ち`910002`、期限切れ`910003`です。各テストの前に専用fixtureだけを初期状態へ戻します。

## 分離と安全性

- 実行ごとに`/tmp`配下へ新しいMySQL data directoryを作成します。
- database名と`APP_ENV=e2e`を二重に検査し、条件を満たさないseedingは拒否します。
- 空の専用databaseに通常の`php artisan migrate --force`を実行し、`migrate:fresh`は使用しません。
- WalletとLaravelのRPC URLは、このprocessだけでローカルstubへ差し替えます。通常のKairos設定は変更しません。
- mnemonic、秘密鍵、復号済みWallet、WalletパスワードはLivTへ送信しません。
- test用パスワードとLaravelの`APP_KEY`は実行時に生成し、ファイルへ保存・表示しません。
- access tokenや入力パスワードをartifactへ残さないため、このsuiteではPlaywright traceとvideoを無効にしています。失敗時はpassword欄がマスクされたscreenshotだけを保存します。
- 終了時にはローカルserviceを停止し、作成した一時MySQL directoryを削除します。

## 実環境との差分

RPC stubはTransfer transactionを解析し、署名元、chain ID、token contract、送金先、金額を検査してからreceiptを返します。ただし、実Kairosのnetwork伝播、gas変動、reorg、provider固有の挙動は再現しません。実ネットワークでの最終確認は、このローカルsuiteとは分離して行う必要があります。
