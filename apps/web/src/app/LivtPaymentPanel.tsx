import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Address, Hash } from 'viem'
import { KAIROS_NETWORK } from '../blockchain/kairos'
import { RpcChainMismatchError } from '../blockchain/kairosChainVerification'
import { KairosRpcError } from '../blockchain/kairosRpcError'
import {
  IncorrectPasswordError,
  InvalidPasswordError,
} from '../wallet/encryptedWallet'
import { SigningAccountMismatchError } from '../wallet/signingAccount'
import {
  InsufficientKairosGasError,
  JpycTransferBroadcastError,
  JpycTransferBroadcastUnknownError,
  JpycTransferSigningError,
  JpycTransferSimulationError,
  TransferConfirmationTimeoutError,
  TransferConfirmationUnknownError,
  type JpycTransferPhaseUpdate,
} from '../tokens/jpycTransfer'
import {
  InvalidTransferAmountError,
  InvalidTransferRecipientError,
} from '../tokens/transferValidation'
import {
  InvalidTokenContractError,
  TokenMetadataError,
} from '../tokens/tokenMetadata'
import {
  clearPaymentAccessToken,
  LivtPaymentApiError,
  loadPaymentAccessToken,
  normalizeLivtTransactionHash,
  savePaymentAccessToken,
  type LivtPaymentApiClient,
  type LivtPaymentDetails,
  type LivtPaymentSessionUser,
  type PaymentTokenStorage,
} from '../payments/livtPaymentApi'
import {
  executeLivtPayment,
  LivtPaymentConfirmationError,
  LivtPaymentTransactionRevertedError,
  type LivtPaymentTransferExecutor,
} from '../payments/livtPaymentFlow'
import {
  clearKnownPaymentTransactionHash,
  loadKnownPaymentTransactionHash,
  saveKnownPaymentTransactionHash,
} from '../payments/livtPaymentProgress'
import {
  assertLivtPaymentDetailsUnchanged,
  createLivtPaymentIntent,
  PaymentAmountMismatchError,
  PaymentDetailsChangedError,
  PaymentIdentifierMismatchError,
  PaymentStateRejectionError,
  UnsupportedPaymentChainError,
  UnsupportedPaymentTokenError,
  type ValidatedLivtPayment,
} from '../payments/livtPaymentIntent'
import type { LivtPaymentRequest } from '../payments/paymentRequest'

interface LivtPaymentPanelProps {
  readonly request: LivtPaymentRequest
  readonly sender: Address
  readonly availableJpycBalance: bigint | null
  readonly hasNativeBalance: boolean
  readonly jpycBalanceError?: string | null
  readonly nativeBalanceError?: string | null
  readonly isJpycBalanceLoading?: boolean
  readonly isNativeBalanceLoading?: boolean
  readonly onRetryBalances?: () => void
  readonly apiClient: LivtPaymentApiClient
  readonly onConfirmed: () => Promise<void>
  readonly onBack: () => void
  readonly tokenStorage?: PaymentTokenStorage
  readonly transferExecutor?: LivtPaymentTransferExecutor
  readonly now?: () => Date
}

type AuthenticationStatus =
  | 'anonymous'
  | 'validating'
  | 'authenticated'

type SubmissionStatus =
  | 'reviewing'
  | 'processing'
  | 'pending'
  | 'confirmed'
  | 'failed'

export function LivtPaymentPanel({
  request,
  sender,
  availableJpycBalance,
  hasNativeBalance,
  jpycBalanceError = null,
  nativeBalanceError = null,
  isJpycBalanceLoading = false,
  isNativeBalanceLoading = false,
  onRetryBalances,
  apiClient,
  onConfirmed,
  onBack,
  tokenStorage = sessionStorage,
  transferExecutor,
  now = () => new Date(),
}: LivtPaymentPanelProps) {
  const [details, setDetails] = useState<LivtPaymentDetails | null>(null)
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [isLoadingDetails, setIsLoadingDetails] = useState(true)
  const [initialTransactionHash] = useState<Hash | null>(() =>
    loadKnownPaymentTransactionHash(
      request.paymentId,
      sender,
      tokenStorage,
    ),
  )
  const [accessToken, setAccessToken] = useState<string | null>(() =>
    loadPaymentAccessToken(tokenStorage),
  )
  const [authenticatedUser, setAuthenticatedUser] =
    useState<LivtPaymentSessionUser | null>(null)
  const [authenticationStatus, setAuthenticationStatus] =
    useState<AuthenticationStatus>(
      () =>
        loadPaymentAccessToken(tokenStorage) === null
          ? 'anonymous'
          : 'validating',
    )
  const [authenticationError, setAuthenticationError] = useState<
    string | null
  >(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [signingPassword, setSigningPassword] = useState('')
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [submissionStatus, setSubmissionStatus] =
    useState<SubmissionStatus>(
      initialTransactionHash === null ? 'reviewing' : 'pending',
    )
  const [phase, setPhase] = useState<JpycTransferPhaseUpdate['phase'] | null>(
    null,
  )
  const [submissionMessage, setSubmissionMessage] = useState<string | null>(
    initialTransactionHash === null
      ? null
      : '保存済みの取引番号があります。送金せず確認だけ再試行してください。',
  )
  const [transactionHash, setTransactionHash] = useState<Hash | null>(
    initialTransactionHash,
  )
  const [canRetryTransfer, setCanRetryTransfer] = useState(false)
  const submissionInFlight = useRef(false)
  const requestGeneration = useRef(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      requestGeneration.current += 1
      submissionInFlight.current = false
    }
  }, [])

  useEffect(() => {
    let current = true

    // [Flow E] URLの値ではなく、LivT APIから正本の支払い情報を取得する。
    void apiClient
      .getPaymentDetails(request.paymentId)
      .then((value) => {
        if (current) setDetails(value)
      })
      .catch((error: unknown) => {
        if (current) setDetailsError(getDetailsErrorMessage(error))
      })
      .finally(() => {
        if (current) setIsLoadingDetails(false)
      })

    return () => {
      current = false
    }
  }, [apiClient, request.paymentId])

  useEffect(() => {
    if (accessToken === null) return

    let current = true

    void apiClient
      .getCurrentUser(accessToken)
      .then((user) => {
        if (!current) return
        setAuthenticatedUser(user)
        setAuthenticationStatus('authenticated')
      })
      .catch((error: unknown) => {
        if (!current) return
        clearPaymentAccessToken(tokenStorage)
        setAccessToken(null)
        setAuthenticatedUser(null)
        setAuthenticationStatus('anonymous')
        setAuthenticationError(getAuthenticationErrorMessage(error))
      })

    return () => {
      current = false
    }
  }, [accessToken, apiClient, tokenStorage])

  const paymentValidation = useMemo<{
    readonly payment: ValidatedLivtPayment | null
    readonly error: string | null
  }>(() => {
    if (details === null || availableJpycBalance === null) {
      return { payment: null, error: null }
    }
    try {
      // [Flow F] 状態・期限・chain・token・金額・残高を送金前に検証する。
      return {
        payment: createLivtPaymentIntent({
          requestedPaymentId: request.paymentId,
          details,
          sender,
          availableBalance: availableJpycBalance,
          now: now(),
        }),
        error: null,
      }
    } catch (error) {
      // [Flow G] 検証に失敗した場合はintentを作らず送金を止める。
      return {
        payment: null,
        error: getPaymentValidationErrorMessage(error),
      }
    }
  }, [
    availableJpycBalance,
    details,
    now,
    request.paymentId,
    sender,
  ])
  const validatedPayment = paymentValidation.payment
  const displayedDetailsError =
    detailsError ??
    (transactionHash === null ? paymentValidation.error : null)

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isLoggingIn) return

    setIsLoggingIn(true)
    setAuthenticationError(null)
    const passwordForLogin = password
    setPassword('')

    try {
      // [Flow I] Wallet秘密情報と分離したLivT決済限定tokenを取得する。
      const result = await apiClient.login(email.trim(), passwordForLogin)
      if (!mounted.current) return
      savePaymentAccessToken(result.token, tokenStorage)
      setAuthenticationStatus('validating')
      setAccessToken(result.token)
      setAuthenticatedUser(null)
      setEmail('')
    } catch (error) {
      if (mounted.current) {
        setAuthenticationError(getAuthenticationErrorMessage(error))
      }
    } finally {
      if (mounted.current) setIsLoggingIn(false)
    }
  }

  const handleLogout = async () => {
    const token = accessToken
    clearPaymentAccessToken(tokenStorage)
    setAccessToken(null)
    setAuthenticatedUser(null)
    setAuthenticationStatus('anonymous')
    if (token !== null) {
      try {
        await apiClient.logout(token)
      } catch {
        // The browser copy is cleared even if the backend is unavailable.
      }
    }
  }

  const rememberTransactionHash = (hash: Hash) => {
    // [Flow L] 結果不明時も再送せず確認だけ再試行できるようtxHashを保存する。
    setTransactionHash(hash)
    try {
      saveKnownPaymentTransactionHash(
        request.paymentId,
        sender,
        hash,
        tokenStorage,
      )
    } catch {
      // Confirmation still proceeds when browser storage is unavailable.
    }
  }

  const forgetTransactionHash = () => {
    try {
      clearKnownPaymentTransactionHash(
        request.paymentId,
        sender,
        tokenStorage,
      )
    } catch {
      // An unavailable storage entry must not block confirmation.
    }
  }

  const confirmKnownHash = async (
    hash: Hash,
    token: string,
    generation: number,
  ) => {
    rememberTransactionHash(hash)
    try {
      // [Flow M] 保存済みtxHashも新規txHashも同じbackend確認APIへ送る。
      await apiClient.confirmPayment(request.paymentId, hash, token)
      if (!isCurrent(generation)) return
      forgetTransactionHash()
      setSubmissionStatus('confirmed')
      setSubmissionMessage('LivTで決済が確認されました。')
      await onConfirmed().catch(() => undefined)
    } catch (error) {
      if (!isCurrent(generation)) return
      handleConfirmationFailure(error, hash)
    }
  }

  const handleConfirmationFailure = (error: unknown, hash: Hash) => {
    rememberTransactionHash(hash)
    if (error instanceof LivtPaymentApiError) {
      if (error.reason === 'unauthenticated') {
        clearPaymentAccessToken(tokenStorage)
        setAccessToken(null)
        setAuthenticatedUser(null)
        setAuthenticationStatus('anonymous')
      }
      if (error.reason === 'already-confirmed') {
        forgetTransactionHash()
        setSubmissionStatus('confirmed')
        setSubmissionMessage(
          'この決済は別の確認処理ですでに完了しています。この取引番号との対応は確認されていません。',
        )
        return
      }
      if (
        error.reason === 'receipt-pending' ||
        error.reason === 'backend-unavailable' ||
        error.reason === 'unauthenticated'
      ) {
        setSubmissionStatus('pending')
        setSubmissionMessage(getConfirmationErrorMessage(error))
        return
      }
    }
    setSubmissionStatus('failed')
    setSubmissionMessage(getConfirmationErrorMessage(error))
  }

  const handlePayment = async () => {
    if (
      details === null ||
      validatedPayment === null ||
      availableJpycBalance === null ||
      accessToken === null ||
      authenticationStatus !== 'authenticated' ||
      signingPassword.length === 0 ||
      submissionInFlight.current
    ) {
      return
    }

    submissionInFlight.current = true
    const generation = requestGeneration.current + 1
    requestGeneration.current = generation
    const passwordForSigning = signingPassword
    setSigningPassword('')
    setSubmissionStatus('processing')
    setSubmissionMessage(null)
    setCanRetryTransfer(false)
    setPhase('simulating')

    try {
      const refreshedDetails = await apiClient.getPaymentDetails(
        request.paymentId,
      )
      const refreshedPayment = createLivtPaymentIntent({
        requestedPaymentId: request.paymentId,
        details: refreshedDetails,
        sender,
        availableBalance: availableJpycBalance,
        now: now(),
      })
      assertLivtPaymentDetailsUnchanged(details, refreshedDetails)
      if (!isCurrent(generation)) return

      const result = await executeLivtPayment({
        paymentId: request.paymentId,
        intent: refreshedPayment.intent,
        password: passwordForSigning,
        accessToken,
        apiClient,
        transferExecutor,
        isCurrent: () => isCurrent(generation),
        onPhase: (update) => {
          if (!isCurrent(generation)) return
          setPhase(update.phase)
          if (update.transactionHash !== undefined) {
            rememberTransactionHash(
              normalizeLivtTransactionHash(update.transactionHash),
            )
          }
        },
      })

      if (!isCurrent(generation)) return
      rememberTransactionHash(result.transactionHash)
      forgetTransactionHash()
      setSubmissionStatus('confirmed')
      setSubmissionMessage('LivTで決済が確認されました。')
      await onConfirmed().catch(() => undefined)
    } catch (error) {
      if (!isCurrent(generation)) return

      if (error instanceof LivtPaymentConfirmationError) {
        handleConfirmationFailure(error.apiError, error.transactionHash)
      } else if (error instanceof LivtPaymentTransactionRevertedError) {
        forgetTransactionHash()
        setTransactionHash(error.transactionHash)
        setCanRetryTransfer(true)
        setSubmissionStatus('failed')
        setSubmissionMessage('取引はチェーン上で取り消されました。')
      } else if (error instanceof LivtPaymentApiError) {
        setSubmissionStatus('failed')
        setSubmissionMessage(getDetailsErrorMessage(error))
      } else if (isPaymentValidationError(error)) {
        setSubmissionStatus('failed')
        setSubmissionMessage(getPaymentValidationErrorMessage(error))
      } else {
        const knownHash = getKnownTransactionHash(error)
        if (knownHash !== null) {
          setTransactionHash(knownHash)
          await confirmKnownHash(knownHash, accessToken, generation)
        } else {
          setSubmissionStatus('failed')
          setSubmissionMessage(getTransferErrorMessage(error))
        }
      }
    } finally {
      if (requestGeneration.current === generation) {
        submissionInFlight.current = false
        setPhase(null)
      }
    }
  }

  const retryConfirmation = async () => {
    if (
      transactionHash === null ||
      accessToken === null ||
      authenticationStatus !== 'authenticated' ||
      submissionInFlight.current
    ) {
      return
    }

    submissionInFlight.current = true
    const generation = requestGeneration.current + 1
    requestGeneration.current = generation
    setSubmissionStatus('processing')
    setPhase('confirming')
    setSubmissionMessage(null)

    try {
      await confirmKnownHash(transactionHash, accessToken, generation)
    } finally {
      if (requestGeneration.current === generation) {
        submissionInFlight.current = false
        setPhase(null)
      }
    }
  }

  const isCurrent = (generation: number) =>
    mounted.current && requestGeneration.current === generation

  if (isLoadingDetails) {
    return (
      <PaymentShell onBack={onBack}>
        <p role="status">LivTから決済情報を取得しています…</p>
      </PaymentShell>
    )
  }

  if (displayedDetailsError !== null || details === null) {
    return (
      <PaymentShell onBack={onBack}>
        <p role="alert">
          {displayedDetailsError ?? '決済情報を読み込めませんでした。'}
        </p>
      </PaymentShell>
    )
  }

  return (
    <PaymentShell
      onBack={submissionStatus === 'processing' ? undefined : onBack}
    >
      <h2>LivTのお支払い</h2>
      {/* [Flow H] backendから取得・検証した支払い内容を署名前に表示する。 */}
      <dl className="transaction-details payment-request-details">
        <div><dt>店舗</dt><dd>{details.store_name}</dd></div>
        <div><dt>金額</dt><dd>{details.display_amount} {details.token_symbol}</dd></div>
        <div><dt>ネットワーク</dt><dd>{details.chain_name}</dd></div>
        <div><dt>Chain ID</dt><dd>{details.chain_id}</dd></div>
        <div><dt>Token</dt><dd>{details.token_contract}</dd></div>
        <div><dt>送金先</dt><dd>{details.recipient_address}</dd></div>
        <div><dt>送金元</dt><dd>{sender}</dd></div>
        <div><dt>有効期限</dt><dd>{details.expires_at_iso ?? '未設定'}</dd></div>
      </dl>
      <p className="warning">
        QRやURLの金額ではなく、LivTから取得した内容を表示しています。
        手数料はKAIAで支払います。
      </p>

      {availableJpycBalance === null && jpycBalanceError === null && (
        <p role="status">JPYC残高を確認しています…</p>
      )}

      {(jpycBalanceError !== null || nativeBalanceError !== null) && (
        <div className="payment-balance-error">
          {jpycBalanceError !== null && (
            <p role="alert">{jpycBalanceError}</p>
          )}
          {nativeBalanceError !== null && (
            <p role="alert">{nativeBalanceError}</p>
          )}
          {onRetryBalances !== undefined && (
            <button type="button" onClick={onRetryBalances}>
              残高確認を再試行
            </button>
          )}
        </div>
      )}

      {authenticationStatus === 'validating' && (
        <p role="status">LivTへのログイン状態を確認しています…</p>
      )}

      {authenticationStatus === 'authenticated' &&
        authenticatedUser !== null && (
          <div className="payment-session">
            <p>LivT利用者: {authenticatedUser.name}</p>
            <button
              type="button"
              className="secondary compact-button"
              disabled={submissionStatus === 'processing'}
              onClick={() => void handleLogout()}
            >
              LivTからログアウト
            </button>
          </div>
        )}

      {authenticationStatus === 'anonymous' && (
        <form className="payment-login" onSubmit={handleLogin}>
          <h3>LivTへログイン</h3>
          <p>
            決済確認用の短時間tokenを取得します。Walletの秘密情報は送信しません。
          </p>
          <label htmlFor="livt-payment-email">メールアドレス</label>
          <input
            id="livt-payment-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
          <label htmlFor="livt-payment-login-password">LivTパスワード</label>
          <input
            id="livt-payment-login-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
          {authenticationError !== null && (
            <p role="alert">{authenticationError}</p>
          )}
          <button type="submit" disabled={isLoggingIn}>
            {isLoggingIn ? 'ログイン中…' : 'LivTへログイン'}
          </button>
        </form>
      )}

      {authenticationStatus === 'authenticated' &&
        submissionStatus === 'reviewing' && (
          <div className="payment-confirmation">
            {!hasNativeBalance &&
              nativeBalanceError === null &&
              !isNativeBalanceLoading && (
              <p role="alert">手数料に必要なKAIA残高が不足しています。</p>
            )}
            {isNativeBalanceLoading && (
              <p role="status">KAIA残高を確認しています…</p>
            )}
            <label htmlFor="livt-payment-signing-password">
              送金確認用Walletパスワード
            </label>
            <input
              id="livt-payment-signing-password"
              type="password"
              value={signingPassword}
              onChange={(event) => setSigningPassword(event.target.value)}
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => void handlePayment()}
              disabled={
                validatedPayment === null ||
                isJpycBalanceLoading ||
                isNativeBalanceLoading ||
                jpycBalanceError !== null ||
                nativeBalanceError !== null ||
                !hasNativeBalance ||
                signingPassword.length === 0
              }
            >
              内容を確認してJPYCを送る
            </button>
            <button type="button" className="secondary" onClick={onBack}>
              支払わずに戻る
            </button>
          </div>
        )}

      {submissionStatus === 'processing' && (
        <p role="status" aria-live="polite">
          {getProcessingMessage(phase)}
        </p>
      )}

      {submissionStatus === 'pending' && transactionHash !== null && (
        <div className="transaction-result" aria-live="polite">
          <h3>LivTでの確認待ちです</h3>
          <p>{submissionMessage}</p>
          <p className="hash">取引番号: {transactionHash}</p>
          {authenticationStatus === 'authenticated' && (
            <button type="button" onClick={() => void retryConfirmation()}>
              送金せず確認だけ再試行
            </button>
          )}
        </div>
      )}

      {submissionStatus === 'confirmed' && transactionHash !== null && (
        // [Flow U] backend検証完了後だけ支払い確認済みとして表示する。
        <div className="transaction-result" aria-live="polite">
          <h3>お支払いが確認されました</h3>
          <p>{submissionMessage}</p>
          <p className="hash">取引番号: {transactionHash}</p>
          <a
            href={`${KAIROS_NETWORK.blockExplorerUrl}/tx/${transactionHash}`}
            target="_blank"
            rel="noreferrer"
          >
            Kaiascanで確認
          </a>
        </div>
      )}

      {submissionStatus === 'failed' && (
        <div className="transaction-result">
          <p role="alert">{submissionMessage}</p>
          {transactionHash !== null && (
            <p className="hash">取引番号: {transactionHash}</p>
          )}
          {transactionHash === null && (
            <button
              type="button"
              onClick={() => {
                setSubmissionStatus('reviewing')
                setSubmissionMessage(null)
              }}
            >
              内容確認へ戻る
            </button>
          )}
          {transactionHash !== null && canRetryTransfer && (
            <button
              type="button"
              onClick={() => {
                setTransactionHash(null)
                setCanRetryTransfer(false)
                setSubmissionStatus('reviewing')
                setSubmissionMessage(null)
              }}
            >
              取り消された取引を確認してやり直す
            </button>
          )}
        </div>
      )}
    </PaymentShell>
  )
}

function PaymentShell({
  children,
  onBack,
}: {
  readonly children: ReactNode
  readonly onBack?: () => void
}) {
  return (
    <section className="transfer-panel livt-payment-panel">
      {onBack !== undefined && (
        <button
          type="button"
          className="back-button secondary"
          aria-label="Back to wallet"
          onClick={onBack}
        >
          ← ウォレットへ戻る
        </button>
      )}
      {children}
    </section>
  )
}

function getKnownTransactionHash(error: unknown): Hash | null {
  if (
    error instanceof TransferConfirmationTimeoutError ||
    error instanceof TransferConfirmationUnknownError ||
    error instanceof JpycTransferBroadcastUnknownError ||
    error instanceof JpycTransferBroadcastError
  ) {
    return normalizeLivtTransactionHash(error.transactionHash)
  }
  return null
}

function getDetailsErrorMessage(error: unknown): string {
  if (error instanceof LivtPaymentApiError) {
    if (error.reason === 'payment-not-found') {
      return '指定された決済は見つかりません。'
    }
    if (error.reason === 'malformed-response') {
      return 'LivTの決済情報を安全に確認できませんでした。'
    }
  }
  return 'LivTへ接続できませんでした。時間をおいて再試行してください。'
}

function getAuthenticationErrorMessage(error: unknown): string {
  if (
    error instanceof LivtPaymentApiError &&
    (error.reason === 'authentication-rejected' ||
      error.reason === 'unauthenticated')
  ) {
    return 'LivTのメールアドレスまたはパスワードを確認してください。'
  }
  return 'LivTへログインできませんでした。'
}

function getPaymentValidationErrorMessage(error: unknown): string {
  if (error instanceof PaymentStateRejectionError) {
    if (error.reason === 'already-confirmed') {
      return 'この決済はすでに完了しています。'
    }
    if (error.reason === 'expired') return 'この決済は期限切れです。'
    return 'この決済は現在支払えません。'
  }
  if (error instanceof UnsupportedPaymentChainError) {
    return 'LivTが指定したネットワークはこのWalletで利用できません。'
  }
  if (error instanceof UnsupportedPaymentTokenError) {
    return 'LivTが指定したTokenはこのWalletで利用できません。'
  }
  if (
    error instanceof PaymentAmountMismatchError ||
    error instanceof PaymentIdentifierMismatchError ||
    error instanceof PaymentDetailsChangedError
  ) {
    return 'LivTの決済内容が一致しないため送金を止めました。'
  }
  if (error instanceof InvalidTransferRecipientError) {
    return 'LivTの送金先アドレスが無効なため送金を止めました。'
  }
  if (
    error instanceof InvalidTransferAmountError &&
    error.reason === 'exceeds-balance'
  ) {
    return 'JPYC残高が不足しています。'
  }
  return 'LivTの決済内容を安全に検証できませんでした。'
}

function getConfirmationErrorMessage(error: unknown): string {
  if (error instanceof LivtPaymentApiError) {
    if (error.reason === 'unauthenticated') {
      return 'LivTへ再ログイン後、送金せず確認だけ再試行してください。'
    }
    if (error.reason === 'receipt-pending') {
      return '取引receiptがまだ見つかりません。送金せず確認だけ再試行してください。'
    }
    if (error.reason === 'duplicate-transaction') {
      return 'この取引番号は別の決済ですでに使用されています。'
    }
    if (error.reason === 'expired') {
      return '決済期限を過ぎたためLivTに拒否されました。'
    }
    if (error.reason === 'verification-rejected') {
      return 'LivTのtransaction検証で支払いが拒否されました。'
    }
    if (error.reason === 'payment-not-found') {
      return 'LivTの決済が見つかりません。'
    }
  }
  return 'LivTで確認できませんでした。送金は再実行しないでください。'
}

function getTransferErrorMessage(error: unknown): string {
  if (error instanceof InsufficientKairosGasError) {
    return '送金手数料に必要なKAIAが不足しています。'
  }
  if (error instanceof KairosRpcError) {
    return 'Kairos RPCへ接続できませんでした。送金は行われていません。'
  }
  if (error instanceof RpcChainMismatchError) {
    return '接続中のRPCがKaia Kairosではないため送金を止めました。'
  }
  if (
    error instanceof InvalidTokenContractError ||
    error instanceof TokenMetadataError
  ) {
    return '接続先で承認済みJPYCを検証できないため送金を止めました。'
  }
  if (error instanceof JpycTransferSimulationError) {
    return 'JPYC送金の事前実行に失敗しました。'
  }
  if (
    error instanceof IncorrectPasswordError ||
    error instanceof InvalidPasswordError
  ) {
    return 'Walletパスワードが正しくありません。'
  }
  if (error instanceof SigningAccountMismatchError) {
    return '解除中のWalletと署名accountが一致しません。'
  }
  if (error instanceof JpycTransferSigningError) {
    return 'この端末内でtransactionに署名できませんでした。'
  }
  if (error instanceof JpycTransferBroadcastError) {
    return 'transactionを送信できませんでした。安全のため自動再送しません。'
  }
  return 'お支払い処理を完了できませんでした。'
}

function isPaymentValidationError(error: unknown): boolean {
  return (
    error instanceof PaymentStateRejectionError ||
    error instanceof UnsupportedPaymentChainError ||
    error instanceof UnsupportedPaymentTokenError ||
    error instanceof PaymentAmountMismatchError ||
    error instanceof PaymentIdentifierMismatchError ||
    error instanceof PaymentDetailsChangedError ||
    error instanceof InvalidTransferRecipientError ||
    error instanceof InvalidTransferAmountError
  )
}

function getProcessingMessage(
  phase: JpycTransferPhaseUpdate['phase'] | null,
): string {
  if (phase === 'simulating') return '接続先と送金内容を検証しています…'
  if (phase === 'signing') return 'この端末内で署名しています…'
  if (phase === 'broadcasting') return 'Kairosへ送信しています…'
  return 'LivTでtransactionを確認しています…'
}
