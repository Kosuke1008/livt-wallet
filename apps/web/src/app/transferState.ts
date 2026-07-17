import type { Hash } from 'viem'
import type { JpycTransferIntent } from '../tokens/transferValidation'

export type TransferStatus =
  | 'editing'
  | 'reviewing'
  | 'simulating'
  | 'signing'
  | 'broadcasting'
  | 'confirming'
  | 'success'
  | 'reverted'
  | 'unknown'
  | 'error'

export type UnknownConfirmationReason = 'timeout' | 'unknown'
export type TransferErrorStage = 'simulating' | 'signing' | 'broadcasting'

interface TransferStateBase {
  readonly requestGeneration: number
}

export interface EditingTransferState extends TransferStateBase {
  readonly status: 'editing'
}

interface TransferStateWithIntent extends TransferStateBase {
  readonly intent: JpycTransferIntent
}

export interface ReviewingTransferState extends TransferStateWithIntent {
  readonly status: 'reviewing'
}

export interface SimulatingTransferState extends TransferStateWithIntent {
  readonly status: 'simulating'
}

export interface SigningTransferState extends TransferStateWithIntent {
  readonly status: 'signing'
}

export interface BroadcastingTransferState extends TransferStateWithIntent {
  readonly status: 'broadcasting'
}

interface TransferStateWithHash extends TransferStateWithIntent {
  readonly transactionHash: Hash
}

export interface ConfirmingTransferState extends TransferStateWithHash {
  readonly status: 'confirming'
}

export interface SuccessfulTransferState extends TransferStateWithHash {
  readonly status: 'success'
}

export interface RevertedTransferState extends TransferStateWithHash {
  readonly status: 'reverted'
}

export interface UnknownTransferState extends TransferStateWithHash {
  readonly status: 'unknown'
  readonly reason: UnknownConfirmationReason
}

export interface FailedTransferState extends TransferStateWithIntent {
  readonly status: 'error'
  readonly failedAt: TransferErrorStage
  readonly message: string
}

export type TransferState =
  | EditingTransferState
  | ReviewingTransferState
  | SimulatingTransferState
  | SigningTransferState
  | BroadcastingTransferState
  | ConfirmingTransferState
  | SuccessfulTransferState
  | RevertedTransferState
  | UnknownTransferState
  | FailedTransferState

export type TransferAction =
  | {
      readonly type: 'review'
      readonly requestGeneration: number
      readonly intent: JpycTransferIntent
    }
  | { readonly type: 'edit'; readonly requestGeneration: number }
  | { readonly type: 'start'; readonly requestGeneration: number }
  | {
      readonly type: 'simulation-succeeded'
      readonly requestGeneration: number
    }
  | {
      readonly type: 'signing-succeeded'
      readonly requestGeneration: number
    }
  | {
      readonly type: 'broadcast-succeeded'
      readonly requestGeneration: number
      readonly transactionHash: Hash
    }
  | { readonly type: 'confirmed'; readonly requestGeneration: number }
  | { readonly type: 'reverted'; readonly requestGeneration: number }
  | {
      readonly type: 'confirmation-unknown'
      readonly requestGeneration: number
      readonly reason: UnknownConfirmationReason
    }
  | {
      readonly type: 'failed'
      readonly requestGeneration: number
      readonly message: string
    }
  | { readonly type: 'retry'; readonly requestGeneration: number }

export function createInitialTransferState(): EditingTransferState {
  return { status: 'editing', requestGeneration: 0 }
}

/**
 * Generates the monotonically increasing identifier used by transfer actions.
 * Keep the previous value in a React ref so two handlers cannot share an ID.
 */
export function nextTransferRequestGeneration(previous: number): number {
  if (!Number.isSafeInteger(previous) || previous < 0) {
    throw new RangeError('Transfer request generation must be a safe integer')
  }
  if (previous === Number.MAX_SAFE_INTEGER) {
    throw new RangeError('Transfer request generation is exhausted')
  }
  return previous + 1
}

function hasCurrentGeneration(
  state: TransferState,
  action: TransferAction,
): boolean {
  return action.requestGeneration === state.requestGeneration
}

export function transferReducer(
  state: TransferState,
  action: TransferAction,
): TransferState {
  if (action.type === 'edit') {
    if (action.requestGeneration <= state.requestGeneration) return state
    return { status: 'editing', requestGeneration: action.requestGeneration }
  }

  if (action.type === 'review') {
    if (
      state.status !== 'editing' ||
      !hasCurrentGeneration(state, action)
    ) {
      return state
    }
    return { ...state, status: 'reviewing', intent: action.intent }
  }

  if (action.type === 'start') {
    if (
      state.status !== 'reviewing' ||
      action.requestGeneration <= state.requestGeneration
    ) {
      return state
    }
    return {
      status: 'simulating',
      requestGeneration: action.requestGeneration,
      intent: state.intent,
    }
  }

  if (action.type === 'retry') {
    if (
      state.status !== 'error' ||
      action.requestGeneration <= state.requestGeneration
    ) {
      return state
    }
    return {
      status: 'reviewing',
      requestGeneration: action.requestGeneration,
      intent: state.intent,
    }
  }

  if (!hasCurrentGeneration(state, action)) return state

  switch (action.type) {
    case 'simulation-succeeded':
      return state.status === 'simulating'
        ? { ...state, status: 'signing' }
        : state
    case 'signing-succeeded':
      return state.status === 'signing'
        ? { ...state, status: 'broadcasting' }
        : state
    case 'broadcast-succeeded':
      return state.status === 'broadcasting'
        ? {
            ...state,
            status: 'confirming',
            transactionHash: action.transactionHash,
          }
        : state
    case 'confirmed':
      return state.status === 'confirming'
        ? { ...state, status: 'success' }
        : state
    case 'reverted':
      return state.status === 'confirming'
        ? { ...state, status: 'reverted' }
        : state
    case 'confirmation-unknown':
      return state.status === 'confirming'
        ? { ...state, status: 'unknown', reason: action.reason }
        : state
    case 'failed':
      return state.status === 'simulating' ||
        state.status === 'signing' ||
        state.status === 'broadcasting'
        ? {
            status: 'error',
            requestGeneration: state.requestGeneration,
            intent: state.intent,
            failedAt: state.status,
            message: action.message,
          }
        : state
  }
}
