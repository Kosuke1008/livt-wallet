# Documentation

## ウォレット画面の流れ

ウォレットを解除するとホーム画面を表示し、画面内の操作で受取、送金、設定へ移動します。
画面を移動してもウォレットを作り直したり、暗号文を再度復号したりはしません。

| 画面 | 主な表示と役割 |
| --- | --- |
| ホーム | JPYC残高を主表示にし、受取・送金、短縮アドレスと完全なアドレスを写す操作、手数料用KAIA残高、設定への入口を順に表示 |
| 受取 | 完全な公開アドレス、Kaia Kairos、chain ID `1001`を表示。現在は住所表示だけで、QRは未実装 |
| 送金 | 既存の`JpycTransferPanel`とKairos JPYC手動送金処理を再利用 |
| 設定 | ネットワーク、chain ID、公開アドレス、テストネット用学習ウォレットであることなど、安全な既存情報だけを表示 |

JPYCとKAIAの取得状態は独立しており、片方の読み取りに失敗してももう片方を隠しません。
KAIAは主資産ではなく、Kairos上の取引手数料を支払うための残高として表示します。

この画面は広告、NFT、交換、価格図表、トークン購入、Mainnetを提供しません。QR対応は
将来の予定であり、今回の受取画面にはQR表示もQR読み取りもありません。

## 手動JPYC送金のソース対応表

このアプリはfrontendだけで動作し、backendを模した層はありません。RPCとの境界は
試験で差し替えられる小さなclient interfaceとして表現しています。

| 責務 | ファイル | 内容 |
| --- | --- | --- |
| 入力・確認・結果画面 | `apps/web/src/app/JpycTransferPanel.tsx` | 送り先と数量の入力、確認画面、パスワード再入力、処理結果 |
| 送金状態 | `apps/web/src/app/transferState.ts` | 編集から確定までの状態と、古い非同期結果を無視する処理世代 |
| 残高更新 | `apps/web/src/app/App.tsx` | 確定成功後のKAIA・JPYC再取得と古い残高応答の拒否 |
| 入力検証 | `apps/web/src/tokens/transferValidation.ts` | アドレス正規化、禁止宛先、10進数量、`bigint`、残高上限 |
| 承認済み通貨解決 | `apps/web/src/tokens/tokenRegistry.ts` | `jpyc`識別子から固定Kairos JPYC設定を解決 |
| 書き込みABI | `apps/web/src/tokens/erc20Abi.ts` | ERC-20 `transfer(address,uint256)`だけを定義 |
| 事前実行と送金順序 | `apps/web/src/tokens/jpycTransfer.ts` | chain確認、契約検証、simulation、gas、署名、broadcast、receipt |
| JPYC RPC境界 | `apps/web/src/tokens/jpycTransferClient.ts` | `simulateContract`と`estimateContractGas`をKairos clientへ接続 |
| chain確認 | `apps/web/src/blockchain/kairosChainVerification.ts` | RPCの`eth_chainId`が`1001`か検証 |
| 送信・receipt | `apps/web/src/blockchain/kairosTransaction.ts` | raw transaction送信と成功・revertのreceipt取得 |
| 一時署名者 | `apps/web/src/wallet/signingAccount.ts` | 保存暗号文を署名直前だけ復号し、derived addressを照合 |

## データの流れ

```text
JpycTransferPanel
  → createJpycTransferIntent
  → transferReducer: reviewing
  → 利用者の最終確認
  → executeJpycTransfer
      → resolveApprovedToken("jpyc")
      → verifyKairosChain(1001)
      → validateErc20Token
      → simulateTransfer / estimateTransferGas
      → KAIA残高・gas price・nonce確認
      → withStoredSigningAccount
          → decryptMnemonic
          → derived address照合
          → local sign
      → sendRawTransaction（一度だけ）
      → waitForReceipt
  → 成功receiptの場合だけAppがKAIA・JPYC残高を更新
```

取引番号は署名済み取引から送信前に計算します。RPCが異なる番号を返した場合や送信時に
通信が切れた場合は、二重送信を避けるため確認不能として扱います。receiptがrevertなら
成功画面には進みません。時間切れも失敗とは断定せず、取引番号を残して自動再送しません。
