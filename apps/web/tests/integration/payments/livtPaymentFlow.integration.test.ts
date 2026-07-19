import { describe, expect, it, vi } from 'vitest'
import type { Address, Hash } from 'viem'
import {
  LivtPaymentApiError,
  type LivtPaymentApiClient,
} from '../../../src/payments/livtPaymentApi'
import {
  executeLivtPayment,
  LivtPaymentConfirmationError,
  LivtPaymentTransactionRevertedError,
} from '../../../src/payments/livtPaymentFlow'
import { createJpycTransferIntent } from '../../../src/tokens/transferValidation'

const sender = '0x3333333333333333333333333333333333333333' as Address
const transactionHash = `0x${'a'.repeat(64)}` as Hash

describe('LivT payment flow', () => {
  it('既存JPYC transfer結果のtxHashだけを同じconfirm API clientへ渡す', async () => {
    const apiClient = createApiClient()
    const transferExecutor = vi.fn().mockResolvedValue({
      status: 'success',
      transactionHash: transactionHash.toUpperCase().replace('0X', '0x'),
      sender,
      recipient: intent.recipient,
      enteredAmount: '125',
      normalizedAmount: '125',
      estimatedGas: 50_000n,
      gasPrice: 25_000_000_000n,
    })

    await expect(
      executeLivtPayment({
        paymentId: '42',
        intent,
        password: 'wallet-password',
        accessToken: '1|short-lived-token',
        apiClient,
        transferExecutor,
      }),
    ).resolves.toEqual({ transactionHash })

    expect(transferExecutor).toHaveBeenCalledOnce()
    expect(apiClient.confirmPayment).toHaveBeenCalledWith(
      '42',
      transactionHash,
      '1|short-lived-token',
    )
  })

  it('reverted transactionをconfirm済みにせずhashを保持する', async () => {
    const apiClient = createApiClient()
    const error = await executeLivtPayment({
      paymentId: '42',
      intent,
      password: 'wallet-password',
      accessToken: '1|short-lived-token',
      apiClient,
      transferExecutor: vi.fn().mockResolvedValue({
        status: 'reverted',
        transactionHash,
      }),
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(LivtPaymentTransactionRevertedError)
    expect(
      (error as LivtPaymentTransactionRevertedError).transactionHash,
    ).toBe(transactionHash)
    expect(apiClient.confirmPayment).not.toHaveBeenCalled()
  })

  it('backend confirmation failureをhash付きで返し再broadcastしない', async () => {
    const apiClient = createApiClient()
    vi.mocked(apiClient.confirmPayment).mockRejectedValue(
      new LivtPaymentApiError('receipt-pending', 400),
    )
    const transferExecutor = vi.fn().mockResolvedValue({
      status: 'success',
      transactionHash,
    })

    const error = await executeLivtPayment({
      paymentId: '42',
      intent,
      password: 'wallet-password',
      accessToken: '1|short-lived-token',
      apiClient,
      transferExecutor,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(LivtPaymentConfirmationError)
    expect((error as LivtPaymentConfirmationError).transactionHash).toBe(
      transactionHash,
    )
    expect(transferExecutor).toHaveBeenCalledOnce()
  })
})

const intent = createJpycTransferIntent({
  tokenId: 'jpyc',
  senderAddress: sender,
  recipientInput: '0x2222222222222222222222222222222222222222',
  amountInput: '125',
  availableBalance: 1_000_000_000_000_000_000_000n,
  decimals: 18,
})

function createApiClient(): LivtPaymentApiClient {
  return {
    getPaymentDetails: vi.fn(),
    login: vi.fn(),
    getCurrentUser: vi.fn(),
    confirmPayment: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn(),
  }
}
