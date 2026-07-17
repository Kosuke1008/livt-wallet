import { describe, expect, it } from 'vitest'
import { getAddress, maxUint256, zeroAddress } from 'viem'
import {
  createJpycTransferIntent,
  InvalidTransferAmountError,
  InvalidTransferRecipientError,
  parseTransferAmount,
  validateTransferRecipient,
  type AmountValidationReason,
  type RecipientValidationReason,
} from '../../../src/tokens/transferValidation'
import {
  approvedJpycToken,
  approvedTokens,
  resolveApprovedToken,
  UnsupportedTokenError,
  type ApprovedTokenId,
} from '../../../src/tokens/tokenRegistry'

const senderAddress = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'
const checksummedRecipient = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const lowercaseRecipient = checksummedRecipient.toLowerCase()

function captureError(action: () => unknown): unknown {
  try {
    action()
  } catch (error) {
    return error
  }
  throw new Error('Expected action to throw')
}

function expectRecipientError(
  value: string,
  reason: RecipientValidationReason,
): void {
  const error = captureError(() =>
    validateTransferRecipient(value, senderAddress, approvedJpycToken),
  )

  expect(error).toBeInstanceOf(InvalidTransferRecipientError)
  expect(error).toMatchObject({
    name: 'InvalidTransferRecipientError',
    reason,
  })
}

function expectAmountError(
  value: string,
  reason: AmountValidationReason,
  options: { readonly decimals?: number; readonly balance?: bigint } = {},
): void {
  const error = captureError(() =>
    parseTransferAmount(
      value,
      options.decimals ?? 18,
      options.balance ?? maxUint256,
    ),
  )

  expect(error).toBeInstanceOf(InvalidTransferAmountError)
  expect(error).toMatchObject({ name: 'InvalidTransferAmountError', reason })
}

describe('JPYC transfer recipient validation', () => {
  it('正しいchecksum addressを受け入れる', () => {
    expect(
      validateTransferRecipient(
        checksummedRecipient,
        senderAddress,
        approvedJpycToken,
      ),
    ).toBe(checksummedRecipient)
  })

  it('小文字addressをchecksum addressへ正規化する', () => {
    expect(
      validateTransferRecipient(
        lowercaseRecipient,
        senderAddress,
        approvedJpycToken,
      ),
    ).toBe(checksummedRecipient)
  })

  it('前後の空白だけを除去して正規化する', () => {
    expect(
      validateTransferRecipient(
        ` \n\t${lowercaseRecipient}\r `,
        senderAddress,
        approvedJpycToken,
      ),
    ).toBe(checksummedRecipient)
  })

  it.each([
    ['空文字', '', 'blank'],
    ['空白のみ', ' \n\t ', 'blank'],
    ['短すぎる値', '0x1234', 'malformed'],
    ['16進数以外を含む値', `0x${'g'.repeat(40)}`, 'malformed'],
    [
      '誤った大文字小文字のchecksum',
      '0x70997970C51812dc3A010C7d01b50e0d17dc79c8',
      'malformed',
    ],
  ] as const)('%sを拒否する', (_label, value, reason) => {
    expectRecipientError(value, reason)
  })

  it('zero addressへの送金を拒否する', () => {
    expectRecipientError(zeroAddress, 'zero-address')
  })

  it('JPYC contract自身への送金を拒否する', () => {
    expectRecipientError(
      approvedJpycToken.contractAddress.toLowerCase(),
      'token-contract',
    )
  })

  it('大文字小文字が異なっても自分自身への送金を拒否する', () => {
    expectRecipientError(getAddress(senderAddress), 'self-transfer')
  })
})

describe('JPYC transfer amount validation', () => {
  it('整数を最小単位のbigintへ正確に変換する', () => {
    const result = parseTransferAmount(
      '12',
      18,
      12_000_000_000_000_000_000n,
    )

    expect(result).toEqual({
      enteredAmount: '12',
      normalizedAmount: '12',
      rawAmount: 12_000_000_000_000_000_000n,
    })
    expect(typeof result.rawAmount).toBe('bigint')
  })

  it('小数と末尾の0を浮動小数点数を介さず正規化する', () => {
    expect(parseTransferAmount(' 1.2300 ', 18, 2_000_000_000_000_000_000n)).toEqual(
      {
        enteredAmount: '1.2300',
        normalizedAmount: '1.23',
        rawAmount: 1_230_000_000_000_000_000n,
      },
    )
  })

  it('18桁tokenの最小単位を1nとして保持する', () => {
    expect(parseTransferAmount('0.000000000000000001', 18, 1n)).toEqual({
      enteredAmount: '0.000000000000000001',
      normalizedAmount: '0.000000000000000001',
      rawAmount: 1n,
    })
  })

  it('Numberの安全な整数範囲を超える値もbigintで正確に保持する', () => {
    const result = parseTransferAmount(
      '9007199254740993',
      0,
      9_007_199_254_740_993n,
    )

    expect(result.rawAmount).toBe(9_007_199_254_740_993n)
    expect(result.normalizedAmount).toBe('9007199254740993')
    expect(typeof result.rawAmount).toBe('bigint')
  })

  it('残高と等しい金額を受け入れる', () => {
    expect(parseTransferAmount('1.5', 18, 1_500_000_000_000_000_000n).rawAmount).toBe(
      1_500_000_000_000_000_000n,
    )
  })

  it('uint256最大値を受け入れる', () => {
    const result = parseTransferAmount(maxUint256.toString(), 0, maxUint256)

    expect(result.rawAmount).toBe(maxUint256)
    expect(result.normalizedAmount).toBe(maxUint256.toString())
  })

  it.each([
    ['空文字', '', 'blank'],
    ['空白のみ', ' \n\t ', 'blank'],
    ['負数', '-1', 'malformed'],
    ['指数表記', '1e18', 'malformed'],
    ['16進表記', '0x10', 'malformed'],
    ['先頭のplus記号', '+1', 'malformed'],
    ['整数部のない小数', '.5', 'malformed'],
    ['小数部のない小数点', '1.', 'malformed'],
    ['小数点が複数ある値', '1.2.3', 'malformed'],
    ['桁区切りを含む値', '1,000', 'malformed'],
    ['数字ではない値', 'JPYC', 'malformed'],
  ] as const)('%sを拒否する', (_label, value, reason) => {
    expectAmountError(value, reason)
  })

  it.each(['0', '00', '0.0', '0.000000000000000000'])(
    '0となる金額 %s を拒否する',
    (value) => {
      expectAmountError(value, 'zero')
    },
  )

  it('tokenの小数桁数を超える入力を丸めず拒否する', () => {
    expectAmountError('1.0000000000000000000', 'too-many-decimals')
  })

  it('利用可能残高を1最小単位でも超える金額を拒否する', () => {
    expectAmountError('1.000000000000000001', 'exceeds-balance', {
      balance: 1_000_000_000_000_000_000n,
    })
  })

  it('uint256最大値を1超える値を拒否する', () => {
    expectAmountError((maxUint256 + 1n).toString(), 'uint256-overflow', {
      decimals: 0,
      balance: maxUint256,
    })
  })

  it.each([-1, 1.5, 256, Number.NaN])(
    '不正なtoken小数桁数 %s を拒否する',
    (decimals) => {
      expectAmountError('1', 'malformed', { decimals })
    },
  )

  it('負の利用可能残高を拒否する', () => {
    expectAmountError('1', 'malformed', { balance: -1n })
  })
})

describe('approved JPYC transfer intent', () => {
  it('token IDを承認済みJPYC設定へ解決する', () => {
    expect(resolveApprovedToken('jpyc')).toBe(approvedJpycToken)
  })

  it('未承認のtoken IDを明示的に拒否する', () => {
    expect(() => resolveApprovedToken('unknown')).toThrowError(
      UnsupportedTokenError,
    )
    expect(() => resolveApprovedToken('unknown')).toThrow(
      'Unsupported token ID: unknown',
    )
  })

  it('型検査を迂回した未承認token IDもintent作成時に拒否する', () => {
    expect(() =>
      createJpycTransferIntent({
        tokenId: 'unknown' as ApprovedTokenId,
        senderAddress,
        recipientInput: lowercaseRecipient,
        amountInput: '1',
        availableBalance: 1_000_000_000_000_000_000n,
        decimals: 18,
      }),
    ).toThrowError(UnsupportedTokenError)
  })

  it('承認済みJPYCだけで正規化済み送金intentを作る', () => {
    const intent = createJpycTransferIntent({
      tokenId: 'jpyc',
      senderAddress,
      recipientInput: ` ${lowercaseRecipient} `,
      amountInput: '1.2300',
      availableBalance: 2_000_000_000_000_000_000n,
      decimals: 18,
    })

    expect(intent).toEqual({
      tokenId: 'jpyc',
      token: approvedJpycToken,
      sender: getAddress(senderAddress),
      recipient: checksummedRecipient,
      decimals: 18,
      enteredAmount: '1.2300',
      normalizedAmount: '1.23',
      rawAmount: 1_230_000_000_000_000_000n,
    })
  })

  it('承認済みtoken一覧と各設定を実行時にも変更不能にする', () => {
    expect(Object.isFrozen(approvedTokens)).toBe(true)
    expect(Object.isFrozen(approvedJpycToken)).toBe(true)
    expect(Reflect.set(approvedJpycToken, 'chainId', 1)).toBe(false)
    expect(approvedJpycToken.chainId).toBe(1001)
  })
})
