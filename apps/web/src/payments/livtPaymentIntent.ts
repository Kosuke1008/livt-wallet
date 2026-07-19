import { maxUint256, type Address } from 'viem'
import { KAIROS_NETWORK } from '../blockchain/kairos'
import { normalizeEvmAddress } from '../blockchain/address'
import { approvedJpycToken } from '../tokens/tokenRegistry'
import {
  createJpycTransferIntent,
  type JpycTransferIntent,
} from '../tokens/transferValidation'
import type { LivtPaymentDetails } from './livtPaymentApi'

export type PaymentStateRejectionReason =
  | 'already-confirmed'
  | 'not-pending'
  | 'missing-expiration'
  | 'expired'

export class PaymentStateRejectionError extends Error {
  readonly name = 'PaymentStateRejectionError'
  readonly reason: PaymentStateRejectionReason

  constructor(reason: PaymentStateRejectionReason) {
    super(`LivT payment state rejected: ${reason}`)
    this.reason = reason
  }
}

export class PaymentIdentifierMismatchError extends Error {
  readonly name = 'PaymentIdentifierMismatchError'

  constructor() {
    super('LivT payment identifier does not match the request')
  }
}

export class UnsupportedPaymentChainError extends Error {
  readonly name = 'UnsupportedPaymentChainError'

  constructor() {
    super('LivT payment requests an unsupported chain')
  }
}

export class UnsupportedPaymentTokenError extends Error {
  readonly name = 'UnsupportedPaymentTokenError'

  constructor() {
    super('LivT payment requests an unsupported token')
  }
}

export class PaymentAmountMismatchError extends Error {
  readonly name = 'PaymentAmountMismatchError'

  constructor() {
    super('LivT payment amount representations do not match')
  }
}

export class PaymentDetailsChangedError extends Error {
  readonly name = 'PaymentDetailsChangedError'

  constructor() {
    super('LivT payment details changed after user review')
  }
}

export interface ValidatedLivtPayment {
  readonly details: LivtPaymentDetails
  readonly intent: JpycTransferIntent
}

export function createLivtPaymentIntent(input: {
  readonly requestedPaymentId: string
  readonly details: LivtPaymentDetails
  readonly sender: Address
  readonly availableBalance: bigint
  readonly now?: Date
}): ValidatedLivtPayment {
  const now = input.now ?? new Date()

  if (String(input.details.id) !== input.requestedPaymentId) {
    throw new PaymentIdentifierMismatchError()
  }
  if (input.details.status === 'confirmed') {
    throw new PaymentStateRejectionError('already-confirmed')
  }
  if (input.details.status !== 'pending') {
    throw new PaymentStateRejectionError('not-pending')
  }
  if (input.details.expires_at_iso === null) {
    throw new PaymentStateRejectionError('missing-expiration')
  }
  if (Date.parse(input.details.expires_at_iso) <= now.getTime()) {
    throw new PaymentStateRejectionError('expired')
  }

  if (
    input.details.chain_id !== KAIROS_NETWORK.chainId ||
    input.details.network.toLowerCase() !== 'kairos'
  ) {
    throw new UnsupportedPaymentChainError()
  }

  let configuredContract: Address
  let requestedContract: Address
  try {
    configuredContract = normalizeEvmAddress(
      approvedJpycToken.contractAddress,
    )
    requestedContract = normalizeEvmAddress(input.details.token_contract)
  } catch {
    throw new UnsupportedPaymentTokenError()
  }

  if (
    requestedContract !== configuredContract ||
    input.details.token_symbol !== approvedJpycToken.expectedSymbol ||
    input.details.token_decimals !== approvedJpycToken.expectedDecimals
  ) {
    throw new UnsupportedPaymentTokenError()
  }

  let atomicAmount: bigint
  try {
    atomicAmount = BigInt(input.details.atomic_amount)
  } catch {
    throw new PaymentAmountMismatchError()
  }
  if (atomicAmount <= 0n || atomicAmount > maxUint256) {
    throw new PaymentAmountMismatchError()
  }

  if (
    BigInt(input.details.display_amount) !== BigInt(input.details.amount)
  ) {
    throw new PaymentAmountMismatchError()
  }

  const intent = createJpycTransferIntent({
    tokenId: 'jpyc',
    senderAddress: input.sender,
    recipientInput: input.details.recipient_address,
    amountInput: input.details.display_amount,
    availableBalance: input.availableBalance,
    decimals: input.details.token_decimals,
  })

  if (intent.rawAmount !== atomicAmount) {
    throw new PaymentAmountMismatchError()
  }

  return Object.freeze({ details: input.details, intent })
}

export function assertLivtPaymentDetailsUnchanged(
  displayed: LivtPaymentDetails,
  refreshed: LivtPaymentDetails,
): void {
  const fields: ReadonlyArray<keyof LivtPaymentDetails> = [
    'id',
    'amount',
    'display_amount',
    'atomic_amount',
    'status',
    'store_name',
    'recipient_address',
    'network',
    'chain_name',
    'chain_id',
    'token_contract',
    'token_symbol',
    'token_decimals',
    'expires_at',
    'expires_at_iso',
  ]

  if (fields.some((field) => displayed[field] !== refreshed[field])) {
    throw new PaymentDetailsChangedError()
  }
}
