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

## ウォレット画面

解除後のホーム画面は、JPYC残高を最も大きく表示します。受取と送金を主な操作とし、
短縮したウォレットアドレス、完全なアドレスを写す操作、手数料用のKAIA残高、設定の順に
表示します。KAIAはJPYCと合算せず、Kairos上の取引手数料を支払うための残高として扱います。

受取画面は、完全なウォレットアドレス、Kaia Kairos、chain ID `1001`を表示するだけです。
QR表示とQR読み取りは将来の対応予定で、現在は実装していません。送金画面は、既存の
Kairos JPYC手動送金処理をそのまま利用します。設定画面には、ネットワーク、chain ID、
公開アドレス、Kairosテストネット用の学習ウォレットであることなど、安全に公開できる
既存情報だけを表示します。

広告、NFT、交換、価格図表、トークン購入、Mainnetには対応していません。

## 手動JPYC送金

解除したウォレットから、承認済みKairos JPYCだけを手動送金できます。送り先はEVM
アドレスを直接入力し、数量は浮動小数点数へ変換せず、10進数の文字列から`bigint`の
最小単位へ変換します。自分自身、ゼロアドレス、JPYC契約自身への送金は拒否します。

送金は次の順序で進みます。

1. 送り先と数量を検証
2. 接続先、送り主、送り先、数量、JPYC契約を確認画面に表示
3. 利用者がパスワードを再入力して送信を明示確認
4. RPCのchain IDがKairosの`1001`であることを確認
5. 承認済みJPYCのbytecode、symbol、decimalsを再検証
6. `transfer`を事前実行し、ガス使用量とKAIA残高を確認
7. 暗号化したニーモニックを一時的に復号し、保存アドレスと署名アドレスを照合
8. chain ID `1001`を含む取引へ端末内で署名
9. 署名済み取引をKairosへ一度だけ送信
10. receiptを待ち、成功、取り消し、時間切れ、確認不能を区別
11. 成功receiptの後だけKAIAとJPYC残高を更新

JPYC送金の手数料はJPYCから差し引かれず、別途KAIAで支払います。取引番号が返った
だけでは成功ではありません。receiptの`status`が成功になって初めて確定済みとして
表示します。送信後に通信が切れた場合は取引が届いている可能性があるため、自動再送
しません。

署名にはMetaMaskや`window.ethereum`を使いません。ニーモニック、秘密鍵、パスワード、
署名用アカウントを保存領域へ追加せず、署名用アカウントは送信処理中だけ復元します。
JavaScriptの文字列を安全に消去できるとはみなさず、参照時間を短くする設計です。

この機能はKairosテストネットで学習するためのものです。QR読み取り、任意トークン、
gas sponsorship、fee delegation、Mainnet、実資産には対応しておらず、本番向けの安全性を
保証するものではありません。

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
- `tokens`: 承認token設定、検証、残高読み取り、送金事前実行、表示format

テストの構成:

- `src`: production application code
- `tests/unit`: 独立した関数とcomponentのテスト
- `tests/integration`: 複数moduleとmock RPC境界を通すテスト
- `e2e`: browser levelのPlaywrightテスト
