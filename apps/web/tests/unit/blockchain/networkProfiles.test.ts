import { describe, expect, it } from 'vitest'
import {
  NetworkConfigurationError,
  NetworkExecutionDisabledError,
  assertFeeDelegationExecutionAllowed,
  assertPaymentExecutionAllowed,
  resolveNetworkProfile,
} from '../../../src/blockchain/networkProfiles'

describe('network profiles', () => {
  it('resolves the Kairos profile and keeps its existing execution paths', () => {
    const profile = resolveNetworkProfile({
      VITE_BLOCKCHAIN_NETWORK: 'kairos',
      VITE_BLOCKCHAIN_KAIROS_RPC_URL: 'http://127.0.0.1:18545',
    })

    expect(profile).toMatchObject({
      id: 'kairos',
      version: 1,
      chainId: 1001,
      chainIdHex: '0x3e9',
      rpcUrl: 'http://127.0.0.1:18545/',
      isTestnet: true,
      paymentExecutionEnabled: true,
      feeDelegationExecutionEnabled: true,
    })
    expect(profile.jpyc).toEqual({
      contract: '0xe7c3d8c9a439fede00d2600032d5db0be71c3c29',
      symbol: 'JPYC',
      decimals: 18,
    })
    expect(() => assertPaymentExecutionAllowed(profile)).not.toThrow()
    expect(() => assertFeeDelegationExecutionAllowed(profile)).not.toThrow()
  })

  it('resolves Mainnet metadata but rejects payment and fee execution', () => {
    const profile = resolveNetworkProfile({
      VITE_BLOCKCHAIN_NETWORK: 'kaia-mainnet',
      VITE_BLOCKCHAIN_KAIA_MAINNET_RPC_URL: 'https://mainnet.example.test',
      VITE_MAINNET_PAYMENTS_ENABLED: 'true',
    })

    expect(profile).toMatchObject({
      id: 'kaia-mainnet',
      chainId: 8217,
      chainIdHex: '0x2019',
      isTestnet: false,
      paymentExecutionEnabled: false,
      feeDelegationExecutionEnabled: false,
    })
    expect(() => assertPaymentExecutionAllowed(profile)).toThrow(
      NetworkExecutionDisabledError,
    )
    expect(() => assertFeeDelegationExecutionAllowed(profile)).toThrow(
      NetworkExecutionDisabledError,
    )
  })

  it('requires both reviewed build capability and the Mainnet runtime gate', () => {
    const base = {
      VITE_BLOCKCHAIN_NETWORK: 'kaia-mainnet',
      VITE_BLOCKCHAIN_KAIA_MAINNET_RPC_URL: 'https://mainnet.example.test',
    }
    const safe = resolveNetworkProfile(base, {
      mainnetActivationReleaseCapable: true,
    })
    expect(safe.paymentExecutionEnabled).toBe(false)
    expect(safe.feeDelegationExecutionEnabled).toBe(false)

    const live = resolveNetworkProfile({
      ...base,
      VITE_MAINNET_PAYMENTS_ENABLED: 'true',
    }, { mainnetActivationReleaseCapable: true })
    expect(live.paymentExecutionEnabled).toBe(true)
    expect(live.feeDelegationExecutionEnabled).toBe(true)
  })

  it.each([
    {},
    { VITE_BLOCKCHAIN_NETWORK: '' },
    { VITE_BLOCKCHAIN_NETWORK: 'KAIROS' },
    { VITE_BLOCKCHAIN_NETWORK: 'mainnet' },
    { VITE_BLOCKCHAIN_NETWORK: '8217' },
    { VITE_BLOCKCHAIN_NETWORK: 1001 },
  ])('fails closed for missing, malformed, or unsupported selectors', (env) => {
    expect(() => resolveNetworkProfile(env)).toThrow(NetworkConfigurationError)
  })

  it('requires the selected Mainnet RPC', () => {
    expect(() =>
      resolveNetworkProfile({ VITE_BLOCKCHAIN_NETWORK: 'kaia-mainnet' }),
    ).toThrow('Kaia Mainnet RPC URL is missing')
  })

  it('rejects unsafe and malformed RPC URLs', () => {
    for (const rpcUrl of [
      'http://rpc.example.test',
      'https://user:pass@rpc.example.test',
      'not-a-url',
    ]) {
      expect(() =>
        resolveNetworkProfile({
          VITE_BLOCKCHAIN_NETWORK: 'kairos',
          VITE_BLOCKCHAIN_KAIROS_RPC_URL: rpcUrl,
        }),
      ).toThrow(NetworkConfigurationError)
    }
  })

  it('does not infer the blockchain network from APP_ENV or NODE_ENV', () => {
    const profile = resolveNetworkProfile({
      VITE_BLOCKCHAIN_NETWORK: 'kairos',
      VITE_BLOCKCHAIN_KAIROS_RPC_URL: 'https://kairos.example.test',
      APP_ENV: 'production',
      NODE_ENV: 'production',
    })

    expect(profile.id).toBe('kairos')
  })

  it('accepts the legacy Kairos RPC variable during migration', () => {
    const profile = resolveNetworkProfile({
      VITE_BLOCKCHAIN_NETWORK: 'kairos',
      VITE_KAIROS_RPC_URL: 'https://legacy-kairos.example.test',
    })

    expect(profile.rpcUrl).toBe('https://legacy-kairos.example.test/')
  })

  it('allows only the documented safe runtime default when requested', () => {
    expect(resolveNetworkProfile({}, { allowKairosDefault: true }).id).toBe(
      'kairos',
    )
  })

  it('rejects malformed Mainnet enable flags', () => {
    expect(() =>
      resolveNetworkProfile({
        VITE_BLOCKCHAIN_NETWORK: 'kairos',
        VITE_MAINNET_PAYMENTS_ENABLED: 'yes',
      }),
    ).toThrow(NetworkConfigurationError)
  })
})
