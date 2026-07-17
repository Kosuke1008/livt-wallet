import type { Address, Hex } from 'viem'
import { erc20ReadAbi } from './erc20Abi'
import { kairosPublicClient } from './kairosClient'

export interface Erc20ReadClient {
  getBytecode(contractAddress: Address): Promise<Hex | undefined>
  readSymbol(contractAddress: Address): Promise<unknown>
  readDecimals(contractAddress: Address): Promise<unknown>
  readBalance(contractAddress: Address, ownerAddress: Address): Promise<unknown>
}

export const kairosErc20ReadClient: Erc20ReadClient = {
  getBytecode: (contractAddress) =>
    kairosPublicClient.getBytecode({ address: contractAddress }),
  readSymbol: (contractAddress) =>
    kairosPublicClient.readContract({
      abi: erc20ReadAbi,
      address: contractAddress,
      functionName: 'symbol',
    }),
  readDecimals: (contractAddress) =>
    kairosPublicClient.readContract({
      abi: erc20ReadAbi,
      address: contractAddress,
      functionName: 'decimals',
    }),
  readBalance: (contractAddress, ownerAddress) =>
    kairosPublicClient.readContract({
      abi: erc20ReadAbi,
      address: contractAddress,
      functionName: 'balanceOf',
      args: [ownerAddress],
    }),
}

