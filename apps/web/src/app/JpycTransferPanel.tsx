import { useEffect, useReducer, useRef, useState } from 'react'
import type { Address } from 'viem'
import { RpcChainMismatchError } from '../blockchain/kairosChainVerification'
import { KAIROS_NETWORK } from '../blockchain/kairos'
import { KairosRpcError } from '../blockchain/kairosRpcError'
import {
  IncorrectPasswordError,
  InvalidPasswordError,
} from '../wallet/encryptedWallet'
import { SigningAccountMismatchError } from '../wallet/signingAccount'
import {
  executeJpycTransfer,
  InsufficientKairosGasError,
  JpycTransferBroadcastError,
  JpycTransferBroadcastUnknownError,
  JpycTransferSigningError,
  StaleTransferRequestError,
  JpycTransferSimulationError,
  TransferConfirmationTimeoutError,
  TransferConfirmationUnknownError,
  type JpycTransferPhaseUpdate,
} from '../tokens/jpycTransfer'
import {
  InvalidTokenContractError,
  TokenMetadataError,
} from '../tokens/tokenMetadata'
import {
  createJpycTransferIntent,
  InvalidTransferAmountError,
  InvalidTransferRecipientError,
} from '../tokens/transferValidation'
import {
  createInitialTransferState,
  nextTransferRequestGeneration,
  transferReducer,
} from './transferState'

interface JpycTransferPanelProps {
  readonly sender: Address
  readonly availableJpycBalance: bigint
  readonly jpycDecimals: number
  readonly hasNativeBalance: boolean
  readonly onConfirmed: () => Promise<void>
  readonly onBack: () => void
}

export function JpycTransferPanel({
  sender,
  availableJpycBalance,
  jpycDecimals,
  hasNativeBalance,
  onConfirmed,
  onBack,
}: JpycTransferPanelProps) {
  const [recipientInput, setRecipientInput] = useState('')
  const [amountInput, setAmountInput] = useState('')
  const [confirmationPassword, setConfirmationPassword] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)
  const [estimatedGas, setEstimatedGas] = useState<bigint | null>(null)
  const [state, dispatch] = useReducer(
    transferReducer,
    undefined,
    createInitialTransferState,
  )
  const requestGeneration = useRef(0)
  const submissionInFlight = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      requestGeneration.current = nextTransferRequestGeneration(
        requestGeneration.current,
      )
      submissionInFlight.current = false
    }
  }, [])

  const resetToEditing = () => {
    const generation = nextTransferRequestGeneration(requestGeneration.current)
    requestGeneration.current = generation
    submissionInFlight.current = false
    dispatch({ type: 'edit', requestGeneration: generation })
    setRecipientInput('')
    setAmountInput('')
    setConfirmationPassword('')
    setInputError(null)
    setEstimatedGas(null)
  }

  const returnToEditing = () => {
    const generation = nextTransferRequestGeneration(requestGeneration.current)
    requestGeneration.current = generation
    submissionInFlight.current = false
    dispatch({ type: 'edit', requestGeneration: generation })
    setConfirmationPassword('')
    setInputError(null)
    setEstimatedGas(null)
  }

  const handleReview = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setInputError(null)
    try {
      const intent = createJpycTransferIntent({
        tokenId: 'jpyc',
        senderAddress: sender,
        recipientInput,
        amountInput,
        availableBalance: availableJpycBalance,
        decimals: jpycDecimals,
      })
      dispatch({
        type: 'review',
        requestGeneration: requestGeneration.current,
        intent,
      })
    } catch (error) {
      setInputError(getInputErrorMessage(error))
    }
  }

  const handlePhase = (
    update: JpycTransferPhaseUpdate,
    generation: number,
  ) => {
    if (!mounted.current || requestGeneration.current !== generation) return
    if (update.estimatedGas !== undefined) {
      setEstimatedGas(update.estimatedGas)
    }
    if (update.phase === 'signing') {
      dispatch({ type: 'simulation-succeeded', requestGeneration: generation })
    } else if (update.phase === 'broadcasting') {
      dispatch({ type: 'signing-succeeded', requestGeneration: generation })
    } else if (
      update.phase === 'confirming' &&
      update.transactionHash !== undefined
    ) {
      dispatch({
        type: 'broadcast-succeeded',
        requestGeneration: generation,
        transactionHash: update.transactionHash,
      })
    }
  }

  const handleConfirm = async () => {
    if (state.status !== 'reviewing' || submissionInFlight.current) return
    submissionInFlight.current = true
    const generation = nextTransferRequestGeneration(requestGeneration.current)
    requestGeneration.current = generation
    dispatch({ type: 'start', requestGeneration: generation })

    const passwordForSigning = confirmationPassword
    setConfirmationPassword('')
    setEstimatedGas(null)

    try {
      const result = await executeJpycTransfer({
        intent: state.intent,
        password: passwordForSigning,
        onPhase: (update) => handlePhase(update, generation),
        isCurrent: () =>
          mounted.current && requestGeneration.current === generation,
      })
      if (!mounted.current || requestGeneration.current !== generation) return

      if (result.status === 'reverted') {
        dispatch({ type: 'reverted', requestGeneration: generation })
        return
      }

      await onConfirmed()
      if (!mounted.current || requestGeneration.current !== generation) return
      dispatch({ type: 'confirmed', requestGeneration: generation })
    } catch (error) {
      if (!mounted.current || requestGeneration.current !== generation) return
      if (error instanceof StaleTransferRequestError) return
      if (error instanceof TransferConfirmationTimeoutError) {
        dispatch({
          type: 'confirmation-unknown',
          requestGeneration: generation,
          reason: 'timeout',
        })
      } else if (error instanceof TransferConfirmationUnknownError) {
        dispatch({
          type: 'confirmation-unknown',
          requestGeneration: generation,
          reason: 'unknown',
        })
      } else if (error instanceof JpycTransferBroadcastUnknownError) {
        dispatch({
          type: 'broadcast-succeeded',
          requestGeneration: generation,
          transactionHash: error.transactionHash,
        })
        dispatch({
          type: 'confirmation-unknown',
          requestGeneration: generation,
          reason: 'unknown',
        })
      } else {
        dispatch({
          type: 'failed',
          requestGeneration: generation,
          message: getTransferErrorMessage(error),
        })
      }
    } finally {
      if (requestGeneration.current === generation) {
        submissionInFlight.current = false
      }
    }
  }

  const retryReview = () => {
    if (state.status !== 'error') return
    const generation = nextTransferRequestGeneration(requestGeneration.current)
    requestGeneration.current = generation
    dispatch({ type: 'retry', requestGeneration: generation })
    setConfirmationPassword('')
    setEstimatedGas(null)
  }

  const handleBackToWallet = () => {
    if (isProcessing(state.status)) return
    setConfirmationPassword('')
    onBack()
  }

  if (state.status === 'editing') {
    return (
      <section className="transfer-panel" aria-labelledby="transfer-title">
        <button
          type="button"
          className="back-button secondary"
          aria-label="Back to wallet"
          onClick={handleBackToWallet}
        >
          ← ウォレットへ戻る
        </button>
        <h2 id="transfer-title">JPYCを送る</h2>
        <p>Kaia Kairos上の承認済みJPYCだけを送金します。</p>
        <form onSubmit={handleReview}>
          <label htmlFor="transfer-recipient">送り先アドレス</label>
          <input
            id="transfer-recipient"
            type="text"
            value={recipientInput}
            onChange={(event) => setRecipientInput(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="0x..."
          />
          <label htmlFor="transfer-amount">送るJPYCの数量</label>
          <input
            id="transfer-amount"
            type="text"
            inputMode="decimal"
            value={amountInput}
            onChange={(event) => setAmountInput(event.target.value)}
            autoComplete="off"
          />
          {inputError && <p role="alert">{inputError}</p>}
          {!hasNativeBalance && (
            <p role="alert">手数料に使うKAIA残高が必要です。</p>
          )}
          <div className="button-row">
            <button type="submit" disabled={!hasNativeBalance}>
              内容を確認
            </button>
            <button type="button" className="secondary" onClick={resetToEditing}>
              入力を消す
            </button>
          </div>
        </form>
      </section>
    )
  }

  const intent = state.intent
  const transactionHash =
    state.status === 'confirming' ||
    state.status === 'success' ||
    state.status === 'reverted' ||
    state.status === 'unknown'
      ? state.transactionHash
      : null

  return (
    <section className="transfer-panel" aria-labelledby="transfer-title">
      {!isProcessing(state.status) && (
        <button
          type="button"
          className="back-button secondary"
          aria-label="Back to wallet"
          onClick={handleBackToWallet}
        >
          ← ウォレットへ戻る
        </button>
      )}
      <h2 id="transfer-title">JPYC送金内容</h2>
      <dl className="transaction-details">
        <div><dt>接続先</dt><dd>{KAIROS_NETWORK.name}</dd></div>
        <div><dt>接続先番号</dt><dd>{KAIROS_NETWORK.chainId}</dd></div>
        <div><dt>通貨</dt><dd>{intent.token.displayName}</dd></div>
        <div><dt>JPYC契約アドレス</dt><dd>{intent.token.contractAddress}</dd></div>
        <div><dt>送り主</dt><dd>{intent.sender}</dd></div>
        <div><dt>送り先</dt><dd>{intent.recipient}</dd></div>
        <div><dt>入力した数量</dt><dd>{intent.enteredAmount} JPYC</dd></div>
        <div><dt>正規化した数量</dt><dd>{intent.normalizedAmount} JPYC</dd></div>
        <div>
          <dt>予想ガス使用量</dt>
          <dd>{estimatedGas === null ? '確認後に見積もります' : estimatedGas.toString()}</dd>
        </div>
      </dl>
      <p className="warning">送金手数料はJPYCではなくKAIAで支払います。</p>

      {state.status === 'reviewing' && (
        <>
          <label htmlFor="transfer-password">送金確認用パスワード</label>
          <input
            id="transfer-password"
            type="password"
            value={confirmationPassword}
            onChange={(event) => setConfirmationPassword(event.target.value)}
            autoComplete="current-password"
          />
          <div className="button-row">
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={confirmationPassword.length === 0}
            >
              確認して送る
            </button>
            <button type="button" className="secondary" onClick={returnToEditing}>
              戻る
            </button>
          </div>
        </>
      )}

      {isProcessing(state.status) && (
        <p role="status" aria-live="polite">{getProcessingMessage(state.status)}</p>
      )}

      {state.status === 'error' && (
        <div className="transaction-result">
          <p role="alert">{state.message}</p>
          <button type="button" onClick={retryReview}>内容を保って再確認</button>
          <button type="button" className="secondary" onClick={returnToEditing}>
            入力へ戻る
          </button>
        </div>
      )}

      {state.status === 'success' && transactionHash && (
        <TransactionResult
          title="送金が確定しました"
          status="確定済み"
          transactionHash={transactionHash}
          onReset={resetToEditing}
        />
      )}

      {state.status === 'reverted' && transactionHash && (
        <TransactionResult
          title="送金処理は取り消されました"
          status="取り消し"
          transactionHash={transactionHash}
          onReset={resetToEditing}
        />
      )}

      {state.status === 'unknown' && transactionHash && (
        <TransactionResult
          title={
            state.reason === 'timeout'
              ? '確定待ちが時間切れになりました'
              : '確定状態を確認できませんでした'
          }
          status="確定待ち、または不明（自動再送しません）"
          transactionHash={transactionHash}
          onReset={resetToEditing}
        />
      )}
    </section>
  )
}

function TransactionResult({
  title,
  status,
  transactionHash,
  onReset,
}: {
  readonly title: string
  readonly status: string
  readonly transactionHash: `0x${string}`
  readonly onReset: () => void
}) {
  return (
    <div className="transaction-result" aria-live="polite">
      <h3>{title}</h3>
      <p>状態: {status}</p>
      <p className="hash">取引番号: {transactionHash}</p>
      <a
        href={`${KAIROS_NETWORK.blockExplorerUrl}/tx/${transactionHash}`}
        target="_blank"
        rel="noreferrer"
      >
        Kaiascanで確認
      </a>
      <button type="button" onClick={onReset}>新しい送金を入力</button>
    </div>
  )
}

function isProcessing(status: string): boolean {
  return (
    status === 'simulating' ||
    status === 'signing' ||
    status === 'broadcasting' ||
    status === 'confirming'
  )
}

function getProcessingMessage(status: string): string {
  if (status === 'simulating') return '接続先確認と事前実行をしています…'
  if (status === 'signing') return 'この端末内で署名しています…'
  if (status === 'broadcasting') return 'Kairosへ送信しています…'
  return '取引の確定を待っています…'
}

function getInputErrorMessage(error: unknown): string {
  if (error instanceof InvalidTransferRecipientError) {
    if (error.reason === 'blank') return '送り先アドレスを入力してください。'
    if (error.reason === 'zero-address') return 'ゼロアドレスには送れません。'
    if (error.reason === 'token-contract') return 'JPYC契約自体には送れません。'
    if (error.reason === 'self-transfer') return '自分自身には送れません。'
    return '正しいEVMアドレスを入力してください。'
  }
  if (error instanceof InvalidTransferAmountError) {
    if (error.reason === 'blank') return '送る数量を入力してください。'
    if (error.reason === 'zero') return '0より大きい数量を入力してください。'
    if (error.reason === 'too-many-decimals') return 'JPYCの小数桁数を超えています。'
    if (error.reason === 'exceeds-balance') return 'JPYC残高を超えています。'
    if (error.reason === 'uint256-overflow') return '送金可能な最大値を超えています。'
    return '数量は通常の10進数で入力してください。'
  }
  return '送金内容を確認できませんでした。'
}

function getTransferErrorMessage(error: unknown): string {
  if (error instanceof RpcChainMismatchError) {
    return '接続先がKaia Kairos（番号1001）ではないため送信を止めました。'
  }
  if (error instanceof KairosRpcError) {
    return error.reason === 'timeout'
      ? 'Kairosとの通信が時間切れになりました。送信は行われていません。'
      : 'Kairosへ接続できませんでした。送信は行われていません。'
  }
  if (error instanceof InsufficientKairosGasError) {
    return '送金手数料に必要なKAIAが不足しています。'
  }
  if (error instanceof JpycTransferSimulationError) {
    return 'JPYC送金の事前実行に失敗しました。残高と送り先を確認してください。'
  }
  if (error instanceof JpycTransferSigningError) {
    return 'この端末内で取引に署名できませんでした。'
  }
  if (
    error instanceof IncorrectPasswordError ||
    error instanceof InvalidPasswordError
  ) {
    return 'パスワードが正しくないため署名できませんでした。'
  }
  if (error instanceof SigningAccountMismatchError) {
    return '解除中のウォレットと署名用ウォレットが一致しません。'
  }
  if (error instanceof JpycTransferBroadcastError) {
    return '取引をKairosへ送信できませんでした。自動では再送しません。'
  }
  if (
    error instanceof InvalidTokenContractError ||
    error instanceof TokenMetadataError
  ) {
    return '承認済みJPYC契約を確認できないため送信を止めました。'
  }
  return '送金処理を完了できませんでした。'
}
