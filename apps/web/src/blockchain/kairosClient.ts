import {
  activeNetworkPublicClient,
  createActiveNetworkPublicClient,
  type ActiveNetworkPublicClient,
} from './networkClient'

// Compatibility exports for existing Kairos-focused tests and consumers.
export type KairosPublicClient = ActiveNetworkPublicClient

export function createKairosPublicClient(): KairosPublicClient {
  return createActiveNetworkPublicClient()
}

export const kairosPublicClient = activeNetworkPublicClient
