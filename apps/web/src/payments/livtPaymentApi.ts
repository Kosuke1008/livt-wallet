import { z } from 'zod'
import type { Hash, Hex } from 'viem'

const evmAddressPattern = /^0x[0-9a-fA-F]{40}$/
const atomicAmountPattern = /^(?:0|[1-9]\d*)$/
const transactionHashPattern = /^0x[0-9a-fA-F]{64}$/
const isoDatePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

export const livtPaymentDetailsSchema = z
  .object({
    id: z.number().int().positive().safe(),
    amount: z.number().int().positive().safe(),
    display_amount: z.string().regex(/^[1-9]\d*$/),
    atomic_amount: z.string().regex(atomicAmountPattern),
    status: z.enum(['pending', 'confirmed', 'failed']),
    store_name: z.string().trim().min(1).max(255),
    recipient_address: z.string().regex(evmAddressPattern),
    network: z.string().trim().min(1).max(64),
    chain_name: z.string().trim().min(1).max(255),
    chain_id: z.number().int().positive().safe(),
    token_contract: z.string().regex(evmAddressPattern),
    token_symbol: z.string().trim().min(1).max(32),
    token_decimals: z.number().int().min(0).max(255),
    expires_at: z.string().max(64).nullable(),
    expires_at_iso: z
      .string()
      .regex(isoDatePattern)
      .refine((value) => !Number.isNaN(Date.parse(value)))
      .nullable(),
  })
  .strict()

const loginResponseSchema = z
  .object({
    token: z.string().min(1).max(4096).regex(/^\S+$/),
    token_type: z.literal('Bearer'),
    expires_at: z
      .string()
      .regex(isoDatePattern)
      .refine((value) => !Number.isNaN(Date.parse(value))),
    user: z
      .object({
        id: z.number().int().positive().safe(),
        name: z.string().min(1).max(255),
      })
      .strict(),
  })
  .strict()

const currentUserResponseSchema = z.object({
  user: z.object({
    id: z.number().int().positive().safe(),
    name: z.string().min(1).max(255),
  }).strict(),
}).strict()

const confirmationResponseSchema = z
  .object({ success: z.literal(true) })
  .strict()

const sponsorshipResponseSchema = z
  .object({
    transaction_hash: z.string().regex(transactionHashPattern),
  })
  .strict()

const sponsorshipAvailabilityResponseSchema = z
  .object({ available: z.boolean() })
  .strict()

export type LivtPaymentDetails = z.infer<typeof livtPaymentDetailsSchema>
export type LivtPaymentLoginResult = z.infer<typeof loginResponseSchema>
export type LivtPaymentSessionUser = z.infer<
  typeof currentUserResponseSchema
>['user']

export type LivtPaymentApiErrorReason =
  | 'authentication-rejected'
  | 'unauthenticated'
  | 'payment-not-found'
  | 'already-confirmed'
  | 'expired'
  | 'receipt-pending'
  | 'duplicate-transaction'
  | 'verification-rejected'
  | 'sponsorship-rejected'
  | 'sponsorship-unknown'
  | 'sponsorship-unavailable'
  | 'backend-unavailable'
  | 'malformed-response'

export class LivtPaymentApiError extends Error {
  readonly name = 'LivtPaymentApiError'
  readonly reason: LivtPaymentApiErrorReason
  readonly status: number | null

  constructor(
    reason: LivtPaymentApiErrorReason,
    status: number | null = null,
    options?: ErrorOptions,
  ) {
    super(`LivT payment API error: ${reason}`, options)
    this.reason = reason
    this.status = status
  }
}

export class InvalidLivtApiConfigurationError extends Error {
  readonly name = 'InvalidLivtApiConfigurationError'

  constructor() {
    super('The trusted LivT API base URL is not configured')
  }
}

export class InvalidLivtTransactionHashError extends Error {
  readonly name = 'InvalidLivtTransactionHashError'

  constructor() {
    super('Invalid LivT payment transaction hash')
  }
}

export type PaymentTokenStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
>

export interface LivtPaymentApiClient {
  getPaymentDetails(paymentId: string): Promise<LivtPaymentDetails>
  getPaymentSponsorshipAvailability(paymentId: string): Promise<boolean>
  login(email: string, password: string): Promise<LivtPaymentLoginResult>
  getCurrentUser(accessToken: string): Promise<LivtPaymentSessionUser>
  confirmPayment(
    paymentId: string,
    transactionHash: Hash,
    accessToken: string,
  ): Promise<void>
  sponsorPayment(
    paymentId: string,
    senderSignedTransaction: Hex,
    accessToken: string,
  ): Promise<Hash>
  logout(accessToken: string): Promise<void>
}

type FetchImplementation = typeof fetch

const PAYMENT_TOKEN_STORAGE_KEY = 'livt-wallet:payment-access-token'

export function getConfiguredLivtApiBaseUrl(
  configuredValue: unknown = import.meta.env.VITE_LIVT_API_BASE_URL,
): URL {
  if (typeof configuredValue !== 'string' || configuredValue.trim() === '') {
    throw new InvalidLivtApiConfigurationError()
  }

  let url: URL
  try {
    url = new URL(configuredValue)
  } catch {
    throw new InvalidLivtApiConfigurationError()
  }

  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
  const isAllowedProtocol =
    url.protocol === 'https:' ||
    (url.protocol === 'http:' && localHosts.has(url.hostname))

  if (
    !isAllowedProtocol ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new InvalidLivtApiConfigurationError()
  }

  return url
}

export function createLivtPaymentApiClient(
  baseUrl: URL,
  fetchImplementation: FetchImplementation = fetch,
): LivtPaymentApiClient {
  const endpoint = (path: string) => new URL(path, baseUrl)

  return {
    async getPaymentDetails(paymentId) {
      // [Flow E] Laravelのsource-neutral payment details APIを読む。
      const response = await safeFetch(
        fetchImplementation,
        endpoint(`/api/payments/${encodePaymentId(paymentId)}`),
        {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        },
      )

      if (response.status === 404) {
        throw new LivtPaymentApiError('payment-not-found', response.status)
      }
      if (!response.ok) {
        throw new LivtPaymentApiError('backend-unavailable', response.status)
      }

      return parseResponse(response, livtPaymentDetailsSchema)
    },

    async getPaymentSponsorshipAvailability(paymentId) {
      const paymentPath = encodePaymentId(paymentId)
      let response: Response

      try {
        response = await safeFetch(
          fetchImplementation,
          endpoint(`/api/payments/${paymentPath}/sponsorship`),
          {
            headers: { Accept: 'application/json' },
            cache: 'no-store',
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
          },
        )
      } catch {
        return false
      }

      if (!response.ok) return false

      try {
        const result = await parseResponse(
          response,
          sponsorshipAvailabilityResponseSchema,
        )
        return result.available
      } catch {
        return false
      }
    },

    async login(email, password) {
      // [Flow I] 決済確認だけに使う短時間tokenを取得する。
      const response = await safeFetch(
        fetchImplementation,
        endpoint('/api/payment/login'),
        jsonRequest({ email, password }),
      )

      if (response.status === 401 || response.status === 422) {
        throw new LivtPaymentApiError(
          'authentication-rejected',
          response.status,
        )
      }
      if (!response.ok) {
        throw new LivtPaymentApiError('backend-unavailable', response.status)
      }

      return parseResponse(response, loginResponseSchema)
    },

    async getCurrentUser(accessToken) {
      const response = await safeFetch(
        fetchImplementation,
        endpoint('/api/payment/session'),
        authenticatedRequest(accessToken),
      )

      if (response.status === 401 || response.status === 403) {
        throw new LivtPaymentApiError('unauthenticated', response.status)
      }
      if (!response.ok) {
        throw new LivtPaymentApiError('backend-unavailable', response.status)
      }

      const session = await parseResponse(
        response,
        currentUserResponseSchema,
      )
      return session.user
    },

    async confirmPayment(paymentId, transactionHash, accessToken) {
      // [Flow M] 正規化したtxHashをMetaMaskと共通の確認APIへ送る。
      const normalizedHash = normalizeLivtTransactionHash(transactionHash)
      const response = await safeFetch(
        fetchImplementation,
        endpoint(`/api/payments/${encodePaymentId(paymentId)}/confirm`),
        authenticatedJsonRequest(accessToken, { tx_hash: normalizedHash }),
      )

      if (!response.ok) {
        throw await classifyConfirmationError(response)
      }

      await parseResponse(response, confirmationResponseSchema)
    },

    async sponsorPayment(
      paymentId,
      senderSignedTransaction,
      accessToken,
    ) {
      const normalizedTransaction = normalizeSenderSignedTransaction(
        senderSignedTransaction,
      )
      const response = await safeFetch(
        fetchImplementation,
        endpoint(`/api/payments/${encodePaymentId(paymentId)}/sponsor`),
        authenticatedJsonRequest(accessToken, {
          sender_signed_tx: normalizedTransaction,
        }),
        {
          timeoutMilliseconds: 130_000,
          transportFailureReason: 'sponsorship-unknown',
        },
      )

      if (!response.ok) {
        throw await classifySponsorshipError(response)
      }

      const result = await parseResponse(response, sponsorshipResponseSchema)
      return normalizeLivtTransactionHash(result.transaction_hash)
    },

    async logout(accessToken) {
      const response = await safeFetch(
        fetchImplementation,
        endpoint('/api/user/logout'),
        authenticatedJsonRequest(accessToken),
      )

      if (response.status === 401 || response.status === 403) return
      if (!response.ok) {
        throw new LivtPaymentApiError('backend-unavailable', response.status)
      }
    },
  }
}

export function normalizeLivtTransactionHash(value: unknown): Hash {
  if (typeof value !== 'string' || !transactionHashPattern.test(value)) {
    throw new InvalidLivtTransactionHashError()
  }

  return value.toLowerCase() as Hash
}

export function normalizeSenderSignedTransaction(value: unknown): Hex {
  if (
    typeof value !== 'string' ||
    value.length < 4 ||
    value.length > 8194 ||
    value.length % 2 !== 0 ||
    !/^0x[0-9a-fA-F]+$/.test(value)
  ) {
    throw new LivtPaymentApiError('sponsorship-rejected')
  }

  return value.toLowerCase() as Hex
}

export function loadPaymentAccessToken(
  storage: PaymentTokenStorage = sessionStorage,
): string | null {
  const token = storage.getItem(PAYMENT_TOKEN_STORAGE_KEY)
  if (token === null) return null
  if (token.length === 0 || token.length > 4096 || /\s/.test(token)) {
    storage.removeItem(PAYMENT_TOKEN_STORAGE_KEY)
    return null
  }
  return token
}

export function savePaymentAccessToken(
  token: string,
  storage: PaymentTokenStorage = sessionStorage,
): void {
  if (token.length === 0 || token.length > 4096 || /\s/.test(token)) {
    throw new LivtPaymentApiError('malformed-response')
  }
  storage.setItem(PAYMENT_TOKEN_STORAGE_KEY, token)
}

export function clearPaymentAccessToken(
  storage: PaymentTokenStorage = sessionStorage,
): void {
  storage.removeItem(PAYMENT_TOKEN_STORAGE_KEY)
}

function encodePaymentId(paymentId: string): string {
  if (!/^[1-9]\d{0,18}$/.test(paymentId)) {
    throw new LivtPaymentApiError('payment-not-found')
  }
  return encodeURIComponent(paymentId)
}

function jsonRequest(body?: unknown): RequestInit {
  return {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  }
}

function authenticatedRequest(accessToken: string): RequestInit {
  validateAccessToken(accessToken)
  return {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  }
}

function authenticatedJsonRequest(
  accessToken: string,
  body?: unknown,
): RequestInit {
  return {
    ...jsonRequest(body),
    headers: {
      ...jsonRequest().headers,
      Authorization: `Bearer ${validateAccessToken(accessToken)}`,
    },
  }
}

function validateAccessToken(accessToken: string): string {
  if (
    accessToken.length === 0 ||
    accessToken.length > 4096 ||
    /\s/.test(accessToken)
  ) {
    throw new LivtPaymentApiError('unauthenticated')
  }
  return accessToken
}

async function safeFetch(
  fetchImplementation: FetchImplementation,
  input: URL,
  init: RequestInit,
  options: {
    readonly timeoutMilliseconds?: number
    readonly transportFailureReason?: LivtPaymentApiErrorReason
  } = {},
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMilliseconds ?? 15_000,
  )

  try {
    return await fetchImplementation(input, {
      ...init,
      signal: controller.signal,
    })
  } catch (error) {
    throw new LivtPaymentApiError(
      options.transportFailureReason ?? 'backend-unavailable',
      null,
      { cause: error },
    )
  } finally {
    clearTimeout(timeout)
  }
}

async function parseResponse<Schema extends z.ZodType>(
  response: Response,
  schema: Schema,
): Promise<z.infer<Schema>> {
  let value: unknown
  try {
    const text = await response.text()
    if (text.trim() === '') throw new Error('Empty JSON response')
    value = JSON.parse(text)
  } catch (error) {
    throw new LivtPaymentApiError('malformed-response', response.status, {
      cause: error,
    })
  }

  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new LivtPaymentApiError('malformed-response', response.status)
  }
  return parsed.data
}

async function classifyConfirmationError(
  response: Response,
): Promise<LivtPaymentApiError> {
  if (response.status === 401 || response.status === 403) {
    return new LivtPaymentApiError('unauthenticated', response.status)
  }
  if (response.status === 404) {
    return new LivtPaymentApiError('payment-not-found', response.status)
  }
  if (response.status >= 500) {
    return new LivtPaymentApiError('backend-unavailable', response.status)
  }

  const publicError = await readPublicError(response)
  const reason =
    publicError === 'Already paid'
      ? 'already-confirmed'
      : publicError === 'Expired'
        ? 'expired'
        : publicError === 'Transaction not found'
          ? 'receipt-pending'
          : publicError === 'Duplicate tx_hash'
            ? 'duplicate-transaction'
            : 'verification-rejected'

  return new LivtPaymentApiError(reason, response.status)
}

async function classifySponsorshipError(
  response: Response,
): Promise<LivtPaymentApiError> {
  if (response.status === 401 || response.status === 403) {
    return new LivtPaymentApiError('unauthenticated', response.status)
  }
  if (response.status === 404) {
    return new LivtPaymentApiError('payment-not-found', response.status)
  }
  if (response.status === 429) {
    return new LivtPaymentApiError(
      'sponsorship-unavailable',
      response.status,
    )
  }

  const publicError = await readPublicError(response)
  if (publicError === 'Already paid') {
    return new LivtPaymentApiError('already-confirmed', response.status)
  }
  if (publicError === 'Expired') {
    return new LivtPaymentApiError('expired', response.status)
  }
  if (publicError === 'Fee sponsorship status is unknown') {
    return new LivtPaymentApiError('sponsorship-unknown', response.status)
  }
  if (publicError === 'Fee sponsorship rejected') {
    return new LivtPaymentApiError('sponsorship-rejected', response.status)
  }
  if (publicError === 'Fee sponsorship is unavailable') {
    return new LivtPaymentApiError(
      'sponsorship-unavailable',
      response.status,
    )
  }
  if (response.status >= 500) {
    return new LivtPaymentApiError(
      'sponsorship-unavailable',
      response.status,
    )
  }

  return new LivtPaymentApiError('sponsorship-rejected', response.status)
}

async function readPublicError(response: Response): Promise<string | null> {
  try {
    const value: unknown = JSON.parse(await response.text())
    if (
      typeof value === 'object' &&
      value !== null &&
      'error' in value &&
      typeof value.error === 'string'
    ) {
      return value.error
    }
  } catch {
    return null
  }
  return null
}
