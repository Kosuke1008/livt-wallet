import {
  formatUnits,
  getAddress,
  maxUint256,
  parseUnits,
  zeroAddress,
  type Address,
} from 'viem'
import { InvalidAddressError, normalizeEvmAddress } from '../blockchain/address'
import { tokenDecimalsSchema } from './tokenMetadata'
import {
  resolveApprovedToken,
  type ApprovedTokenId,
  type Erc20TokenConfiguration,
} from './tokenRegistry'

export type RecipientValidationReason =
  | 'blank'
  | 'malformed'
  | 'zero-address'
  | 'token-contract'
  | 'self-transfer'

export class InvalidTransferRecipientError extends Error {
  readonly name = 'InvalidTransferRecipientError'
  readonly reason: RecipientValidationReason

  constructor(reason: RecipientValidationReason, options?: ErrorOptions) {
    super(`Invalid transfer recipient: ${reason}`, options)
    this.reason = reason
  }
}

export type AmountValidationReason =
  | 'blank'
  | 'malformed'
  | 'zero'
  | 'too-many-decimals'
  | 'uint256-overflow'
  | 'exceeds-balance'

export class InvalidTransferAmountError extends Error {
  readonly name = 'InvalidTransferAmountError'
  readonly reason: AmountValidationReason

  constructor(reason: AmountValidationReason, options?: ErrorOptions) {
    super(`Invalid transfer amount: ${reason}`, options)
    this.reason = reason
  }
}

export interface ParsedTransferAmount {
  readonly enteredAmount: string
  readonly normalizedAmount: string
  readonly rawAmount: bigint
}

export interface JpycTransferIntent extends ParsedTransferAmount {
  readonly tokenId: ApprovedTokenId
  readonly token: Erc20TokenConfiguration
  readonly sender: Address
  readonly recipient: Address
  readonly decimals: number
}

export function validateTransferRecipient(
  value: string,
  senderAddress: unknown,
  token: Erc20TokenConfiguration,
): Address {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new InvalidTransferRecipientError('blank')
  }

  let recipient: Address
  let sender: Address
  try {
    recipient = normalizeEvmAddress(trimmed)
    sender = normalizeEvmAddress(senderAddress)
  } catch (error) {
    if (error instanceof InvalidAddressError) {
      throw new InvalidTransferRecipientError('malformed', { cause: error })
    }
    throw error
  }

  if (recipient === getAddress(zeroAddress)) {
    throw new InvalidTransferRecipientError('zero-address')
  }
  if (recipient === token.contractAddress) {
    throw new InvalidTransferRecipientError('token-contract')
  }
  if (recipient === sender) {
    throw new InvalidTransferRecipientError('self-transfer')
  }
  return recipient
}

export function parseTransferAmount(
  value: string,
  decimals: number,
  availableBalance: bigint,
): ParsedTransferAmount {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new InvalidTransferAmountError('blank')

  const validatedDecimals = tokenDecimalsSchema.safeParse(decimals)
  if (!validatedDecimals.success || availableBalance < 0n) {
    throw new InvalidTransferAmountError('malformed')
  }
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
    throw new InvalidTransferAmountError('malformed')
  }

  const fraction = trimmed.split('.')[1]
  if (fraction !== undefined && fraction.length > validatedDecimals.data) {
    throw new InvalidTransferAmountError('too-many-decimals')
  }

  let rawAmount: bigint
  try {
    rawAmount = parseUnits(trimmed, validatedDecimals.data)
  } catch (error) {
    throw new InvalidTransferAmountError('malformed', { cause: error })
  }

  if (rawAmount === 0n) throw new InvalidTransferAmountError('zero')
  if (rawAmount > maxUint256) {
    throw new InvalidTransferAmountError('uint256-overflow')
  }
  if (rawAmount > availableBalance) {
    throw new InvalidTransferAmountError('exceeds-balance')
  }

  return {
    enteredAmount: trimmed,
    normalizedAmount: formatUnits(rawAmount, validatedDecimals.data),
    rawAmount,
  }
}

export function createJpycTransferIntent(input: {
  readonly tokenId: ApprovedTokenId
  readonly senderAddress: unknown
  readonly recipientInput: string
  readonly amountInput: string
  readonly availableBalance: bigint
  readonly decimals: number
}): JpycTransferIntent {
  const token = resolveApprovedToken(input.tokenId)
  const sender = normalizeEvmAddress(input.senderAddress)
  const recipient = validateTransferRecipient(
    input.recipientInput,
    sender,
    token,
  )
  const amount = parseTransferAmount(
    input.amountInput,
    input.decimals,
    input.availableBalance,
  )

  return {
    tokenId: 'jpyc',
    token,
    sender,
    recipient,
    decimals: input.decimals,
    ...amount,
  }
}
