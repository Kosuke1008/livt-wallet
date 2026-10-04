import type { Address } from 'viem'

export type NetworkId = 'kairos' | 'kaia-mainnet'

interface NetworkProfileDefinition {
  readonly id: NetworkId
  readonly version: 1
  readonly chainId: 1001 | 8217
  readonly chainIdHex: '0x3e9' | '0x2019'
  readonly chainName: string
  readonly nativeCurrency: {
    readonly name: 'KAIA'
    readonly symbol: 'KAIA'
    readonly decimals: 18
  }
  readonly explorerUrl: string
  readonly isTestnet: boolean
  readonly jpyc: {
    readonly contract: Address
    readonly symbol: 'JPYC'
    readonly decimals: 18
  }
  readonly paymentExecutionEnabled: boolean
  readonly feeDelegationExecutionEnabled: boolean
}

export interface NetworkProfile extends NetworkProfileDefinition {
  readonly rpcUrl: string
}

export type NetworkEnvironment = Readonly<Record<string, unknown>>

export const DEFAULT_KAIROS_RPC_URL =
  'https://public-en-kairos.node.kaia.io'

const JPYC_CONTRACT =
  '0xe7c3d8c9a439fede00d2600032d5db0be71c3c29' as Address

export const NETWORK_PROFILE_DEFINITIONS = Object.freeze({
  kairos: Object.freeze({
    id: 'kairos',
    version: 1,
    chainId: 1001,
    chainIdHex: '0x3e9',
    chainName: 'Kaia Kairos',
    nativeCurrency: Object.freeze({
      name: 'KAIA',
      symbol: 'KAIA',
      decimals: 18,
    }),
    explorerUrl: 'https://kairos.kaiascan.io',
    isTestnet: true,
    jpyc: Object.freeze({
      contract: JPYC_CONTRACT,
      symbol: 'JPYC',
      decimals: 18,
    }),
    paymentExecutionEnabled: true,
    feeDelegationExecutionEnabled: true,
  }),
  'kaia-mainnet': Object.freeze({
    id: 'kaia-mainnet',
    version: 1,
    chainId: 8217,
    chainIdHex: '0x2019',
    chainName: 'Kaia Mainnet',
    nativeCurrency: Object.freeze({
      name: 'KAIA',
      symbol: 'KAIA',
      decimals: 18,
    }),
    explorerUrl: 'https://kaiascan.io',
    isTestnet: false,
    jpyc: Object.freeze({
      contract: JPYC_CONTRACT,
      symbol: 'JPYC',
      decimals: 18,
    }),
    // Phase 1 exposes Mainnet metadata for validation only.
    paymentExecutionEnabled: false,
    feeDelegationExecutionEnabled: false,
  }),
} satisfies Record<NetworkId, NetworkProfileDefinition>)

export class NetworkConfigurationError extends Error {
  readonly name = 'NetworkConfigurationError'
}

export class NetworkExecutionDisabledError extends Error {
  readonly name = 'NetworkExecutionDisabledError'

  constructor(readonly networkId: NetworkId) {
    super(`Payment execution is disabled for network: ${networkId}`)
  }
}

export function resolveNetworkId(
  configuredValue: unknown,
  options: { readonly allowKairosDefault?: boolean } = {},
): NetworkId {
  if (
    options.allowKairosDefault === true &&
    configuredValue === undefined
  ) {
    return 'kairos'
  }

  if (configuredValue === 'kairos' || configuredValue === 'kaia-mainnet') {
    return configuredValue
  }

  throw new NetworkConfigurationError(
    'VITE_BLOCKCHAIN_NETWORK is missing, malformed, or unsupported',
  )
}

export function resolveRpcUrl(configuredValue: unknown, label: string): string {
  if (typeof configuredValue !== 'string' || configuredValue === '') {
    throw new NetworkConfigurationError(`${label} RPC URL is missing`)
  }

  let url: URL
  try {
    url = new URL(configuredValue)
  } catch {
    throw new NetworkConfigurationError(`${label} RPC URL is invalid`)
  }

  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
  const allowedProtocol =
    url.protocol === 'https:' ||
    (url.protocol === 'http:' && localHosts.has(url.hostname))

  if (
    !allowedProtocol ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== ''
  ) {
    throw new NetworkConfigurationError(`${label} RPC URL is invalid`)
  }

  return url.href
}

export function resolveNetworkProfile(
  environment: NetworkEnvironment,
  options: {
    readonly allowKairosDefault?: boolean
    readonly mainnetActivationReleaseCapable?: boolean
  } = {},
): NetworkProfile {
  const networkId = resolveNetworkId(
    environment.VITE_BLOCKCHAIN_NETWORK,
    options,
  )
  const baseDefinition = NETWORK_PROFILE_DEFINITIONS[networkId]
  const capable = options.mainnetActivationReleaseCapable
    ?? (typeof __LIVT_MAINNET_ACTIVATION_RELEASE__ !== 'undefined'
      && __LIVT_MAINNET_ACTIVATION_RELEASE__)
  const mainnetRuntimeEnabled = environment.VITE_MAINNET_PAYMENTS_ENABLED === 'true'
  const definition = networkId === 'kaia-mainnet'
    ? {
        ...baseDefinition,
        paymentExecutionEnabled: capable && mainnetRuntimeEnabled,
        feeDelegationExecutionEnabled: capable && mainnetRuntimeEnabled,
      }
    : baseDefinition
  const configuredRpc =
    networkId === 'kairos'
      ? (environment.VITE_BLOCKCHAIN_KAIROS_RPC_URL ??
        environment.VITE_KAIROS_RPC_URL ??
        DEFAULT_KAIROS_RPC_URL)
      : environment.VITE_BLOCKCHAIN_KAIA_MAINNET_RPC_URL

  validateBooleanFlag(environment.VITE_MAINNET_PAYMENTS_ENABLED)

  return Object.freeze({
    ...definition,
    rpcUrl: resolveRpcUrl(configuredRpc, definition.chainName),
  })
}

export function assertPaymentExecutionAllowed(
  profile: NetworkProfile,
): void {
  if (!profile.paymentExecutionEnabled) {
    throw new NetworkExecutionDisabledError(profile.id)
  }
}

export function assertFeeDelegationExecutionAllowed(
  profile: NetworkProfile,
): void {
  if (!profile.feeDelegationExecutionEnabled) {
    throw new NetworkExecutionDisabledError(profile.id)
  }
}

function validateBooleanFlag(value: unknown): void {
  if (
    value !== undefined &&
    value !== '' &&
    value !== 'true' &&
    value !== 'false'
  ) {
    throw new NetworkConfigurationError(
      'VITE_MAINNET_PAYMENTS_ENABLED must be true or false',
    )
  }
}

// The pre-profile Wallet always used Kairos. Keep that safe development
// default during migration, while pure configuration resolution stays strict.
export const ACTIVE_NETWORK_PROFILE = resolveNetworkProfile(
  (import.meta.env ?? {}) as NetworkEnvironment,
  { allowKairosDefault: true },
)
