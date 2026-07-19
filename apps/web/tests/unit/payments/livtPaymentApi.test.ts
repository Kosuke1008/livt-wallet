import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Hash } from 'viem'
import {
  clearPaymentAccessToken,
  createLivtPaymentApiClient,
  getConfiguredLivtApiBaseUrl,
  InvalidLivtApiConfigurationError,
  LivtPaymentApiError,
  loadPaymentAccessToken,
  savePaymentAccessToken,
  type PaymentTokenStorage,
} from '../../../src/payments/livtPaymentApi'

const transactionHash = `0x${'a'.repeat(64)}` as Hash

const paymentDetails = {
  id: 42,
  amount: 125,
  display_amount: '125',
  atomic_amount: '125000000000000000000',
  status: 'pending',
  store_name: 'API Test Store',
  recipient_address: '0x2222222222222222222222222222222222222222',
  network: 'kairos',
  chain_name: 'Kaia Kairos Testnet',
  chain_id: 1001,
  token_contract: '0xe7c3d8c9a439fede00d2600032d5db0be71c3c29',
  token_symbol: 'JPYC',
  token_decimals: 18,
  expires_at: '2026-07-18 04:00:00',
  expires_at_iso: '2026-07-18T04:00:00+00:00',
}

describe('LivT payment API client', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.useRealTimers())

  it('trusted backendからauthoritative payment detailsを取得する', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(paymentDetails),
    )
    const client = createLivtPaymentApiClient(
      new URL('https://livt.example.test/'),
      fetchMock,
    )

    await expect(client.getPaymentDetails('42')).resolves.toEqual(
      paymentDetails,
    )

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://livt.example.test/api/payments/42')
    expect(init?.credentials).toBe('omit')
    expect(init?.referrerPolicy).toBe('no-referrer')
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)
  })

  it('payment login requestにcredentialだけをJSONで送る', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        token: '1|short-lived-payment-token',
        token_type: 'Bearer',
        expires_at: '2026-07-18T03:30:00+00:00',
        user: { id: 7, name: 'Test User' },
      }),
    )
    const client = createLivtPaymentApiClient(
      new URL('https://livt.example.test/'),
      fetchMock,
    )

    const result = await client.login('user@example.test', 'password-value')

    expect(result.token).toBe('1|short-lived-payment-token')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://livt.example.test/api/payment/login')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'user@example.test',
      password: 'password-value',
    })
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)
  })

  it('normalized txHashだけを既存confirm endpointへBearerで送る', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ success: true }),
    )
    const client = createLivtPaymentApiClient(
      new URL('https://livt.example.test/'),
      fetchMock,
    )

    await client.confirmPayment(
      '42',
      transactionHash.toUpperCase().replace('0X', '0x') as Hash,
      '1|short-lived-payment-token',
    )

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(
      'https://livt.example.test/api/payments/42/confirm',
    )
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Bearer 1|short-lived-payment-token',
    )
    expect(JSON.parse(String(init?.body))).toEqual({
      tx_hash: transactionHash,
    })
  })

  it('限定tokenをsafe payment session endpointだけで検証する', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ user: { id: 7, name: 'Test User' } }),
    )
    const client = createLivtPaymentApiClient(
      new URL('https://livt.example.test/'),
      fetchMock,
    )

    await expect(
      client.getCurrentUser('1|short-lived-payment-token'),
    ).resolves.toEqual({ id: 7, name: 'Test User' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(
      'https://livt.example.test/api/payment/session',
    )
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Bearer 1|short-lived-payment-token',
    )
  })

  it.each([
    [400, { error: 'Transaction not found' }, 'receipt-pending'],
    [400, { error: 'Duplicate tx_hash' }, 'duplicate-transaction'],
    [400, { error: 'Expired' }, 'expired'],
    [401, { error: 'Unauthenticated user' }, 'unauthenticated'],
    [503, { error: 'WEB3 RPC is unavailable' }, 'backend-unavailable'],
  ] as const)(
    'confirm error HTTP %sを%sへ分類する',
    async (status, body, reason) => {
      const client = createLivtPaymentApiClient(
        new URL('https://livt.example.test/'),
        vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body, status)),
      )

      const error = await client
        .confirmPayment('42', transactionHash, '1|token')
        .catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(LivtPaymentApiError)
      expect((error as LivtPaymentApiError).reason).toBe(reason)
    },
  )

  it('malformed responseとtransport failureを安全に分類する', async () => {
    const malformedClient = createLivtPaymentApiClient(
      new URL('https://livt.example.test/'),
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('<html>private upstream error</html>'),
      ),
    )
    const unavailableClient = createLivtPaymentApiClient(
      new URL('https://livt.example.test/'),
      vi.fn<typeof fetch>().mockRejectedValue(
        new Error('private backend URL failed'),
      ),
    )

    await expectApiError(
      malformedClient.getPaymentDetails('42'),
      'malformed-response',
    )
    await expectApiError(
      unavailableClient.getPaymentDetails('42'),
      'backend-unavailable',
    )
  })

  it('backend responseが停止した場合は15秒で安全にtimeoutする', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn<typeof fetch>((_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      }),
    )
    const client = createLivtPaymentApiClient(
      new URL('https://livt.example.test/'),
      fetchMock,
    )
    const request = client.getPaymentDetails('42')
    const assertion = expectApiError(request, 'backend-unavailable')

    await vi.advanceTimersByTimeAsync(15_000)
    await assertion
  })

  it('HTTPSまたはlocal HTTPのroot originだけを信頼する', () => {
    expect(getConfiguredLivtApiBaseUrl('https://livt.example.test').href).toBe(
      'https://livt.example.test/',
    )
    expect(getConfiguredLivtApiBaseUrl('http://localhost:8000').href).toBe(
      'http://localhost:8000/',
    )

    for (const value of [
      'http://livt.example.test',
      'https://user:secret@livt.example.test',
      'https://livt.example.test/api',
      'not-a-url',
    ]) {
      expect(() => getConfiguredLivtApiBaseUrl(value)).toThrow(
        InvalidLivtApiConfigurationError,
      )
    }
  })

  it('短命tokenをsession storage境界で保存・削除する', () => {
    const storage = createMemoryStorage()

    expect(loadPaymentAccessToken(storage)).toBeNull()
    savePaymentAccessToken('1|short-lived-token', storage)
    expect(loadPaymentAccessToken(storage)).toBe('1|short-lived-token')
    clearPaymentAccessToken(storage)
    expect(loadPaymentAccessToken(storage)).toBeNull()
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function expectApiError(
  promise: Promise<unknown>,
  reason: LivtPaymentApiError['reason'],
) {
  const error = await promise.catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(LivtPaymentApiError)
  expect((error as LivtPaymentApiError).reason).toBe(reason)
}

function createMemoryStorage(): PaymentTokenStorage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}
