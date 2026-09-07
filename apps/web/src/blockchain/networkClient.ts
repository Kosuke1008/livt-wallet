import { createPublicClient, http, type PublicClient } from 'viem'
import { activeNetworkChain } from './activeNetwork'
import { ACTIVE_NETWORK_PROFILE } from './networkProfiles'

export type ActiveNetworkPublicClient = PublicClient<
  ReturnType<typeof http>,
  typeof activeNetworkChain
>

export function createActiveNetworkPublicClient(): ActiveNetworkPublicClient {
  return createPublicClient({
    chain: activeNetworkChain,
    transport: http(ACTIVE_NETWORK_PROFILE.rpcUrl, {
      retryCount: 0,
      timeout: 10_000,
    }),
  })
}

export const activeNetworkPublicClient = createActiveNetworkPublicClient()
