import type { Hash } from 'viem'
import {
  executeJpycTransfer,
  type ExecuteJpycTransferOptions,
  type JpycTransferPhaseUpdate,
  type JpycTransferResult,
} from '../tokens/jpycTransfer'
import { ACTIVE_NETWORK_PROFILE } from '../blockchain/networkProfiles'
import type { JpycTransferIntent } from '../tokens/transferValidation'
import type { ExecuteFeeDelegatedJpycTransferOptions } from '../tokens/feeDelegatedJpycTransfer'
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

export type LivtFeeDelegatedTransferExecutor = (
  options: ExecuteFeeDelegatedJpycTransferOptions,
) => Promise<JpycTransferResult>

const loadFeeDelegatedTransfer: LivtFeeDelegatedTransferExecutor = async (
  options,
) => {
  const { executeFeeDelegatedJpycTransfer } = await import(
    '../tokens/feeDelegatedJpycTransfer'
  )
  return executeFeeDelegatedJpycTransfer(options)
}

export type LivtPaymentSubmissionMode = 'direct' | 'fee-delegated'

export interface ExecuteLivtPaymentOptions {
  readonly paymentId: string
  readonly intent: JpycTransferIntent
  readonly password: string
  readonly accessToken: string
  readonly apiClient: LivtPaymentApiClient
  readonly submissionMode?: LivtPaymentSubmissionMode
  readonly transferExecutor?: LivtPaymentTransferExecutor
  readonly feeDelegatedTransferExecutor?: LivtFeeDelegatedTransferExecutor
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
  submissionMode = 'direct',
  transferExecutor = executeJpycTransfer,
  feeDelegatedTransferExecutor = loadFeeDelegatedTransfer,
  onPhase,
  isCurrent,
}: ExecuteLivtPaymentOptions): Promise<LivtPaymentResult> {
  if (ACTIVE_NETWORK_PROFILE.id === 'kaia-mainnet'
    && submissionMode !== 'fee-delegated') {
    throw new Error('Mainnet direct payment execution is disabled')
  }
  // [Flow J-L] 端末内署名・一度だけのbroadcast・txHash取得を実行する。
  const transfer =
    submissionMode === 'fee-delegated'
      ? await feeDelegatedTransferExecutor({
          intent,
          password,
          onPhase,
          isCurrent,
          sponsorTransaction: (senderSignedTransaction) =>
            apiClient.sponsorPayment(
              paymentId,
              senderSignedTransaction,
              accessToken,
            ),
        })
      : await transferExecutor({
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
