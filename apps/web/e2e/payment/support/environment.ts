import { execFileSync } from 'node:child_process'

export const paymentFixtures = Object.freeze({
  happyPaymentId: 910001,
  recoveryPaymentId: 910002,
  expiredPaymentId: 910003,
  sequentialFirstPaymentId: 910004,
  sequentialSecondPaymentId: 910005,
  email: 'browser-payment-e2e@example.test',
  storeName: 'Browser Review Store',
  recipientAddress: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
  tokenAddress: '0xe7c3d8c9a439fede00d2600032d5db0be71c3c29',
  amount: '125',
  atomicAmount: '125000000000000000000',
  sequentialFirstAmount: '2375',
  sequentialFirstAtomicAmount: '2375000000000000000000',
  sequentialSecondAmount: '4999',
  sequentialSecondAtomicAmount: '4999000000000000000000',
})

export type RpcScenario = 'happy' | 'receipt-pending-once'

export interface PaymentDatabaseState {
  readonly status: string
  readonly transactionHash: string | null
  readonly userId: number | null
  readonly hasPaidAt: boolean
}

export interface RpcState {
  readonly scenario: RpcScenario
  readonly chainChecks: number
  readonly simulations: number
  readonly broadcasts: number
  readonly receiptReads: number
  readonly browserReceiptReads: number
  readonly backendReceiptReads: number
  readonly transactionHash: string | null
  readonly lastTransfer: {
    readonly recipient: string
    readonly amount: string
  } | null
  readonly transfers: readonly {
    readonly transactionHash: string
    readonly recipient: string
    readonly amount: string
  }[]
}

export const browserEnvironment = Object.freeze({
  backendUrl: requiredLocalUrl('LIVT_E2E_BACKEND_URL'),
  walletUrl: requiredLocalUrl('LIVT_E2E_WALLET_URL'),
  rpcUrl: requiredLocalUrl('LIVT_E2E_RPC_URL'),
  backendDirectory: requiredAbsolutePath('LIVT_E2E_BACKEND_DIRECTORY'),
  databaseSocket: requiredAbsolutePath('LIVT_E2E_DB_SOCKET'),
  databaseName: requiredE2eDatabaseName(),
  userPassword: requiredSecret('LIVT_E2E_USER_PASSWORD'),
  walletPassword: requiredSecret('LIVT_E2E_WALLET_PASSWORD'),
})

export function resetBackendFixtures(): void {
  assertIsolatedEnvironment()
  try {
    execFileSync(
      'php',
      [
        'artisan',
        'db:seed',
        '--class=Database\\Seeders\\PaymentBrowserTestSeeder',
        '--force',
        '--no-interaction',
      ],
      {
        cwd: browserEnvironment.backendDirectory,
        env: process.env,
        stdio: 'pipe',
        timeout: 30_000,
      },
    )
  } catch {
    throw new Error('Could not reset isolated payment fixtures')
  }
}

export async function resetRpcScenario(scenario: RpcScenario): Promise<void> {
  const response = await fetch(new URL('/control/reset', browserEnvironment.rpcUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario }),
  })
  if (!response.ok) throw new Error('Could not reset local RPC scenario')
}

export async function readRpcState(): Promise<RpcState> {
  const response = await fetch(new URL('/control/state', browserEnvironment.rpcUrl))
  if (!response.ok) throw new Error('Could not read local RPC state')
  return validateRpcState(await response.json())
}

export function readPaymentState(paymentId: number): PaymentDatabaseState {
  assertIsolatedEnvironment()
  if (!Number.isSafeInteger(paymentId) || paymentId <= 0) {
    throw new Error('Invalid payment fixture identifier')
  }

  const query = [
    'SELECT status,',
    "COALESCE(tx_hash, ''),",
    "COALESCE(CAST(user_id AS CHAR), ''),",
    "IF(paid_at IS NULL, '0', '1')",
    'FROM payments',
    `WHERE id = ${paymentId}`,
  ].join(' ')

  let output: string
  try {
    output = execFileSync(
      'mysql',
      [
        '--no-defaults',
        '--protocol=socket',
        `--socket=${browserEnvironment.databaseSocket}`,
        '--user=root',
        '--batch',
        '--skip-column-names',
        browserEnvironment.databaseName,
        '--execute',
        query,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5_000 },
    ).trim()
  } catch {
    throw new Error('Could not read isolated payment state')
  }

  const [status, transactionHash, userId, paidAt, ...extra] = output.split('\t')
  if (
    status === undefined ||
    transactionHash === undefined ||
    userId === undefined ||
    paidAt === undefined ||
    extra.length > 0 ||
    !['0', '1'].includes(paidAt) ||
    (userId !== '' && !/^\d+$/.test(userId))
  ) {
    throw new Error('Malformed isolated payment state')
  }

  return {
    status,
    transactionHash: transactionHash === '' ? null : transactionHash,
    userId: userId === '' ? null : Number(userId),
    hasPaidAt: paidAt === '1',
  }
}

function assertIsolatedEnvironment(): void {
  if (
    process.env.APP_ENV !== 'e2e' ||
    !browserEnvironment.databaseName.toLowerCase().includes('e2e')
  ) {
    throw new Error('Payment browser database is not isolated')
  }
}

function requiredLocalUrl(name: string): URL {
  const value = process.env[name]
  if (value === undefined) throw new Error(`Missing ${name}`)

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`Invalid ${name}`)
  }

  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error(`Unsafe ${name}`)
  }
  return url
}

function requiredAbsolutePath(name: string): string {
  const value = process.env[name]
  if (value === undefined || !value.startsWith('/')) {
    throw new Error(`Missing ${name}`)
  }
  return value
}

function requiredE2eDatabaseName(): string {
  const value = process.env.LIVT_E2E_DB_NAME
  if (value === undefined || !/^[a-z0-9_]*e2e[a-z0-9_]*$/i.test(value)) {
    throw new Error('Unsafe E2E database name')
  }
  return value
}

function requiredSecret(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.length < 16) {
    throw new Error(`Missing ${name}`)
  }
  return value
}

function validateRpcState(value: unknown): RpcState {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Malformed local RPC state')
  }
  const record = value as Record<string, unknown>
  const scenario = record.scenario
  if (scenario !== 'happy' && scenario !== 'receipt-pending-once') {
    throw new Error('Malformed local RPC scenario')
  }
  for (const key of [
    'chainChecks',
    'simulations',
    'broadcasts',
    'receiptReads',
    'browserReceiptReads',
    'backendReceiptReads',
  ]) {
    const counter = record[key]
    if (
      typeof counter !== 'number' ||
      !Number.isSafeInteger(counter) ||
      counter < 0
    ) {
      throw new Error('Malformed local RPC counters')
    }
  }

  const transactionHash = record.transactionHash
  if (
    transactionHash !== null &&
    (typeof transactionHash !== 'string' || !/^0x[0-9a-f]{64}$/.test(transactionHash))
  ) {
    throw new Error('Malformed local RPC transaction hash')
  }

  const lastTransfer = record.lastTransfer
  if (
    lastTransfer !== null &&
    (typeof lastTransfer !== 'object' ||
      typeof (lastTransfer as Record<string, unknown>).recipient !== 'string' ||
      typeof (lastTransfer as Record<string, unknown>).amount !== 'string')
  ) {
    throw new Error('Malformed local RPC transfer')
  }

  if (!Array.isArray(record.transfers)) {
    throw new Error('Malformed local RPC transfers')
  }
  for (const transfer of record.transfers) {
    if (
      typeof transfer !== 'object' ||
      transfer === null ||
      typeof (transfer as Record<string, unknown>).transactionHash !== 'string' ||
      !/^0x[0-9a-f]{64}$/.test(
        (transfer as Record<string, unknown>).transactionHash as string,
      ) ||
      typeof (transfer as Record<string, unknown>).recipient !== 'string' ||
      typeof (transfer as Record<string, unknown>).amount !== 'string'
    ) {
      throw new Error('Malformed local RPC transfers')
    }
  }

  return value as RpcState
}
