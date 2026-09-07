import type { Address, Hex } from 'viem'
import { erc20ReadAbi } from './erc20Abi'
import { activeNetworkPublicClient } from '../blockchain/networkClient'

export interface Erc20ReadClient {
  getBytecode(contractAddress: Address): Promise<Hex | undefined>
  readSymbol(contractAddress: Address): Promise<unknown>
  readDecimals(contractAddress: Address): Promise<unknown>
  readBalance(contractAddress: Address, ownerAddress: Address): Promise<unknown>
}

export const kairosErc20ReadClient: Erc20ReadClient = {
  getBytecode: (contractAddress) =>
    activeNetworkPublicClient.getBytecode({ address: contractAddress }),
  readSymbol: (contractAddress) =>
    activeNetworkPublicClient.readContract({
      abi: erc20ReadAbi,
      address: contractAddress,
      functionName: 'symbol',
    }),
  readDecimals: (contractAddress) =>
    activeNetworkPublicClient.readContract({
      abi: erc20ReadAbi,
      address: contractAddress,
      functionName: 'decimals',
    }),
  readBalance: (contractAddress, ownerAddress) =>
    activeNetworkPublicClient.readContract({
      abi: erc20ReadAbi,
      address: contractAddress,
      functionName: 'balanceOf',
      args: [ownerAddress],
    }),
}
