import type { Address, Hash, Hex } from 'viem'
import { kairosPublicClient } from './kairosClient'

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
  getNativeBalance: (address) => kairosPublicClient.getBalance({ address }),
  getGasPrice: () => kairosPublicClient.getGasPrice(),
  getPendingNonce: (address) =>
    kairosPublicClient.getTransactionCount({ address, blockTag: 'pending' }),
  sendRawTransaction: (serializedTransaction) =>
    kairosPublicClient.sendRawTransaction({ serializedTransaction }),
  waitForReceipt: async (transactionHash) => {
    const receipt = await kairosPublicClient.waitForTransactionReceipt({
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
