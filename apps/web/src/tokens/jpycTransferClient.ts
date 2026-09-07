import type { Address } from 'viem'
import { activeNetworkChain } from '../blockchain/activeNetwork'
import { activeNetworkPublicClient } from '../blockchain/networkClient'
import {
  kairosTransactionClient,
  type KairosTransactionClient,
} from '../blockchain/kairosTransaction'
import type { ChainIdentityClient } from '../blockchain/networkChainVerification'
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
  getChainId: () => activeNetworkPublicClient.getChainId(),
  simulateTransfer: async ({ contractAddress, sender, recipient, amount }) => {
    const simulation = await activeNetworkPublicClient.simulateContract({
      account: sender,
      chain: activeNetworkChain,
      address: contractAddress,
      abi: erc20TransferAbi,
      functionName: 'transfer',
      args: [recipient, amount],
    })
    return simulation.result
  },
  estimateTransferGas: ({ contractAddress, sender, recipient, amount }) =>
    activeNetworkPublicClient.estimateContractGas({
      account: sender,
      address: contractAddress,
      abi: erc20TransferAbi,
      functionName: 'transfer',
      args: [recipient, amount],
    }),
}
