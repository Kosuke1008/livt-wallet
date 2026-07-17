import type { Address } from 'viem'
import { kairosChain } from '../blockchain/kairos'
import { kairosPublicClient } from '../blockchain/kairosClient'
import {
  kairosTransactionClient,
  type KairosTransactionClient,
} from '../blockchain/kairosTransaction'
import type { ChainIdentityClient } from '../blockchain/kairosChainVerification'
import {
  kairosErc20ReadClient,
  type Erc20ReadClient,
} from './erc20Client'
import { erc20TransferAbi } from './erc20Abi'

export interface JpycTransferRpcClient
  extends Erc20ReadClient,
    ChainIdentityClient,
    KairosTransactionClient {
  simulateTransfer(parameters: {
    contractAddress: Address
    sender: Address
    recipient: Address
    amount: bigint
  }): Promise<unknown>
  estimateTransferGas(parameters: {
    contractAddress: Address
    sender: Address
    recipient: Address
    amount: bigint
  }): Promise<bigint>
}

export const kairosJpycTransferRpcClient: JpycTransferRpcClient = {
  ...kairosErc20ReadClient,
  ...kairosTransactionClient,
  getChainId: () => kairosPublicClient.getChainId(),
  simulateTransfer: async ({ contractAddress, sender, recipient, amount }) => {
    const simulation = await kairosPublicClient.simulateContract({
      account: sender,
      chain: kairosChain,
      address: contractAddress,
      abi: erc20TransferAbi,
      functionName: 'transfer',
      args: [recipient, amount],
    })
    return simulation.result
  },
  estimateTransferGas: ({ contractAddress, sender, recipient, amount }) =>
    kairosPublicClient.estimateContractGas({
      account: sender,
      address: contractAddress,
      abi: erc20TransferAbi,
      functionName: 'transfer',
      args: [recipient, amount],
    }),
}
