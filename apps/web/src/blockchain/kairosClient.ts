import { createPublicClient, http, type PublicClient } from 'viem'
import { kairosChain, KAIROS_NETWORK } from './kairos'

export type KairosPublicClient = PublicClient<ReturnType<typeof http>, typeof kairosChain>

export function createKairosPublicClient(): KairosPublicClient {
  return createPublicClient({
    chain: kairosChain,
    transport: http(KAIROS_NETWORK.rpcUrl, {
      retryCount: 0,
      timeout: 10_000,
    }),
  })
}

export const kairosPublicClient = createKairosPublicClient()

