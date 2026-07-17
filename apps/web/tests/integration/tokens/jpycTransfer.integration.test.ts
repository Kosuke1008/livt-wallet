import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  HttpRequestError,
  WaitForTransactionReceiptTimeoutError,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  type Address,
  type Hash,
  type Hex,
  type LocalAccount,
  type TransactionSerialized,
} from 'viem'
import { RpcChainMismatchError } from '../../../src/blockchain/kairosChainVerification'
import { KairosRpcError } from '../../../src/blockchain/kairosRpcError'
import {
  encryptMnemonic,
  IncorrectPasswordError,
  saveEncryptedWallet,
  type EncryptedWallet,
  type WalletStorage,
} from '../../../src/wallet/encryptedWallet'
import {
  SigningAccountMismatchError,
  withStoredSigningAccount,
} from '../../../src/wallet/signingAccount'
import {
  executeJpycTransfer,
  JpycTransferBroadcastError,
  JpycTransferBroadcastUnknownError,
  JpycTransferSimulationError,
  StaleTransferRequestError,
  TransferConfirmationTimeoutError,
  TransferConfirmationUnknownError,
  type SigningAccountProvider,
} from '../../../src/tokens/jpycTransfer'
import type { JpycTransferRpcClient } from '../../../src/tokens/jpycTransferClient'
import { approvedJpycToken } from '../../../src/tokens/tokenRegistry'
import { createJpycTransferIntent } from '../../../src/tokens/transferValidation'

const testMnemonic =
  'test test test test test test test test test test test junk'
const testPassword = 'integration-test-password'
const sender = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const recipient = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const otherSender = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const tokenBalance = 10_000_000_000_000_000_000n
const nativeBalance = 1_000_000_000_000_000_000n
const estimatedGas = 60_000n
const gasPrice = 25_000_000_000n

class MemoryStorage implements WalletStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

interface RpcSpies {
  readonly getChainId: ReturnType<typeof vi.fn>
  readonly simulateTransfer: ReturnType<typeof vi.fn>
  readonly sendRawTransaction: ReturnType<typeof vi.fn>
  readonly waitForReceipt: ReturnType<typeof vi.fn>
}

let encryptedWallet: EncryptedWallet

beforeAll(async () => {
  encryptedWallet = await encryptMnemonic(testMnemonic, testPassword)
})

function createStorage(): MemoryStorage {
  const storage = new MemoryStorage()
  saveEncryptedWallet(encryptedWallet, storage)
  return storage
}

function createIntent(senderAddress: Address = sender) {
  return createJpycTransferIntent({
    tokenId: 'jpyc',
    senderAddress,
    recipientInput: recipient,
    amountInput: '1.25',
    availableBalance: tokenBalance,
    decimals: 18,
  })
}

function createRpcClient(
  overrides: Partial<JpycTransferRpcClient> = {},
): { readonly client: JpycTransferRpcClient; readonly spies: RpcSpies } {
  const getChainId = vi.fn().mockResolvedValue(1001)
  const simulateTransfer = vi.fn().mockResolvedValue(true)
  const sendRawTransaction = vi.fn(async (serializedTransaction: Hex) =>
    keccak256(serializedTransaction),
  )
  const waitForReceipt = vi.fn(async (transactionHash: Hash) => ({
    transactionHash,
    status: 'success' as const,
  }))

  const client: JpycTransferRpcClient = {
    getChainId,
    getBytecode: vi.fn().mockResolvedValue('0x6000'),
    readSymbol: vi.fn().mockResolvedValue('JPYC'),
    readDecimals: vi.fn().mockResolvedValue(18),
    readBalance: vi.fn().mockResolvedValue(tokenBalance),
    getNativeBalance: vi.fn().mockResolvedValue(nativeBalance),
    simulateTransfer,
    estimateTransferGas: vi.fn().mockResolvedValue(estimatedGas),
    getGasPrice: vi.fn().mockResolvedValue(gasPrice),
    getPendingNonce: vi.fn().mockResolvedValue(7),
    sendRawTransaction,
    waitForReceipt,
    ...overrides,
  }

  return {
    client,
    spies: {
      getChainId: client.getChainId as ReturnType<typeof vi.fn>,
      simulateTransfer: client.simulateTransfer as ReturnType<typeof vi.fn>,
      sendRawTransaction:
        client.sendRawTransaction as ReturnType<typeof vi.fn>,
      waitForReceipt: client.waitForReceipt as ReturnType<typeof vi.fn>,
    },
  }
}

function createTrackedSigningProvider(): {
  readonly provider: SigningAccountProvider
  readonly operation: ReturnType<typeof vi.fn>
} {
  const operation = vi.fn()
  const provider: SigningAccountProvider = {
    async withAccount<Result>(
      password: string,
      expectedAddress: Address,
      signingOperation: (account: LocalAccount) => Promise<Result>,
      storage?: WalletStorage,
    ): Promise<Result> {
      return withStoredSigningAccount(
        password,
        expectedAddress,
        async (account) => {
          operation()
          return signingOperation(account)
        },
        storage,
      )
    },
  }
  return { provider, operation }
}

describe('manual Kairos JPYC transfer integration', () => {
  it('Kairos向けlegacy取引をlocal署名しeth_sendRawTransactionを一度だけ呼ぶ', async () => {
    let signedTransaction: Hex | undefined
    const { client, spies } = createRpcClient({
      sendRawTransaction: vi.fn(async (serializedTransaction: Hex) => {
        signedTransaction = serializedTransaction
        return keccak256(serializedTransaction)
      }),
    })
    const result = await executeJpycTransfer({
      intent: createIntent(),
      password: testPassword,
      storage: createStorage(),
      rpcClient: client,
    })

    expect(result.status).toBe('success')
    expect(signedTransaction).toBeDefined()
    if (signedTransaction === undefined) throw new Error('Expected signed tx')
    const parsed = parseTransaction(signedTransaction)
    expect(parsed).toMatchObject({
      type: 'legacy',
      chainId: 1001,
      nonce: 7,
      gas: estimatedGas,
      gasPrice,
    })
    expect(parsed.to?.toLowerCase()).toBe(
      approvedJpycToken.contractAddress.toLowerCase(),
    )
    expect(parsed.value ?? 0n).toBe(0n)
    await expect(
      recoverTransactionAddress({
        serializedTransaction: signedTransaction as TransactionSerialized,
      }),
    ).resolves.toBe(sender)
    expect(spies.sendRawTransaction).toHaveBeenCalledOnce()
    expect(spies.waitForReceipt).toHaveBeenCalledOnce()
  })

  it('chain ID 1001以外ではsimulation、signing、broadcastを行わない', async () => {
    const { client, spies } = createRpcClient({
      getChainId: vi.fn().mockResolvedValue(8217),
    })
    const signing = createTrackedSigningProvider()

    await expect(
      executeJpycTransfer({
        intent: createIntent(),
        password: testPassword,
        storage: createStorage(),
        rpcClient: client,
        signingAccountProvider: signing.provider,
      }),
    ).rejects.toBeInstanceOf(RpcChainMismatchError)
    expect(spies.simulateTransfer).not.toHaveBeenCalled()
    expect(signing.operation).not.toHaveBeenCalled()
    expect(spies.sendRawTransaction).not.toHaveBeenCalled()
  })

  it('誤ったpasswordでは署名もbroadcastも行わない', async () => {
    const { client, spies } = createRpcClient()
    const signing = createTrackedSigningProvider()

    await expect(
      executeJpycTransfer({
        intent: createIntent(),
        password: 'wrong-password',
        storage: createStorage(),
        rpcClient: client,
        signingAccountProvider: signing.provider,
      }),
    ).rejects.toBeInstanceOf(IncorrectPasswordError)
    expect(signing.operation).not.toHaveBeenCalled()
    expect(spies.sendRawTransaction).not.toHaveBeenCalled()
  })

  it('保存addressとderived signerが一致しなければbroadcastしない', async () => {
    const { client, spies } = createRpcClient()
    const signing = createTrackedSigningProvider()

    await expect(
      executeJpycTransfer({
        intent: createIntent(otherSender),
        password: testPassword,
        storage: createStorage(),
        rpcClient: client,
        signingAccountProvider: signing.provider,
      }),
    ).rejects.toBeInstanceOf(SigningAccountMismatchError)
    expect(signing.operation).not.toHaveBeenCalled()
    expect(spies.sendRawTransaction).not.toHaveBeenCalled()
  })

  it('receipt成功まではtransfer成功を返さない', async () => {
    let resolveReceipt:
      | ((receipt: { transactionHash: Hash; status: 'success' }) => void)
      | undefined
    const receiptPromise = new Promise<{
      transactionHash: Hash
      status: 'success'
    }>((resolve) => {
      resolveReceipt = resolve
    })
    const { client, spies } = createRpcClient({
      waitForReceipt: vi.fn(() => receiptPromise),
    })
    let settled = false
    const execution = executeJpycTransfer({
      intent: createIntent(),
      password: testPassword,
      storage: createStorage(),
      rpcClient: client,
    }).finally(() => {
      settled = true
    })

    await vi.waitFor(() => expect(spies.sendRawTransaction).toHaveBeenCalledOnce())
    expect(settled).toBe(false)
    const hash = spies.sendRawTransaction.mock.results[0]?.value
    const transactionHash = await hash
    resolveReceipt?.({ transactionHash, status: 'success' })
    await expect(execution).resolves.toMatchObject({ status: 'success' })
  })

  it('reverted receiptを成功扱いにせずhashを維持する', async () => {
    const { client, spies } = createRpcClient({
      waitForReceipt: vi.fn(async (transactionHash: Hash) => ({
        transactionHash,
        status: 'reverted' as const,
      })),
    })

    await expect(
      executeJpycTransfer({
        intent: createIntent(),
        password: testPassword,
        storage: createStorage(),
        rpcClient: client,
      }),
    ).resolves.toMatchObject({ status: 'reverted' })
    expect(spies.sendRawTransaction).toHaveBeenCalledOnce()
  })

  it('receipt timeoutを確定不明として扱い自動再送しない', async () => {
    const timeoutHash = `0x${'1'.repeat(64)}` as Hash
    const { client, spies } = createRpcClient({
      waitForReceipt: vi.fn().mockRejectedValue(
        new WaitForTransactionReceiptTimeoutError({ hash: timeoutHash }),
      ),
    })

    await expect(
      executeJpycTransfer({
        intent: createIntent(),
        password: testPassword,
        storage: createStorage(),
        rpcClient: client,
      }),
    ).rejects.toBeInstanceOf(TransferConfirmationTimeoutError)
    expect(spies.sendRawTransaction).toHaveBeenCalledOnce()
    expect(spies.waitForReceipt).toHaveBeenCalledOnce()
  })

  it('receipt通信障害を確認不能として扱い自動再送しない', async () => {
    const { client, spies } = createRpcClient({
      waitForReceipt: vi.fn().mockRejectedValue(new Error('offline')),
    })

    await expect(
      executeJpycTransfer({
        intent: createIntent(),
        password: testPassword,
        storage: createStorage(),
        rpcClient: client,
      }),
    ).rejects.toBeInstanceOf(TransferConfirmationUnknownError)
    expect(spies.sendRawTransaction).toHaveBeenCalledOnce()
    expect(spies.waitForReceipt).toHaveBeenCalledOnce()
  })

  it('simulation revertを制御されたerrorへ変換しbroadcastしない', async () => {
    const { client, spies } = createRpcClient({
      simulateTransfer: vi.fn().mockRejectedValue(new Error('execution reverted')),
    })

    await expect(
      executeJpycTransfer({
        intent: createIntent(),
        password: testPassword,
        storage: createStorage(),
        rpcClient: client,
      }),
    ).rejects.toBeInstanceOf(JpycTransferSimulationError)
    expect(spies.sendRawTransaction).not.toHaveBeenCalled()
  })

  it('送信拒否の生errorを制御されたbroadcast errorへ変換する', async () => {
    const { client, spies } = createRpcClient({
      sendRawTransaction: vi.fn().mockRejectedValue(new Error('rejected')),
    })

    await expect(
      executeJpycTransfer({
        intent: createIntent(),
        password: testPassword,
        storage: createStorage(),
        rpcClient: client,
      }),
    ).rejects.toBeInstanceOf(JpycTransferBroadcastError)
    expect(spies.sendRawTransaction).toHaveBeenCalledOnce()
  })

  it('送信中のtransport切断を確認不能として扱い自動再送しない', async () => {
    const { client, spies } = createRpcClient({
      sendRawTransaction: vi.fn().mockRejectedValue(
        new HttpRequestError({
          body: undefined,
          details: 'connection lost',
          headers: undefined,
          url: 'https://example.invalid',
        }),
      ),
    })

    await expect(
      executeJpycTransfer({
        intent: createIntent(),
        password: testPassword,
        storage: createStorage(),
        rpcClient: client,
      }),
    ).rejects.toBeInstanceOf(JpycTransferBroadcastUnknownError)
    expect(spies.sendRawTransaction).toHaveBeenCalledOnce()
    expect(spies.waitForReceipt).not.toHaveBeenCalled()
  })

  it('署名後でもrequestが古くなればbroadcast直前に停止する', async () => {
    const { client, spies } = createRpcClient()
    let current = true

    await expect(
      executeJpycTransfer({
        intent: createIntent(),
        password: testPassword,
        storage: createStorage(),
        rpcClient: client,
        isCurrent: () => current,
        onPhase: ({ phase }) => {
          if (phase === 'broadcasting') current = false
        },
      }),
    ).rejects.toBeInstanceOf(StaleTransferRequestError)
    expect(spies.sendRawTransaction).not.toHaveBeenCalled()
    expect(spies.waitForReceipt).not.toHaveBeenCalled()
  })

  it('chain RPC transport errorをKairosRpcErrorへ変換する', async () => {
    const { client, spies } = createRpcClient({
      getChainId: vi.fn().mockRejectedValue(
        new HttpRequestError({
          body: undefined,
          details: 'offline',
          headers: undefined,
          url: 'https://example.invalid',
        }),
      ),
    })

    await expect(
      executeJpycTransfer({
        intent: createIntent(),
        password: testPassword,
        storage: createStorage(),
        rpcClient: client,
      }),
    ).rejects.toBeInstanceOf(KairosRpcError)
    expect(spies.sendRawTransaction).not.toHaveBeenCalled()
  })
})
