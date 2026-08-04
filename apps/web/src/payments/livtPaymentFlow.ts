import type { Hash } from 'viem'
import {
  executeJpycTransfer,
  type ExecuteJpycTransferOptions,
  type JpycTransferPhaseUpdate,
  type JpycTransferResult,
} from '../tokens/jpycTransfer'
import type { JpycTransferIntent } from '../tokens/transferValidation'
import {
  LivtPaymentApiError,
  normalizeLivtTransactionHash,
  type LivtPaymentApiClient,
} from './livtPaymentApi'

export class LivtPaymentTransactionRevertedError extends Error {
  readonly name = 'LivtPaymentTransactionRevertedError'
  readonly transactionHash: Hash

  constructor(transactionHash: Hash) {
    super('The LivT payment transaction reverted')
    this.transactionHash = transactionHash
  }
}

export class LivtPaymentConfirmationError extends Error {
  readonly name = 'LivtPaymentConfirmationError'
  readonly transactionHash: Hash
  readonly apiError: LivtPaymentApiError

  constructor(transactionHash: Hash, apiError: LivtPaymentApiError) {
    super('LivT could not confirm the payment transaction', {
      cause: apiError,
    })
    this.transactionHash = transactionHash
    this.apiError = apiError
  }
}

export type LivtPaymentTransferExecutor = (
  options: ExecuteJpycTransferOptions,
) => Promise<JpycTransferResult>

export interface ExecuteLivtPaymentOptions {
  readonly paymentId: string
  readonly intent: JpycTransferIntent
  readonly password: string
  readonly accessToken: string
  readonly apiClient: LivtPaymentApiClient
  readonly transferExecutor?: LivtPaymentTransferExecutor
  readonly onPhase?: (update: JpycTransferPhaseUpdate) => void
  readonly isCurrent?: () => boolean
}

export interface LivtPaymentResult {
  readonly transactionHash: Hash
}

export async function executeLivtPayment({
  paymentId,
  intent,
  password,
  accessToken,
  apiClient,
  transferExecutor = executeJpycTransfer,
  onPhase,
  isCurrent,
}: ExecuteLivtPaymentOptions): Promise<LivtPaymentResult> {
  // [Flow J-L] 端末内署名・一度だけのbroadcast・txHash取得を実行する。
  const transfer = await transferExecutor({
    intent,
    password,
    onPhase,
    isCurrent,
  })
  const transactionHash = normalizeLivtTransactionHash(
    transfer.transactionHash,
  )

  if (transfer.status === 'reverted') {
    throw new LivtPaymentTransactionRevertedError(transactionHash)
  }

  try {
    // [Flow M] Wallet側の成功を確定扱いせずbackend verifierへ委ねる。
    await apiClient.confirmPayment(paymentId, transactionHash, accessToken)
  } catch (error) {
    if (error instanceof LivtPaymentApiError) {
      throw new LivtPaymentConfirmationError(transactionHash, error)
    }
    throw error
  }

  return Object.freeze({ transactionHash })
}
