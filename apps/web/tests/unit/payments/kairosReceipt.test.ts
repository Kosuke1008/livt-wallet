import { describe, expect, it } from 'vitest'
// @ts-expect-error The live-review runner deliberately uses native Node ESM.
import { assertFeeDelegatedReceipt } from '../../../e2e/payment/support/kairos-receipt.mjs'

const transactionHash = `0x${'1'.repeat(64)}`
const senderTransactionHash = `0x${'2'.repeat(64)}`
const blockHash = `0x${'3'.repeat(64)}`
const sender = `0x${'4'.repeat(40)}`
const recipient = `0x${'5'.repeat(40)}`
const feePayer = `0x${'6'.repeat(40)}`

function receipts() {
  return {
    ethereumReceipt: {
      blockHash,
      from: sender,
      to: recipient,
      // Ethereum互換receiptではfee delegation取引も0x0になり得る。
      type: '0x0',
    },
    kaiaReceipt: {
      status: '0x1',
      transactionHash,
      blockHash,
      from: sender,
      to: recipient,
      type: 'TxTypeFeeDelegatedSmartContractExecution',
      typeInt: 49,
      senderTxHash: senderTransactionHash,
      feePayer,
      feePayerSignatures: [{ V: '0x1', R: '0x2', S: '0x3' }],
    },
  }
}

describe('assertFeeDelegatedReceipt', () => {
  it('Ethereum互換receiptのtypeではなくKaia receiptでfee delegationを判定する', () => {
    expect(
      assertFeeDelegatedReceipt({ ...receipts(), transactionHash }),
    ).toBe(feePayer)
  })

  it('fee payer署名がないreceiptを拒否する', () => {
    const value = receipts()
    value.kaiaReceipt.feePayerSignatures = []

    expect(() =>
      assertFeeDelegatedReceipt({ ...value, transactionHash }),
    ).toThrow('Live Kairos receipt is not fee delegated')
  })

  it('Ethereum互換receiptとblockが一致しないKaia receiptを拒否する', () => {
    const value = receipts()
    value.kaiaReceipt.blockHash = `0x${'7'.repeat(64)}`

    expect(() =>
      assertFeeDelegatedReceipt({ ...value, transactionHash }),
    ).toThrow('Live Kairos receipt is not fee delegated')
  })
})
