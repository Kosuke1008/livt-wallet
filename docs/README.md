# Documentation

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
