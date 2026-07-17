import { getAddress, type Hash } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  createInitialTransferState,
  nextTransferRequestGeneration,
  transferReducer,
  type TransferState,
} from '../../../src/app/transferState'
import type { JpycTransferIntent } from '../../../src/tokens/transferValidation'
import { approvedJpycToken } from '../../../src/tokens/tokenRegistry'

const transactionHash = `0x${'ab'.repeat(32)}` as Hash

const intent: JpycTransferIntent = {
  tokenId: 'jpyc',
  token: approvedJpycToken,
  sender: getAddress('0x1111111111111111111111111111111111111111'),
  recipient: getAddress('0x2222222222222222222222222222222222222222'),
  enteredAmount: '1.25',
  normalizedAmount: '1.25',
  rawAmount: 1_250_000_000_000_000_000n,
  decimals: 18,
}

function reviewingState(requestGeneration = 0): TransferState {
  return transferReducer(createInitialTransferState(), {
    type: 'review',
    requestGeneration,
    intent,
  })
}

function confirmingState(requestGeneration = 1): TransferState {
  let state = reviewingState()
  state = transferReducer(state, { type: 'start', requestGeneration })
  state = transferReducer(state, {
    type: 'simulation-succeeded',
    requestGeneration,
  })
  state = transferReducer(state, {
    type: 'signing-succeeded',
    requestGeneration,
  })
  return transferReducer(state, {
    type: 'broadcast-succeeded',
    requestGeneration,
    transactionHash,
  })
}

describe('transferReducer', () => {
  it('編集状態から確認状態を経なければ送信を開始しない', () => {
    const editing = createInitialTransferState()
    const result = transferReducer(editing, {
      type: 'start',
      requestGeneration: 1,
    })

    expect(result).toBe(editing)
    expect(result.status).toBe('editing')
  })

  it('確認済みの送金内容で一度だけ送信処理を開始する', () => {
    const reviewing = reviewingState()
    const simulating = transferReducer(reviewing, {
      type: 'start',
      requestGeneration: 1,
    })
    const duplicate = transferReducer(simulating, {
      type: 'start',
      requestGeneration: 2,
    })

    expect(simulating).toEqual({
      status: 'simulating',
      requestGeneration: 1,
      intent,
    })
    expect(duplicate).toBe(simulating)
  })

  it('模擬実行、署名、送信、確認を順番どおりに進める', () => {
    let state = reviewingState()
    state = transferReducer(state, { type: 'start', requestGeneration: 1 })
    expect(state.status).toBe('simulating')

    state = transferReducer(state, {
      type: 'simulation-succeeded',
      requestGeneration: 1,
    })
    expect(state.status).toBe('signing')

    state = transferReducer(state, {
      type: 'signing-succeeded',
      requestGeneration: 1,
    })
    expect(state.status).toBe('broadcasting')

    state = transferReducer(state, {
      type: 'broadcast-succeeded',
      requestGeneration: 1,
      transactionHash,
    })
    expect(state).toMatchObject({ status: 'confirming', transactionHash })

    state = transferReducer(state, {
      type: 'confirmed',
      requestGeneration: 1,
    })
    expect(state).toMatchObject({ status: 'success', transactionHash })
    expect('message' in state).toBe(false)
  })

  it('順番を飛ばした完了通知を無視する', () => {
    const simulating = transferReducer(reviewingState(), {
      type: 'start',
      requestGeneration: 1,
    })
    const result = transferReducer(simulating, {
      type: 'broadcast-succeeded',
      requestGeneration: 1,
      transactionHash,
    })

    expect(result).toBe(simulating)
  })

  it('編集へ戻ると処理世代を進めて以前の非同期完了を無視する', () => {
    const simulating = transferReducer(reviewingState(), {
      type: 'start',
      requestGeneration: 1,
    })
    const editing = transferReducer(simulating, {
      type: 'edit',
      requestGeneration: 2,
    })
    const staleCompletion = transferReducer(editing, {
      type: 'simulation-succeeded',
      requestGeneration: 1,
    })

    expect(editing).toEqual({ status: 'editing', requestGeneration: 2 })
    expect(staleCompletion).toBe(editing)
  })

  it('別の処理世代から届いた完了通知を無視する', () => {
    const simulating = transferReducer(reviewingState(), {
      type: 'start',
      requestGeneration: 4,
    })
    const result = transferReducer(simulating, {
      type: 'simulation-succeeded',
      requestGeneration: 3,
    })

    expect(result).toBe(simulating)
  })

  it('処理の失敗箇所と確認済み内容を保持して確認画面へ戻せる', () => {
    const signing = transferReducer(
      transferReducer(reviewingState(), {
        type: 'start',
        requestGeneration: 1,
      }),
      { type: 'simulation-succeeded', requestGeneration: 1 },
    )
    const failed = transferReducer(signing, {
      type: 'failed',
      requestGeneration: 1,
      message: '署名できませんでした',
    })
    const reviewing = transferReducer(failed, {
      type: 'retry',
      requestGeneration: 2,
    })

    expect(failed).toEqual({
      status: 'error',
      requestGeneration: 1,
      intent,
      failedAt: 'signing',
      message: '署名できませんでした',
    })
    expect(reviewing).toEqual({
      status: 'reviewing',
      requestGeneration: 2,
      intent,
    })
  })

  it('取り消された取引をハッシュ付きで表す', () => {
    const reverted = transferReducer(confirmingState(), {
      type: 'reverted',
      requestGeneration: 1,
    })

    expect(reverted).toMatchObject({
      status: 'reverted',
      transactionHash,
    })
    expect('message' in reverted).toBe(false)
  })

  it.each(['timeout', 'unknown'] as const)(
    '確認できない状態を理由 %s とハッシュ付きで表す',
    (reason) => {
      const unknown = transferReducer(confirmingState(), {
        type: 'confirmation-unknown',
        requestGeneration: 1,
        reason,
      })

      expect(unknown).toMatchObject({
        status: 'unknown',
        transactionHash,
        reason,
      })
    },
  )

  it('成功後の失敗通知を無視して成功と失敗を同時に持たない', () => {
    const success = transferReducer(confirmingState(), {
      type: 'confirmed',
      requestGeneration: 1,
    })
    const lateFailure = transferReducer(success, {
      type: 'failed',
      requestGeneration: 1,
      message: '遅れて届いた失敗',
    })

    expect(lateFailure).toBe(success)
    expect(lateFailure.status).toBe('success')
    expect('message' in lateFailure).toBe(false)
  })
})

describe('nextTransferRequestGeneration', () => {
  it('処理世代を単調に増加させる', () => {
    expect(nextTransferRequestGeneration(0)).toBe(1)
    expect(nextTransferRequestGeneration(41)).toBe(42)
  })

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER])(
    '安全に増加できない値 %s を拒否する',
    (value) => {
      expect(() => nextTransferRequestGeneration(value)).toThrow(RangeError)
    },
  )
})
