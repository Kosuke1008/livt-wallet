import { execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { decodeFunctionResult } from 'viem'
import { assertFeeDelegatedReceipt } from './kairos-receipt.mjs'

const execFileAsync = promisify(execFile)
const webDirectory = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const walletDirectory = resolve(webDirectory, '../..')
const backendDirectory = resolve(
  process.env.LIVT_LIVE_BACKEND_DIRECTORY ??
    resolve(walletDirectory, '../jpyc-web3-payment-platform'),
)
const feePayerDirectory = resolve(
  process.env.LIVT_FEE_PAYER_DIRECTORY ??
    resolve(walletDirectory, '../livt-fee-payer'),
)

const backendUrl = new URL('http://127.0.0.1:18000')
const walletUrl = new URL('http://127.0.0.1:14173')
const kairosRpcUrl = new URL('https://public-en-kairos.node.kaia.io')
const feeDelegationMode = process.argv.includes('--fee-delegated')
const feeDelegationUrl = feeDelegationMode
  ? localFeePayerUrl(
      process.env.KAIA_FEE_DELEGATION_URL ?? 'http://127.0.0.1:19000',
    )
  : null
const tokenContract = '0xe7c3d8c9a439fede00d2600032d5db0be71c3c29'
const edgeProfileMarker = 'EdgeKairosLiveReview'
const minimumPaymentAtomicAmount = 1_000_000_000_000_000_000n
const transferTopic =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const children = []
let cleanupStarted = false
let edgeStarted = false

const tokenAbi = [
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
]

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    process.exitCode = signal === 'SIGINT' ? 130 : 143
    void cleanup().finally(() => process.exit())
  })
}

try {
  await run()
} catch (error) {
  process.stderr.write(`${safeErrorMessage(error)}\n`)
  process.exitCode = 1
} finally {
  await cleanup()
}

async function run() {
  await assertRequiredFiles()
  await assertInteractiveTerminal()
  await assertPortsAvailable([
    18000,
    14173,
    ...(feeDelegationUrl === null ? [] : [Number(feeDelegationUrl.port)]),
  ])
  await assertWindowsEdgeAvailable()

  const internalFeePayerKey = feeDelegationMode
    ? randomBytes(32).toString('hex')
    : null

  const liveEnvironment = {
    ...process.env,
    APP_URL: backendUrl.origin,
    APP_CONFIG_CACHE: `/tmp/livt-kairos-live-config-${process.pid}.php`,
    APP_ROUTES_CACHE: `/tmp/livt-kairos-live-routes-${process.pid}.php`,
    LIVT_WALLET_URL: walletUrl.origin,
    WEB3_NETWORK: 'kairos',
    KAIROS_RPC_URL: kairosRpcUrl.href,
    KAIROS_ERC20_CONTRACT_ADDRESS: tokenContract,
    WEB3_TOKEN_SYMBOL: 'JPYC',
    WEB3_TOKEN_DECIMALS: '18',
    KAIA_FEE_DELEGATION_ENABLED: feeDelegationMode ? 'true' : 'false',
    ...(feeDelegationUrl === null || internalFeePayerKey === null
      ? {}
      : {
          KAIA_FEE_DELEGATION_URL: feeDelegationUrl.origin,
          KAIA_FEE_DELEGATION_API_KEY: internalFeePayerKey,
        }),
  }

  process.stdout.write('実DBとKairos RPCをread-onlyで事前確認しています…\n')
  await assertLiveDatabaseReady(liveEnvironment)
  await assertKairosReady()

  const confirmation = await question(
    [
      '',
      'このmodeはLaravelが現在設定しているDBへ実データを書き込み、',
      feeDelegationMode
        ? 'Edgeでsender署名したtransactionをLivTのFee Payer経由で実Kairosへbroadcastします。'
        : 'Edgeで署名したtransactionを実Kairosへbroadcastします。',
      'migration・seed・reset・自動送金は行いません。',
      `続行する場合は ${confirmationPhrase()} と入力してください: `,
    ].join('\n'),
  )
  if (confirmation !== confirmationPhrase()) {
    throw new Error('Live Kairos review was cancelled')
  }

  let feePayerAddress = null
  if (feeDelegationUrl !== null && internalFeePayerKey !== null) {
    startService(
      'corepack',
      ['pnpm', 'start'],
      {
        cwd: feePayerDirectory,
        env: {
          ...process.env,
          FEE_PAYER_API_KEY: internalFeePayerKey,
          KAIROS_RPC_URL: kairosRpcUrl.href,
          FEE_PAYER_TOKEN_CONTRACT: tokenContract,
          FEE_PAYER_PORT: feeDelegationUrl.port,
        },
      },
      'LivT Fee Payer',
    )
    feePayerAddress = await waitForFeePayer(
      new URL('/health', feeDelegationUrl),
    )
  }

  startService(
    'php',
    [
      'artisan',
      'serve',
      '--host=127.0.0.1',
      '--port=18000',
      '--no-reload',
    ],
    { cwd: backendDirectory, env: liveEnvironment },
    'Laravel',
  )
  await waitForHttp(new URL('/up', backendUrl))

  startService(
    'corepack',
    [
      'pnpm',
      'exec',
      'vite',
      '--host',
      '127.0.0.1',
      '--port',
      '14173',
      '--strictPort',
    ],
    {
      cwd: webDirectory,
      env: {
        ...process.env,
        VITE_LIVT_API_BASE_URL: backendUrl.origin,
        VITE_KAIROS_RPC_URL: kairosRpcUrl.href,
      },
    },
    'LivT Wallet',
  )
  await waitForHttp(walletUrl)

  await openWindowsEdge(walletUrl.href, true)
  await waitForEnter(
    [
      '[1/3 Wallet準備]',
      'EdgeでWalletを作成または解除し、公開アドレスを確認してください。',
      'このprofileは終了後も削除しません。Walletパスワードを忘れないでください。',
      feeDelegationMode
        ? [
            '送金前に1 JPYC以上をこのWalletアドレスへ用意します。送金元のKAIAは不要です。',
            `LivT Fee Payer ${feePayerAddress} には、Kairos Faucetから必要最小限のKAIAを用意します。`,
          ].join('\n')
        : '送金前に、必要最小限のKairos KAIAと1 JPYC以上をこのアドレスへ用意します。',
      '残高がWallet画面へ反映されたらEnterを押してください。',
    ].join('\n'),
  )

  await openWindowsEdge(new URL('/login', backendUrl).href, false)
  const { paymentId, payment } = await readValidPayment()

  process.stdout.write(
    [
      '実DBのpending決済を確認しました。',
      `店舗: ${payment.store_name}`,
      `金額: ${payment.display_amount} ${payment.token_symbol}`,
      `送金先: ${payment.recipient_address}`,
      '',
    ].join('\n'),
  )

  await openWindowsEdge(new URL(`/pay/${paymentId}`, backendUrl).href, false)
  await waitForEnter(
    [
      feeDelegationMode
        ? '[2/3 実Fee Delegated transaction]'
        : '[2/3 実transaction]',
      'Edgeの支払画面からLivT Walletへ進み、既存のLivT利用者でログインします。',
      ...(feeDelegationMode
        ? [
            'MetaMaskではなく「LivT Walletで支払う」を選択してください。',
            'Wallet確認画面に「決済手数料はLivTが負担します」と表示されていることを確認してください。',
            '「自分のKAIAで手数料を支払う」は直接送信への切替ボタンなので、このレビューでは押さないでください。',
          ]
        : []),
      '店舗・1 JPYC・chain ID 1001・token contract・送金先を確認してください。',
      'Walletパスワードで署名し、「お支払いが確認されました」まで待ちます。',
      feeDelegationMode
        ? 'sender署名だけをWallet内で行い、LivT Fee Payerが手数料を負担して実Kairosへ1回broadcastします。完了後にEnterを押してください。'
        : 'transactionは実Kairosへ1回broadcastされます。完了後にEnterを押してください。',
    ].join('\n'),
  )

  const result = await verifyLiveFinalization(
    paymentId,
    payment,
    liveEnvironment,
  )
  process.stdout.write(
    [
      '',
      '[3/3 検証完了]',
      '実DB: confirmed、tx_hash・user_id・paid_at設定済み',
      '実Kairos RPC: receipt成功、JPYC Transfer log一致',
      ...(result.feePayer === null
        ? []
        : [`Fee Payer: ${result.feePayer}`]),
      `Kaiascan: https://kairos.kaiascan.io/tx/${result.transactionHash}`,
      '',
    ].join('\n'),
  )

  await waitForEnter(
    'Edgeで最終状態を確認してください。Enterでlocal serviceとEdgeを閉じます。Wallet profileは保持されます。',
  )
}

async function assertLiveDatabaseReady(environment) {
  const code = [
    'use Illuminate\\Support\\Facades\\DB;',
    '$connection = DB::connection();',
    '$connection->getPdo();',
    '$database = strtolower($connection->getDatabaseName());',
    '$result = [',
    '"reachable" => true,',
    '"is_e2e" => app()->environment("e2e") || str_contains($database, "e2e"),',
    '"active_staff_exists" => DB::table("staffs")->where("is_active", true)->exists(),',
    '"user_exists" => DB::table("users")->exists(),',
    '"store_wallet_exists" => DB::table("stores")->join("wallets", "wallets.store_id", "=", "stores.id")->exists(),',
    '];',
    'echo json_encode($result);',
  ].join(' ')
  const result = await runArtisanJson(code, environment)
  if (
    result.reachable !== true ||
    result.is_e2e !== false ||
    result.active_staff_exists !== true ||
    result.user_exists !== true ||
    result.store_wallet_exists !== true
  ) {
    throw new Error('Current Laravel database is not ready for live review')
  }
}

async function assertKairosReady() {
  const chainId = await rpc('eth_chainId')
  if (chainId !== '0x3e9') throw new Error('Live RPC is not Kaia Kairos')

  const code = await rpc('eth_getCode', [tokenContract, 'latest'])
  if (typeof code !== 'string' || code === '0x') {
    throw new Error('JPYC contract is unavailable on Kairos')
  }

  const symbolResult = await rpc('eth_call', [
    { to: tokenContract, data: '0x95d89b41' },
    'latest',
  ])
  const decimalsResult = await rpc('eth_call', [
    { to: tokenContract, data: '0x313ce567' },
    'latest',
  ])
  const symbol = decodeFunctionResult({
    abi: tokenAbi,
    functionName: 'symbol',
    data: symbolResult,
  })
  const decimals = decodeFunctionResult({
    abi: tokenAbi,
    functionName: 'decimals',
    data: decimalsResult,
  })
  if (symbol !== 'JPYC' || decimals !== 18) {
    throw new Error('Kairos JPYC metadata does not match the application')
  }
}

async function readValidPayment() {
  while (true) {
    const value = await question(
      [
        '',
        '[決済作成]',
        'Edgeで既存スタッフとしてログインし、POSで金額1 JPYCの決済を作成してください。',
        '表示された /pay/{id} の数字だけを入力してください: ',
      ].join('\n'),
    )
    if (!/^[1-9]\d{0,18}$/.test(value)) {
      process.stdout.write('正しいpayment IDを入力してください。\n')
      continue
    }

    try {
      const payment = await readAndValidatePayment(value)
      return { paymentId: value, payment }
    } catch {
      process.stdout.write(
        'そのpaymentは未期限切れのpending 1 JPYC Kairos決済ではありません。POSで1 JPYCの決済を作成し、別のIDを入力してください。\n',
      )
    }
  }
}

async function readAndValidatePayment(paymentId) {
  const response = await fetch(new URL(`/api/payments/${paymentId}`, backendUrl), {
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error('Live payment could not be loaded')
  const payment = await response.json()
  const sponsorshipResponse = await fetch(
    new URL(`/api/payments/${paymentId}/sponsorship`, backendUrl),
    { headers: { Accept: 'application/json' } },
  )
  if (!sponsorshipResponse.ok) {
    throw new Error('Live sponsorship capability could not be loaded')
  }
  const sponsorship = await sponsorshipResponse.json()

  if (
    String(payment.id) !== paymentId ||
    payment.status !== 'pending' ||
    payment.display_amount !== '1' ||
    payment.atomic_amount !== minimumPaymentAtomicAmount.toString() ||
    payment.chain_id !== 1001 ||
    payment.network?.toLowerCase() !== 'kairos' ||
    typeof payment.token_contract !== 'string' ||
    payment.token_contract.toLowerCase() !== tokenContract ||
    payment.token_symbol !== 'JPYC' ||
    payment.token_decimals !== 18 ||
    sponsorship?.available !== feeDelegationMode ||
    typeof payment.recipient_address !== 'string' ||
    !/^0x[0-9a-f]{40}$/.test(payment.recipient_address) ||
    typeof payment.expires_at_iso !== 'string' ||
    Date.parse(payment.expires_at_iso) <= Date.now()
  ) {
    throw new Error('Live payment is not a valid pending 1 JPYC Kairos payment')
  }
  return payment
}

async function verifyLiveFinalization(paymentId, payment, environment) {
  const code = [
    'use Illuminate\\Support\\Facades\\DB;',
    `$payment = DB::table("payments")->where("id", ${paymentId})->first();`,
    '$result = $payment ? [',
    '"status" => $payment->status,',
    '"tx_hash" => $payment->tx_hash,',
    '"has_user" => $payment->user_id !== null,',
    '"has_paid_at" => $payment->paid_at !== null,',
    '] : null;',
    'echo json_encode($result);',
  ].join(' ')
  const state = await runArtisanJson(code, environment)
  if (
    state?.status !== 'confirmed' ||
    typeof state.tx_hash !== 'string' ||
    !/^0x[0-9a-f]{64}$/.test(state.tx_hash) ||
    state.has_user !== true ||
    state.has_paid_at !== true
  ) {
    throw new Error('Live payment is not finalized in the current database')
  }

  const receipt = await rpc('eth_getTransactionReceipt', [state.tx_hash])
  if (
    typeof receipt !== 'object' ||
    receipt === null ||
    receipt.status !== '0x1' ||
    receipt.transactionHash?.toLowerCase() !== state.tx_hash
  ) {
    throw new Error('Live Kairos receipt is missing or failed')
  }

  let feePayer = null
  if (feeDelegationMode) {
    // eth_getTransactionReceipt intentionally returns the Ethereum-compatible
    // receipt shape. Kaia's fee-payer metadata is exposed only by the
    // Kaia-specific receipt method, so bind both receipts to the same inclusion.
    const kaiaReceipt = await rpc('kaia_getTransactionReceipt', [state.tx_hash])
    feePayer = assertFeeDelegatedReceipt({
      ethereumReceipt: receipt,
      kaiaReceipt,
      transactionHash: state.tx_hash,
    })
  }

  const recipientTopic = `0x${payment.recipient_address.slice(2).padStart(64, '0')}`
  const matchingTransfer = receipt.logs?.find(
    (log) =>
      log.address?.toLowerCase() === tokenContract &&
      log.topics?.[0]?.toLowerCase() === transferTopic &&
      log.topics?.[2]?.toLowerCase() === recipientTopic &&
      typeof log.data === 'string' &&
      /^0x[0-9a-f]+$/i.test(log.data) &&
      BigInt(log.data) === minimumPaymentAtomicAmount,
  )
  if (matchingTransfer === undefined) {
    throw new Error('Live Kairos JPYC Transfer log does not match the payment')
  }

  return { transactionHash: state.tx_hash, feePayer }
}

function confirmationPhrase() {
  return feeDelegationMode
    ? 'LIVE KAIROS FEE DELEGATION'
    : 'LIVE KAIROS'
}

async function runArtisanJson(code, environment) {
  try {
    const { stdout } = await execFileAsync(
      'php',
      ['artisan', 'tinker', `--execute=${code}`],
      {
        cwd: backendDirectory,
        env: environment,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        timeout: 15_000,
      },
    )
    return JSON.parse(stdout.trim())
  } catch (error) {
    throw new Error('Could not inspect the current Laravel database', {
      cause: error,
    })
  }
}

async function rpc(method, parameters = []) {
  let response
  try {
    response = await fetch(kairosRpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params: parameters,
      }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    throw new Error('Kairos RPC is unavailable', { cause: error })
  }
  if (!response.ok) throw new Error('Kairos RPC returned an HTTP error')

  const body = await response.json()
  if (
    typeof body !== 'object' ||
    body === null ||
    body.error !== undefined ||
    !Object.hasOwn(body, 'result')
  ) {
    throw new Error('Kairos RPC returned an invalid response')
  }
  return body.result
}

function startService(command, arguments_, options, label) {
  const child = spawn(command, arguments_, {
    ...options,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const record = { child, label, output: '', diagnosticBuffer: '' }
  children.push(record)
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8')
    stream.on('data', (chunk) => {
      record.output = `${record.output}${chunk}`.slice(-8_000)
      if (label === 'LivT Fee Payer') {
        forwardFeePayerDiagnostics(record, chunk)
      }
    })
  }
  child.on('exit', (code) => {
    if (!cleanupStarted && code !== null && code !== 0) {
      process.stderr.write(`${label} stopped unexpectedly.\n`)
    }
  })
}

function forwardFeePayerDiagnostics(record, chunk) {
  const lines = `${record.diagnosticBuffer}${chunk}`.split(/\r?\n/u)
  record.diagnosticBuffer = lines.pop()?.slice(-256) ?? ''

  for (const line of lines) {
    if (/^\[LivT Fee Payer\] [A-Z][A-Z:_-]*$/u.test(line)) {
      process.stderr.write(`${line}\n`)
    }
  }
}

async function waitForHttp(url) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) return
    } catch {
      // Local services may still be starting.
    }
    await delay(150)
  }
  throw new Error(`Local live review service did not start: ${url.origin}`)
}

async function waitForFeePayer(url) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) })
      const body = response.ok ? await response.json() : null
      if (
        body?.status === 'ok' &&
        body?.network === 'kairos' &&
        typeof body?.fee_payer_address === 'string' &&
        /^0x[0-9a-f]{40}$/i.test(body.fee_payer_address)
      ) {
        return body.fee_payer_address.toLowerCase()
      }
    } catch {
      // The local sidecar may still be compiling or checking Kairos.
    }
    await delay(150)
  }
  throw new Error('LivT Fee Payer did not start safely')
}

async function openWindowsEdge(url, firstPage) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') {
    throw new Error('Unsafe live review URL')
  }
  const windowArgument = firstPage ? '--new-window' : '--new-tab'
  const script = [
    "$profile = Join-Path $env:LOCALAPPDATA 'LivTWallet\\EdgeKairosLiveReview'",
    "$candidates = @('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe')",
    '$edge = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1',
    "if ($null -eq $edge) { throw 'Microsoft Edge is unavailable' }",
    `$arguments = @('--user-data-dir="' + $profile + '"', '--no-first-run', '--no-default-browser-check', '--disable-features=msEdgeFirstRunExperience', '--auto-open-devtools-for-tabs', '${windowArgument}', '${parsed.href}')`,
    'Start-Process -FilePath $edge -ArgumentList $arguments | Out-Null',
  ].join('; ')
  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 15_000 },
    )
    edgeStarted = true
    await delay(firstPage ? 1_500 : 500)
  } catch {
    process.stdout.write(
      `Edgeを自動起動できませんでした。次のURLをブラウザで開いてください。\n${parsed.href}\n\n`,
    )
  }
}

async function assertRequiredFiles() {
  const { access } = await import('node:fs/promises')
  const paths = [
    resolve(backendDirectory, 'artisan'),
    resolve(webDirectory, 'package.json'),
    ...(feeDelegationMode
      ? [
          resolve(feePayerDirectory, 'package.json'),
          resolve(feePayerDirectory, '.env'),
        ]
      : []),
  ]
  for (const path of paths) {
    try {
      await access(path)
    } catch {
      throw new Error(`Required live review file is unavailable: ${path}`)
    }
  }
}

function localFeePayerUrl(value) {
  if (!/^http:\/\/127\.0\.0\.1:\d{4,5}\/?$/.test(value)) {
    throw new Error('Invalid local LivT Fee Payer URL')
  }
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('Invalid local LivT Fee Payer URL')
  }
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !/^\d{4,5}$/.test(url.port) ||
    Number(url.port) < 1024 ||
    Number(url.port) > 65535 ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error('Invalid local LivT Fee Payer URL')
  }
  return url
}

async function assertInteractiveTerminal() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Live Kairos review requires an interactive terminal')
  }
}

async function assertPortsAvailable(ports) {
  for (const port of ports) await assertPortAvailable(port)
}

function assertPortAvailable(port) {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', () => {
      reject(new Error(`Port ${port} is already in use`))
    })
    server.listen(port, '127.0.0.1', () => {
      server.close((error) => {
        if (error) reject(error)
        else resolvePort()
      })
    })
  })
}

async function assertWindowsEdgeAvailable() {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "$paths = @('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'); if ($paths | Where-Object { Test-Path -LiteralPath $_ }) { 'ready' }",
      ],
      { timeout: 10_000, encoding: 'utf8' },
    )
    if (stdout.trim() !== 'ready') throw new Error('missing')
  } catch {
    throw new Error('Windows Microsoft Edge is unavailable')
  }
}

async function question(prompt) {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  })
  try {
    return (await readline.question(prompt)).trim()
  } finally {
    readline.close()
  }
}

async function waitForEnter(instructions) {
  await question(`${instructions}\n\n準備できたらEnter: `)
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

async function cleanup() {
  if (cleanupStarted) return
  cleanupStarted = true

  if (edgeStarted) await stopWindowsEdge()
  for (const { child } of children.reverse()) {
    if (child.exitCode === null && child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        // The local process may already have stopped.
      }
    }
  }
  await delay(200)
}

async function stopWindowsEdge() {
  const script = [
    `$matching = Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*${edgeProfileMarker}*' }`,
    '$matching | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
  ].join('; ')
  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 10_000 },
    )
  } catch {
    // The persistent profile is intentionally retained even if Edge has closed.
  }
}

function safeErrorMessage(error) {
  if (error instanceof Error) return error.message
  return 'Live Kairos review failed'
}
