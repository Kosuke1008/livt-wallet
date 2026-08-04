import {
  encodeFunctionData,
  isHash,
  keccak256,
  maxUint256,
  WaitForTransactionReceiptTimeoutError,
  type Address,
  type Hash,
  type LocalAccount,
} from 'viem'
import { KAIROS_NETWORK } from '../blockchain/kairos'
import { verifyKairosChain } from '../blockchain/kairosChainVerification'
import {
  isKairosRpcTransportError,
  toKairosRpcError,
} from '../blockchain/kairosRpcError'
import {
  type WalletStorage,
} from '../wallet/encryptedWallet'
import { withStoredSigningAccount } from '../wallet/signingAccount'
import { erc20TransferAbi } from './erc20Abi'
import {
  kairosJpycTransferRpcClient,
  type JpycTransferRpcClient,
} from './jpycTransferClient'
import { validateErc20Token } from './tokenMetadata'
import { resolveApprovedToken } from './tokenRegistry'
import {
  InvalidTransferAmountError,
  validateTransferRecipient,
  type JpycTransferIntent,
} from './transferValidation'

export type JpycTransferPhase =
  | 'simulating'
  | 'signing'
  | 'broadcasting'
  | 'confirming'

export interface JpycTransferPhaseUpdate {
  readonly phase: JpycTransferPhase
  readonly estimatedGas?: bigint
  readonly transactionHash?: Hash
}

export interface JpycTransferResult {
  readonly status: 'success' | 'reverted'
  readonly transactionHash: Hash
  readonly sender: Address
  readonly recipient: Address
  readonly enteredAmount: string
  readonly normalizedAmount: string
  readonly estimatedGas: bigint
  readonly gasPrice: bigint
}

export class InsufficientKairosGasError extends Error {
  readonly name = 'InsufficientKairosGasError'

  constructor() {
    super('The wallet does not have enough KAIA to pay the estimated gas fee')
  }
}

export class JpycTransferSimulationError extends Error {
  readonly name = 'JpycTransferSimulationError'

  constructor(options?: ErrorOptions) {
    super('JPYC transfer simulation failed', options)
  }
}

export class JpycTransferSigningError extends Error {
  readonly name = 'JpycTransferSigningError'

  constructor(options?: ErrorOptions) {
    super('JPYC transfer could not be signed locally', options)
  }
}

export class StaleTransferRequestError extends Error {
  readonly name = 'StaleTransferRequestError'

  constructor() {
    super('The transfer request is no longer current')
  }
}

export class JpycTransferBroadcastError extends Error {
  readonly name = 'JpycTransferBroadcastError'
  readonly transactionHash: Hash

  constructor(transactionHash: Hash, options?: ErrorOptions) {
    super('JPYC transfer broadcast was rejected', options)
    this.transactionHash = transactionHash
  }
}

export class JpycTransferBroadcastUnknownError extends Error {
  readonly name = 'JpycTransferBroadcastUnknownError'
  readonly transactionHash: Hash

  constructor(transactionHash: Hash, options?: ErrorOptions) {
    super('JPYC transfer may have been broadcast but could not be confirmed', options)
    this.transactionHash = transactionHash
  }
}

export class TransferConfirmationTimeoutError extends Error {
  readonly name = 'TransferConfirmationTimeoutError'
  readonly transactionHash: Hash

  constructor(transactionHash: Hash, options?: ErrorOptions) {
    super('Transaction confirmation timed out', options)
    this.transactionHash = transactionHash
  }
}

export class TransferConfirmationUnknownError extends Error {
  readonly name = 'TransferConfirmationUnknownError'
  readonly transactionHash: Hash

  constructor(transactionHash: Hash, options?: ErrorOptions) {
    super('Transaction confirmation state is unknown', options)
    this.transactionHash = transactionHash
  }
}

export interface SigningAccountProvider {
  withAccount<Result>(
    password: string,
    expectedAddress: Address,
    operation: (account: LocalAccount) => Promise<Result>,
    storage?: WalletStorage,
  ): Promise<Result>
}

const storedSigningAccountProvider: SigningAccountProvider = {
  withAccount: withStoredSigningAccount,
}

export interface ExecuteJpycTransferOptions {
  readonly intent: JpycTransferIntent
  readonly password: string
  readonly onPhase?: (update: JpycTransferPhaseUpdate) => void
  readonly storage?: WalletStorage
  readonly rpcClient?: JpycTransferRpcClient
  readonly signingAccountProvider?: SigningAccountProvider
  readonly isCurrent?: () => boolean
}

export async function executeJpycTransfer({
  intent,
  password,
  onPhase,
  storage,
  rpcClient = kairosJpycTransferRpcClient,
  signingAccountProvider = storedSigningAccountProvider,
  isCurrent = () => true,
}: ExecuteJpycTransferOptions): Promise<JpycTransferResult> {
  const assertCurrent = () => {
    if (!isCurrent()) throw new StaleTransferRequestError()
  }

  // 1. 承認済みJPYCを解決し、実行直前にも宛先と数量を再検査する
  assertCurrent()
  const token = resolveApprovedToken(intent.tokenId)
  const recipient = validateTransferRecipient(
    intent.recipient,
    intent.sender,
    token,
  )
  if (intent.rawAmount <= 0n) throw new InvalidTransferAmountError('zero')
  if (intent.rawAmount > maxUint256) {
    throw new InvalidTransferAmountError('uint256-overflow')
  }

  // 2. RPCのchain IDがKaia Kairosの1001であることを確認する
  onPhase?.({ phase: 'simulating' })
  await verifyKairosChain(rpcClient)
  assertCurrent()
  // 3. 契約コード、symbol、decimalsが承認済みJPYCの設定と一致するか確認する
  await validateErc20Token(token, rpcClient)
  assertCurrent()

  // 4. 送金手数料に使うKAIA残高があるか確認する
  const nativeBalance = await callBeforeBroadcast(() =>
    rpcClient.getNativeBalance(intent.sender),
  )
  if (nativeBalance === 0n) throw new InsufficientKairosGasError()
  assertCurrent()

  let simulationResult: unknown
  let estimatedGas: bigint
  try {
    // 5. JPYC送金を事前実行し、必要なガス量も見積もる
    simulationResult = await rpcClient.simulateTransfer({
      contractAddress: token.contractAddress,
      sender: intent.sender,
      recipient,
      amount: intent.rawAmount,
    })
    estimatedGas = await rpcClient.estimateTransferGas({
      contractAddress: token.contractAddress,
      sender: intent.sender,
      recipient,
      amount: intent.rawAmount,
    })
  } catch (error) {
    if (isKairosRpcTransportError(error)) throw toKairosRpcError(error)
    throw new JpycTransferSimulationError({ cause: error })
  }
  if (simulationResult !== true || estimatedGas <= 0n) {
    throw new JpycTransferSimulationError()
  }
  assertCurrent()
  onPhase?.({ phase: 'simulating', estimatedGas })

  // 6. ガス単価とnonceを取得し、見積手数料をKAIA残高で支払えるか確認する
  const [gasPrice, nonce] = await Promise.all([
    callBeforeBroadcast(() => rpcClient.getGasPrice()),
    callBeforeBroadcast(() => rpcClient.getPendingNonce(intent.sender)),
  ])
  if (gasPrice <= 0n || estimatedGas * gasPrice > nativeBalance) {
    throw new InsufficientKairosGasError()
  }
  assertCurrent()

  // 7. 承認済みJPYCのtransfer呼び出しを取引データへ変換する
  const data = encodeFunctionData({
    abi: erc20TransferAbi,
    functionName: 'transfer',
    args: [recipient, intent.rawAmount],
  })

  onPhase?.({ phase: 'signing', estimatedGas })
  // 8. [Flow J] 署名が必要な間だけ口座を復元し、解除中の住所との一致も確認する
  const transactionHash = await signingAccountProvider.withAccount(
    password,
    intent.sender,
    async (account) => {
      assertCurrent()
      let serializedTransaction
      try {
        // 9. [Flow J] 秘密情報を送らず、端末内で取引へ署名する
        serializedTransaction = await account.signTransaction({
          chainId: KAIROS_NETWORK.chainId,
          data,
          gas: estimatedGas,
          gasPrice,
          nonce,
          to: token.contractAddress,
          type: 'legacy',
          value: 0n,
        })
      } catch (error) {
        throw new JpycTransferSigningError({ cause: error })
      }
      assertCurrent()
      const expectedTransactionHash = keccak256(serializedTransaction)
      // [Flow L] 送信結果が不明でも追跡できるtxHashを署名済みデータから算出する。
      onPhase?.({
        phase: 'broadcasting',
        estimatedGas,
        transactionHash: expectedTransactionHash,
      })
      assertCurrent()
      try {
        // 10. [Flow K] 署名済み取引を一度だけ送り、結果不明でも自動再送しない
        const returnedTransactionHash = await rpcClient.sendRawTransaction(
          serializedTransaction,
        )
        if (
          !isHash(returnedTransactionHash) ||
          returnedTransactionHash !== expectedTransactionHash
        ) {
          throw new JpycTransferBroadcastUnknownError(expectedTransactionHash)
        }
        return returnedTransactionHash
      } catch (error) {
        if (error instanceof JpycTransferBroadcastUnknownError) throw error
        if (isKairosRpcTransportError(error)) {
          throw new JpycTransferBroadcastUnknownError(
            expectedTransactionHash,
            { cause: error },
          )
        }
        throw new JpycTransferBroadcastError(expectedTransactionHash, {
          cause: error,
        })
      }
    },
    storage,
  )

  onPhase?.({
    phase: 'confirming',
    estimatedGas,
    transactionHash,
  })
  assertCurrent()

  // 11. receiptを待ち、時間切れと確認不能を別の状態として扱う
  let receipt
  try {
    receipt = await rpcClient.waitForReceipt(transactionHash)
  } catch (error) {
    if (error instanceof WaitForTransactionReceiptTimeoutError) {
      throw new TransferConfirmationTimeoutError(transactionHash, {
        cause: error,
      })
    }
    throw new TransferConfirmationUnknownError(transactionHash, {
      cause: error,
    })
  }
  if (receipt.transactionHash !== transactionHash) {
    throw new TransferConfirmationUnknownError(transactionHash)
  }

  // 12. receiptの状態を成功または取り消しとして画面側へ返す
  return {
    status: receipt.status,
    transactionHash,
    sender: intent.sender,
    recipient,
    enteredAmount: intent.enteredAmount,
    normalizedAmount: intent.normalizedAmount,
    estimatedGas,
    gasPrice,
  }
}

async function callBeforeBroadcast<Result>(
  operation: () => Promise<Result>,
): Promise<Result> {
  try {
    return await operation()
  } catch (error) {
    throw toKairosRpcError(error)
  }
}
