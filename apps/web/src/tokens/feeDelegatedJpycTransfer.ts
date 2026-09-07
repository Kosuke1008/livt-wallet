import {
  TxType,
  createWalletClient,
  http,
  type LocalAccount as KaiaLocalAccount,
} from '@kaiachain/viem-ext'
import {
  encodeFunctionData,
  isHash,
  isHex,
  maxUint256,
  type Hash,
  type Hex,
} from 'viem'
import {
  assertActiveFeeDelegationExecutionAllowed,
  getActiveKaiaSdkChain,
} from '../blockchain/activeNetwork'
import { ACTIVE_NETWORK_PROFILE } from '../blockchain/networkProfiles'
import { verifyActiveNetworkChain } from '../blockchain/networkChainVerification'
import {
  isKairosRpcTransportError,
  toKairosRpcError,
} from '../blockchain/kairosRpcError'
import type { WalletStorage } from '../wallet/encryptedWallet'
import {
  withStoredSigningAccount,
} from '../wallet/signingAccount'
import { erc20TransferAbi } from './erc20Abi'
import {
  JpycTransferSigningError,
  JpycTransferSimulationError,
  StaleTransferRequestError,
  type JpycTransferPhaseUpdate,
  type JpycTransferResult,
  type SigningAccountProvider,
} from './jpycTransfer'
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

const storedSigningAccountProvider: SigningAccountProvider = {
  withAccount: withStoredSigningAccount,
}

// Kaia charges this intrinsic-gas surcharge for fee-delegated transaction
// types in addition to the gas estimated for the underlying contract call.
const FEE_DELEGATION_INTRINSIC_GAS = 10_000n

export class InvalidSponsoredTransactionHashError extends Error {
  readonly name = 'InvalidSponsoredTransactionHashError'

  constructor() {
    super('The fee sponsor returned an invalid transaction hash')
  }
}

export interface ExecuteFeeDelegatedJpycTransferOptions {
  readonly intent: JpycTransferIntent
  readonly password: string
  readonly sponsorTransaction: (
    senderSignedTransaction: Hex,
  ) => Promise<Hash>
  readonly onPhase?: (update: JpycTransferPhaseUpdate) => void
  readonly storage?: WalletStorage
  readonly rpcClient?: JpycTransferRpcClient
  readonly signingAccountProvider?: SigningAccountProvider
  readonly isCurrent?: () => boolean
}

export async function executeFeeDelegatedJpycTransfer({
  intent,
  password,
  sponsorTransaction,
  onPhase,
  storage,
  rpcClient = kairosJpycTransferRpcClient,
  signingAccountProvider = storedSigningAccountProvider,
  isCurrent = () => true,
}: ExecuteFeeDelegatedJpycTransferOptions): Promise<JpycTransferResult> {
  // Mainnet fee delegation has no signer/broadcast adapter in Phase 1.
  assertActiveFeeDelegationExecutionAllowed()

  const assertCurrent = () => {
    if (!isCurrent()) throw new StaleTransferRequestError()
  }

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

  onPhase?.({ phase: 'simulating' })
  await verifyActiveNetworkChain(rpcClient)
  assertCurrent()
  await validateErc20Token(token, rpcClient)
  assertCurrent()

  let simulationResult: unknown
  let estimatedGas: bigint
  try {
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
  const feeDelegatedGasLimit = estimatedGas + FEE_DELEGATION_INTRINSIC_GAS
  assertCurrent()
  onPhase?.({ phase: 'simulating', estimatedGas })

  const [gasPrice, nonce] = await Promise.all([
    callBeforeSponsorship(() => rpcClient.getGasPrice()),
    callBeforeSponsorship(() => rpcClient.getPendingNonce(intent.sender)),
  ])
  if (gasPrice <= 0n) throw new JpycTransferSimulationError()
  assertCurrent()

  const data = encodeFunctionData({
    abi: erc20TransferAbi,
    functionName: 'transfer',
    args: [recipient, intent.rawAmount],
  })

  onPhase?.({ phase: 'signing', estimatedGas })
  const senderSignedTransaction = await signingAccountProvider.withAccount(
    password,
    intent.sender,
    async (account) => {
      assertCurrent()
      try {
        const senderWallet = createWalletClient({
          // viem-ext owns a compatible viem dependency, so adapt the same
          // structural LocalAccount without copying any private material.
          account: account as unknown as KaiaLocalAccount,
          chain: getActiveKaiaSdkChain(),
          transport: http(ACTIVE_NETWORK_PROFILE.rpcUrl),
        })
        const signedTransaction = await senderWallet.signTransaction({
          type: TxType.FeeDelegatedSmartContractExecution,
          chainId: ACTIVE_NETWORK_PROFILE.chainId,
          nonce,
          gasPrice,
          gasLimit: feeDelegatedGasLimit,
          from: intent.sender,
          to: token.contractAddress,
          value: 0n,
          data,
        })
        if (!isHex(signedTransaction) || signedTransaction.length < 4) {
          throw new Error('Invalid sender-signed transaction')
        }
        return signedTransaction
      } catch (error) {
        throw new JpycTransferSigningError({ cause: error })
      }
    },
    storage,
  )

  assertCurrent()
  onPhase?.({ phase: 'broadcasting', estimatedGas })
  const transactionHash = await sponsorTransaction(senderSignedTransaction)
  if (!isHash(transactionHash)) {
    throw new InvalidSponsoredTransactionHashError()
  }
  assertCurrent()
  onPhase?.({
    phase: 'confirming',
    estimatedGas,
    transactionHash,
  })

  return {
    status: 'success',
    transactionHash,
    sender: intent.sender,
    recipient,
    enteredAmount: intent.enteredAmount,
    normalizedAmount: intent.normalizedAmount,
    estimatedGas,
    gasPrice,
  }
}

async function callBeforeSponsorship<Result>(
  operation: () => Promise<Result>,
): Promise<Result> {
  try {
    return await operation()
  } catch (error) {
    throw toKairosRpcError(error)
  }
}
