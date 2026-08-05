import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  TxType,
  decodeFunctionData,
  parseTransaction,
} from '@kaiachain/viem-ext'
import type { Address, Hash, Hex, LocalAccount } from 'viem'
import { RpcChainMismatchError } from '../../../src/blockchain/kairosChainVerification'
import {
  encryptMnemonic,
  IncorrectPasswordError,
  saveEncryptedWallet,
  type EncryptedWallet,
  type WalletStorage,
} from '../../../src/wallet/encryptedWallet'
import { withStoredSigningAccount } from '../../../src/wallet/signingAccount'
import {
  executeFeeDelegatedJpycTransfer,
  InvalidSponsoredTransactionHashError,
} from '../../../src/tokens/feeDelegatedJpycTransfer'
import type { SigningAccountProvider } from '../../../src/tokens/jpycTransfer'
import type { JpycTransferRpcClient } from '../../../src/tokens/jpycTransferClient'
import { erc20TransferAbi } from '../../../src/tokens/erc20Abi'
import { approvedJpycToken } from '../../../src/tokens/tokenRegistry'
import { createJpycTransferIntent } from '../../../src/tokens/transferValidation'

const testMnemonic =
  'test test test test test test test test test test test junk'
const testPassword = 'integration-test-password'
const sender = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const recipient = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const tokenBalance = 10_000_000_000_000_000_000n
const estimatedGas = 60_000n
const feeDelegationIntrinsicGas = 10_000n
const gasPrice = 25_000_000_000n
const finalTransactionHash = `0x${'a'.repeat(64)}` as Hash

class MemoryStorage implements WalletStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
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

function createIntent() {
  return createJpycTransferIntent({
    tokenId: 'jpyc',
    senderAddress: sender,
    recipientInput: recipient,
    amountInput: '1.25',
    availableBalance: tokenBalance,
    decimals: 18,
  })
}

function createRpcClient(
  overrides: Partial<JpycTransferRpcClient> = {},
): JpycTransferRpcClient {
  return {
    getChainId: vi.fn().mockResolvedValue(1001),
    getBytecode: vi.fn().mockResolvedValue('0x6000'),
    readSymbol: vi.fn().mockResolvedValue('JPYC'),
    readDecimals: vi.fn().mockResolvedValue(18),
    readBalance: vi.fn().mockResolvedValue(tokenBalance),
    getNativeBalance: vi.fn().mockResolvedValue(0n),
    simulateTransfer: vi.fn().mockResolvedValue(true),
    estimateTransferGas: vi.fn().mockResolvedValue(estimatedGas),
    getGasPrice: vi.fn().mockResolvedValue(gasPrice),
    getPendingNonce: vi.fn().mockResolvedValue(7),
    sendRawTransaction: vi.fn(),
    waitForReceipt: vi.fn(),
    ...overrides,
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

describe('Kairos JPYC fee-delegated transfer integration', () => {
  it('FeeDelegatedSmartContractExecutionを端末内署名してsponsorへ一度だけ渡す', async () => {
    const rpcClient = createRpcClient()
    let senderSignedTransaction: Hex | undefined
    const sponsorTransaction = vi.fn(async (serialized: Hex) => {
      senderSignedTransaction = serialized
      return finalTransactionHash
    })
    const phases: Array<{
      readonly phase: string
      readonly transactionHash?: Hash
    }> = []

    const result = await executeFeeDelegatedJpycTransfer({
      intent: createIntent(),
      password: testPassword,
      storage: createStorage(),
      rpcClient,
      sponsorTransaction,
      onPhase: (update) => phases.push(update),
    })

    expect(result).toMatchObject({
      status: 'success',
      transactionHash: finalTransactionHash,
      sender,
      recipient,
      estimatedGas,
      gasPrice,
    })
    expect(sponsorTransaction).toHaveBeenCalledOnce()
    expect(senderSignedTransaction).toBeDefined()
    if (senderSignedTransaction === undefined) {
      throw new Error('Expected a sender-signed transaction')
    }

    const parsed = parseTransaction(senderSignedTransaction)
    expect(parsed).toMatchObject({
      type: TxType.FeeDelegatedSmartContractExecution,
      nonce: 7,
      gasLimit: `0x${(
        estimatedGas + feeDelegationIntrinsicGas
      ).toString(16)}`,
      gasPrice: `0x${gasPrice.toString(16)}`,
      from: sender,
    })
    expect(parsed.to?.toLowerCase()).toBe(
      approvedJpycToken.contractAddress.toLowerCase(),
    )
    expect(parsed.value).toBe('0x0')
    expect(parsed.txSignatures).toHaveLength(1)
    expect([
      BigInt(1001 * 2 + 35),
      BigInt(1001 * 2 + 36),
    ]).toContain(BigInt(parsed.txSignatures[0][0]))
    expect(parsed.feePayer).toBeUndefined()
    expect(parsed.feePayerSignatures).toBeUndefined()

    const transferCall = decodeFunctionData({
      abi: erc20TransferAbi,
      data: parsed.data as Hex,
    })
    expect(transferCall.functionName).toBe('transfer')
    expect(transferCall.args?.[0]).toBe(recipient)
    expect(transferCall.args?.[1]).toBe(1_250_000_000_000_000_000n)

    expect(rpcClient.getNativeBalance).not.toHaveBeenCalled()
    expect(rpcClient.sendRawTransaction).not.toHaveBeenCalled()
    expect(rpcClient.waitForReceipt).not.toHaveBeenCalled()
    expect(phases.find((phase) => phase.phase === 'broadcasting')).not
      .toHaveProperty('transactionHash')
    expect(phases.at(-1)).toEqual({
      phase: 'confirming',
      estimatedGas,
      transactionHash: finalTransactionHash,
    })
  })

  it('chain ID不一致では署名もsponsor呼び出しも行わない', async () => {
    const rpcClient = createRpcClient({
      getChainId: vi.fn().mockResolvedValue(8217),
    })
    const signing = createTrackedSigningProvider()
    const sponsorTransaction = vi.fn()

    await expect(
      executeFeeDelegatedJpycTransfer({
        intent: createIntent(),
        password: testPassword,
        storage: createStorage(),
        rpcClient,
        signingAccountProvider: signing.provider,
        sponsorTransaction,
      }),
    ).rejects.toBeInstanceOf(RpcChainMismatchError)

    expect(signing.operation).not.toHaveBeenCalled()
    expect(sponsorTransaction).not.toHaveBeenCalled()
  })

  it('Wallet password不一致ではsponsor呼び出しを行わない', async () => {
    const sponsorTransaction = vi.fn()

    await expect(
      executeFeeDelegatedJpycTransfer({
        intent: createIntent(),
        password: 'wrong-password',
        storage: createStorage(),
        rpcClient: createRpcClient(),
        sponsorTransaction,
      }),
    ).rejects.toBeInstanceOf(IncorrectPasswordError)

    expect(sponsorTransaction).not.toHaveBeenCalled()
  })

  it('sponsorが不正なfinal txHashを返した場合は成功扱いにしない', async () => {
    await expect(
      executeFeeDelegatedJpycTransfer({
        intent: createIntent(),
        password: testPassword,
        storage: createStorage(),
        rpcClient: createRpcClient(),
        sponsorTransaction: vi
          .fn()
          .mockResolvedValue('0x1234' as Hash),
      }),
    ).rejects.toBeInstanceOf(InvalidSponsoredTransactionHashError)
  })
})
