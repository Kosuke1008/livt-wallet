import type { Address, Hash, Hex } from 'viem'
import { activeNetworkPublicClient } from './networkClient'

export interface KairosTransactionReceipt {
  readonly transactionHash: Hash
  readonly status: 'success' | 'reverted'
}

export interface KairosTransactionClient {
  getNativeBalance(address: Address): Promise<bigint>
  getGasPrice(): Promise<bigint>
  getPendingNonce(address: Address): Promise<number>
  sendRawTransaction(serializedTransaction: Hex): Promise<Hash>
  waitForReceipt(transactionHash: Hash): Promise<KairosTransactionReceipt>
}

export const kairosTransactionClient: KairosTransactionClient = {
  // 送金前に、手数料を支払うKAIA残高を読む
  getNativeBalance: (address) => activeNetworkPublicClient.getBalance({ address }),
  // gas priceはKairosが示す現在のガス単価として取得する
  getGasPrice: () => activeNetworkPublicClient.getGasPrice(),
  // nonceは同じ口座の取引順序を表すため、未確定取引も含めて取得する
  getPendingNonce: (address) =>
    activeNetworkPublicClient.getTransactionCount({ address, blockTag: 'pending' }),
  // 端末内で署名済みの生取引だけをRPCへ送る
  sendRawTransaction: (serializedTransaction) =>
    activeNetworkPublicClient.sendRawTransaction({ serializedTransaction }),
  waitForReceipt: async (transactionHash) => {
    // receiptだけを待ち、確認不能や時間切れでもここでは自動再送しない
    const receipt = await activeNetworkPublicClient.waitForTransactionReceipt({
      hash: transactionHash,
      checkReplacement: false,
      confirmations: 1,
      timeout: 60_000,
    })
    return {
      transactionHash: receipt.transactionHash,
      status: receipt.status,
    }
  },
}
