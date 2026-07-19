import { execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const supportDirectory = dirname(fileURLToPath(import.meta.url))
const webDirectory = resolve(supportDirectory, '../../..')
const walletDirectory = resolve(webDirectory, '../..')
const defaultBackendDirectory = resolve(walletDirectory, '../jpyc-web3-payment-platform')
const backendDirectory = resolveBackendDirectory(
  process.env.LIVT_E2E_BACKEND_DIRECTORY,
)
const databaseName = 'livt_payment_browser_e2e'
const childProcesses = []
let temporaryDirectory = null
let databaseSocket = null
let cleanupStarted = false
let edgeReviewProfileName = null

const mode = parseMode(process.argv.slice(2))

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
  if (mode === 'edge-review') await assertEdgeReviewAvailable()

  const [rpcPort, backendPort, walletPort] = await reservePorts(3)
  const rpcUrl = `http://127.0.0.1:${rpcPort}`
  const backendUrl = `http://127.0.0.1:${backendPort}`
  const walletUrl = `http://127.0.0.1:${walletPort}`
  const reviewCredentials =
    mode === 'edge-review' ? await readEdgeReviewCredentials() : null
  const userPassword = reviewCredentials?.userPassword ?? randomSecret()
  const walletPassword = reviewCredentials?.walletPassword ?? randomSecret()

  temporaryDirectory = await mkdtemp(
    resolve(tmpdir(), 'livt-payment-browser-e2e-'),
  )
  const databaseDirectory = resolve(temporaryDirectory, 'mysql')
  databaseSocket = resolve(temporaryDirectory, 'mysql.sock')
  const databaseLog = resolve(temporaryDirectory, 'mysql.log')
  const databasePid = resolve(temporaryDirectory, 'mysql.pid')
  await mkdir(databaseDirectory, { mode: 0o700 })

  const sharedEnvironment = {
    ...process.env,
    APP_ENV: 'e2e',
    APP_DEBUG: 'false',
    APP_KEY: `base64:${randomBytes(32).toString('base64')}`,
    APP_URL: backendUrl,
    DB_CONNECTION: 'mysql',
    DB_HOST: 'localhost',
    DB_PORT: '3306',
    DB_DATABASE: databaseName,
    DB_USERNAME: 'root',
    DB_PASSWORD: '',
    DB_SOCKET: databaseSocket,
    CACHE_STORE: 'array',
    SESSION_DRIVER: 'array',
    QUEUE_CONNECTION: 'sync',
    LOG_CHANNEL: 'stderr',
    LOG_LEVEL: 'warning',
    WEB3_NETWORK: 'kairos',
    WEB3_CHAIN_NAME: 'Kaia Kairos',
    WEB3_TOKEN_SYMBOL: 'JPYC',
    WEB3_TOKEN_DECIMALS: '18',
    KAIROS_RPC_URL: rpcUrl,
    KAIROS_CHAIN_ID: '1001',
    KAIROS_ERC20_CONTRACT_ADDRESS:
      '0xe7c3d8c9a439fede00d2600032d5db0be71c3c29',
    LIVT_WALLET_URL: walletUrl,
    LIVT_PAYMENT_TOKEN_EXPIRATION_MINUTES: '30',
    LIVT_E2E_USER_PASSWORD: userPassword,
    LIVT_E2E_WALLET_PASSWORD: walletPassword,
    LIVT_E2E_BACKEND_DIRECTORY: backendDirectory,
    LIVT_E2E_BACKEND_URL: backendUrl,
    LIVT_E2E_WALLET_URL: walletUrl,
    LIVT_E2E_RPC_URL: rpcUrl,
    LIVT_E2E_DB_SOCKET: databaseSocket,
    LIVT_E2E_DB_NAME: databaseName,
  }

  process.stdout.write('Payment browser E2E: isolated databaseを準備中…\n')
  await runCommand(
    'mysqld',
    [
      '--no-defaults',
      '--initialize-insecure',
      `--datadir=${databaseDirectory}`,
      `--log-error=${databaseLog}`,
    ],
    { cwd: temporaryDirectory },
  )

  startService(
    'mysqld',
    [
      '--no-defaults',
      `--datadir=${databaseDirectory}`,
      `--socket=${databaseSocket}`,
      `--pid-file=${databasePid}`,
      `--log-error=${databaseLog}`,
      '--skip-networking',
      '--mysqlx=0',
    ],
    { cwd: temporaryDirectory },
    'MySQL',
  )
  await waitForMysql(databaseSocket)
  await runCommand(
    'mysql',
    [
      '--no-defaults',
      '--protocol=socket',
      `--socket=${databaseSocket}`,
      '--user=root',
      '--execute',
      `CREATE DATABASE ${databaseName} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    ],
    { cwd: temporaryDirectory },
  )

  process.stdout.write('Payment browser E2E: migrationとfixtureを準備中…\n')
  await runCommand(
    'php',
    ['artisan', 'migrate', '--force', '--no-interaction'],
    { cwd: backendDirectory, env: sharedEnvironment },
  )
  await seedBackend(sharedEnvironment)

  startService(
    process.execPath,
    [resolve(supportDirectory, 'kairos-rpc-stub.mjs')],
    {
      cwd: webDirectory,
      env: { ...sharedEnvironment, LIVT_E2E_RPC_PORT: String(rpcPort) },
    },
    'RPC stub',
  )
  await waitForHttp(`${rpcUrl}/health`)

  startService(
    'php',
    [
      'artisan',
      'serve',
      '--host=127.0.0.1',
      `--port=${backendPort}`,
      '--no-reload',
    ],
    { cwd: backendDirectory, env: sharedEnvironment },
    'Laravel',
  )
  await waitForHttp(`${backendUrl}/up`)

  startService(
    'corepack',
    [
      'pnpm',
      'exec',
      'vite',
      '--host',
      '127.0.0.1',
      '--port',
      String(walletPort),
      '--strictPort',
    ],
    {
      cwd: webDirectory,
      env: {
        ...sharedEnvironment,
        VITE_LIVT_API_BASE_URL: backendUrl,
        VITE_KAIROS_RPC_URL: rpcUrl,
      },
    },
    'LivT Wallet',
  )
  await waitForHttp(walletUrl)

  if (mode === 'edge-review') {
    await runEdgeReview({
      backendUrl,
      rpcUrl,
      environment: sharedEnvironment,
    })
    return
  }

  process.stdout.write(
    `Payment browser E2E: ${backendUrl}/pay/910001 から検証を開始します。\n`,
  )
  const playwrightArguments = [
    'pnpm',
    'exec',
    'playwright',
    'test',
    '--config=playwright.payment.config.ts',
  ]
  if (mode === 'headed') playwrightArguments.push('--headed')
  if (mode === 'ui') playwrightArguments.push('--ui')

  await runInteractiveCommand('corepack', playwrightArguments, {
    cwd: webDirectory,
    env: sharedEnvironment,
  })
}

async function runEdgeReview({ backendUrl, rpcUrl, environment }) {
  edgeReviewProfileName = `livt-payment-edge-review-${randomBytes(8).toString('hex')}`

  process.stdout.write(
    [
      '',
      'Microsoft Edge手動レビューを開始します。',
      'Edgeは専用の一時profileで開き、DevToolsも自動で表示します。',
      '入力したtest用パスワードはterminal・browser artifactへ出力しません。',
      '中止する場合はterminalでCtrl+Cを押してください。',
      '',
    ].join('\n'),
  )

  await resetRpcStub(rpcUrl, 'happy')
  await openWindowsEdgeReviewPage(
    new URL('/pay/910001', backendUrl).href,
    edgeReviewProfileName,
    true,
  )
  await waitForReviewCheckpoint(
    [
      '[正常系 1/3]',
      'Laravel画面でMetaMask導線とLivT Wallet導線を確認してください。',
      'Walletへ進み、先ほど入力したtest用パスワードでWallet作成・LivTログイン・送金を行います。',
      '「お支払いが確認されました」まで進んだらterminalへ戻り、Enterを押してください。',
    ].join('\n'),
    async () => {
      const state = await readEdgeReviewState(910001, rpcUrl)
      return state.paymentStatus === 'confirmed' &&
        state.broadcasts === 1 &&
        state.backendReceiptReads >= 1
    },
  )
  process.stdout.write('正常系: confirmed、broadcast 1回を確認しました。\n\n')

  await seedBackend(environment)
  await resetRpcStub(rpcUrl, 'receipt-pending-once')
  await openWindowsEdgeReviewPage(
    new URL('/pay/910002', backendUrl).href,
    edgeReviewProfileName,
    false,
  )
  const recoveryAlreadyConfirmed = await waitForRecoveryPendingCheckpoint(rpcUrl)

  if (!recoveryAlreadyConfirmed) {
    await waitForReviewCheckpoint(
      [
        '[receipt回復 2/3: 確認だけ再試行]',
        'EdgeでWallet画面をreloadし、Walletを解除してください。',
        '保存済みtxHashが表示されることを確認し、「送金せず確認だけ再試行」を押します。',
        '決済確定後にterminalへ戻り、Enterを押してください。',
      ].join('\n'),
      async () => {
        const state = await readEdgeReviewState(910002, rpcUrl)
        return state.paymentStatus === 'confirmed' &&
          state.broadcasts === 1 &&
          state.backendReceiptReads === 11
      },
    )
  }
  process.stdout.write(
    'receipt回復: transactionを再送せずconfirmedになったことを確認しました。\n\n',
  )

  await seedBackend(environment)
  await resetRpcStub(rpcUrl, 'happy')
  await openWindowsEdgeReviewPage(
    new URL('/pay/910003', backendUrl).href,
    edgeReviewProfileName,
    false,
  )
  await waitForReviewCheckpoint(
    [
      '[期限切れ 3/3]',
      'LivT Walletへ進み、必要ならWalletを解除してください。',
      '「この決済は期限切れです」と表示され、ログイン・署名・送信へ進めないことを確認します。',
      '確認後にterminalへ戻り、Enterを押してください。',
    ].join('\n'),
    async () => {
      const state = await readEdgeReviewState(910003, rpcUrl)
      return state.paymentStatus === 'pending' &&
        state.broadcasts === 0 &&
        state.simulations === 0
    },
  )
  process.stdout.write(
    '期限切れ: pendingのままsimulation・broadcastとも0回です。\nEdge手動レビューが完了しました。\n',
  )
}

async function waitForRecoveryPendingCheckpoint(rpcUrl) {
  while (true) {
    await waitForEnter(
      [
        '[receipt回復 2/3: pending]',
        'Walletを解除してLivTへログインし、JPYCを送信してください。',
        '「LivTでの確認待ちです」が表示された時点で止め、terminalへ戻ってEnterを押してください。',
      ].join('\n'),
    )
    const state = await readEdgeReviewState(910002, rpcUrl)
    if (state.broadcasts > 1) {
      throw new Error('Recovery review detected more than one broadcast')
    }
    if (state.paymentStatus === 'confirmed' && state.broadcasts === 1) {
      return true
    }
    if (
      state.paymentStatus === 'pending' &&
      state.broadcasts === 1 &&
      state.backendReceiptReads === 10
    ) {
      process.stdout.write(
        'pending、broadcast 1回、backend receipt retry 10回を確認しました。\n\n',
      )
      return false
    }
    process.stdout.write(
      'checkpoint条件がまだ揃っていません。Edgeで操作を続けてください。\n\n',
    )
  }
}

async function waitForReviewCheckpoint(instructions, verify) {
  while (true) {
    await waitForEnter(instructions)
    if (await verify()) return
    process.stdout.write(
      'checkpoint条件がまだ揃っていません。Edgeで操作を続けてください。\n\n',
    )
  }
}

async function readEdgeReviewState(paymentId, rpcUrl) {
  if (!Number.isSafeInteger(paymentId) || paymentId <= 0) {
    throw new Error('Invalid review payment identifier')
  }

  const { stdout } = await execFileAsync(
    'mysql',
    [
      '--no-defaults',
      '--protocol=socket',
      `--socket=${databaseSocket}`,
      '--user=root',
      '--batch',
      '--skip-column-names',
      databaseName,
      '--execute',
      `SELECT status FROM payments WHERE id = ${paymentId}`,
    ],
    { timeout: 5_000, encoding: 'utf8' },
  )
  const paymentStatus = stdout.trim()
  if (!['pending', 'confirmed', 'failed'].includes(paymentStatus)) {
    throw new Error('Invalid review payment state')
  }

  const response = await fetch(new URL('/control/state', rpcUrl))
  if (!response.ok) throw new Error('Could not read review RPC state')
  const rpcState = await response.json()
  for (const key of ['broadcasts', 'simulations', 'backendReceiptReads']) {
    if (!Number.isSafeInteger(rpcState?.[key]) || rpcState[key] < 0) {
      throw new Error('Invalid review RPC state')
    }
  }

  return {
    paymentStatus,
    broadcasts: rpcState.broadcasts,
    simulations: rpcState.simulations,
    backendReceiptReads: rpcState.backendReceiptReads,
  }
}

async function resetRpcStub(rpcUrl, scenario) {
  const response = await fetch(new URL('/control/reset', rpcUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario }),
  })
  if (!response.ok) throw new Error('Could not prepare review RPC scenario')
}

async function openWindowsEdgeReviewPage(url, profileName, firstPage) {
  assertSafeEdgeReviewProfileName(profileName)
  const parsedUrl = new URL(url)
  if (parsedUrl.protocol !== 'http:' || parsedUrl.hostname !== '127.0.0.1') {
    throw new Error('Unsafe Edge review URL')
  }

  const windowArgument = firstPage ? '--new-window' : '--new-tab'
  const script = [
    `$profile = Join-Path $env:TEMP '${profileName}'`,
    "$candidates = @('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe')",
    '$edge = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1',
    "if ($null -eq $edge) { throw 'Microsoft Edge is unavailable' }",
    `$response = Invoke-WebRequest -Uri '${parsedUrl.href}' -UseBasicParsing -TimeoutSec 5`,
    "if ($response.StatusCode -ne 200) { throw 'WSL review URL is unavailable' }",
    `$arguments = @('--user-data-dir="' + $profile + '"', '--no-first-run', '--no-default-browser-check', '--disable-features=msEdgeFirstRunExperience', '--auto-open-devtools-for-tabs', '${windowArgument}', '${parsedUrl.href}')`,
    'Start-Process -FilePath $edge -ArgumentList $arguments | Out-Null',
  ].join('; ')

  await runCommand(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { timeout: 15_000 },
  )
  await delay(firstPage ? 1_500 : 500)
}

async function assertEdgeReviewAvailable() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Edge review requires an interactive terminal')
  }
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

async function readEdgeReviewCredentials() {
  process.stdout.write(
    'Edge review専用のtest用パスワードを入力してください（16文字以上、入力内容は表示されません）。\n',
  )
  const userPassword = await readHiddenSecret('LivT review user password: ')
  const walletPassword = await readHiddenSecret('Wallet review password: ')
  return { userPassword, walletPassword }
}

async function readHiddenSecret(prompt) {
  while (true) {
    const secret = await readHiddenLine(prompt)
    if (secret.length >= 16 && secret.length <= 128) return secret
    process.stdout.write('16文字以上128文字以下で入力してください。\n')
  }
}

function readHiddenLine(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Hidden input requires an interactive terminal')
  }

  process.stdout.write(prompt)
  process.stdin.setRawMode(true)
  process.stdin.resume()

  return new Promise((resolveSecret, reject) => {
    let secret = ''
    let settled = false

    const finish = (error) => {
      if (settled) return
      settled = true
      process.stdin.off('data', onData)
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdout.write('\n')
      if (error === null) resolveSecret(secret)
      else reject(error)
    }

    const onData = (chunk) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') {
          finish(new Error('Edge review was cancelled'))
          return
        }
        if (character === '\r' || character === '\n') {
          finish(null)
          return
        }
        if (character === '\u007f' || character === '\b') {
          secret = secret.slice(0, -1)
        } else if (character >= ' ' && character !== '\u007f') {
          secret += character
        }
      }
    }

    process.stdin.on('data', onData)
  })
}

async function waitForEnter(instructions) {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  })
  try {
    await readline.question(`${instructions}\n\n準備できたらEnter: `)
  } finally {
    readline.close()
  }
}

async function seedBackend(environment) {
  await runCommand(
    'php',
    [
      'artisan',
      'db:seed',
      '--class=Database\\Seeders\\PaymentBrowserTestSeeder',
      '--force',
      '--no-interaction',
    ],
    { cwd: backendDirectory, env: environment },
  )
}

function startService(command, arguments_, options, label) {
  const child = spawn(command, arguments_, {
    ...options,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const record = { child, label, output: '' }
  childProcesses.push(record)

  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8')
    stream.on('data', (chunk) => {
      record.output = `${record.output}${chunk}`.slice(-8_000)
    })
  }

  child.on('exit', (code, signal) => {
    if (!cleanupStarted && code !== null && code !== 0) {
      process.stderr.write(
        `${label} exited unexpectedly (${code ?? signal ?? 'unknown'}).\n`,
      )
    }
  })

  return child
}

async function runCommand(command, arguments_, options = {}) {
  try {
    await execFileAsync(command, arguments_, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120_000,
      ...options,
    })
  } catch (error) {
    if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      throw new Error(`E2E command produced too much output: ${command}`)
    }
    throw new Error(`E2E command failed: ${command}`, { cause: error })
  }
}

function runInteractiveCommand(command, arguments_, options = {}) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(command, arguments_, {
      ...options,
      detached: true,
      stdio: 'inherit',
    })
    childProcesses.push({ child, label: 'Playwright', output: '' })
    child.once('error', () => reject(new Error(`Could not start ${command}`)))
    child.once('exit', (code, signal) => {
      if (code === 0) resolveCommand()
      else {
        reject(
          new Error(
            `Payment browser tests failed (${code ?? signal ?? 'unknown'})`,
          ),
        )
      }
    })
  })
}

async function waitForMysql(socket) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      await execFileAsync(
        'mysqladmin',
        [
          '--no-defaults',
          '--protocol=socket',
          `--socket=${socket}`,
          '--user=root',
          'ping',
        ],
        { timeout: 2_000 },
      )
      return
    } catch {
      await delay(150)
    }
  }
  throw new Error('Isolated MySQL did not become ready')
}

async function waitForHttp(url) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) return
    } catch {
      // The local process may still be starting.
    }
    await delay(150)
  }

  const failedService = childProcesses.find(
    ({ child }) => child.exitCode !== null,
  )
  if (failedService !== undefined) {
    throw new Error(`${failedService.label} did not start successfully`)
  }
  throw new Error(`Local E2E service did not become ready: ${new URL(url).origin}`)
}

async function reservePorts(count) {
  const ports = []
  for (let index = 0; index < count; index += 1) {
    ports.push(await reservePort())
  }
  return ports
}

function reservePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('Could not reserve a local port'))
        return
      }
      const { port } = address
      server.close((error) => {
        if (error) reject(error)
        else resolvePort(port)
      })
    })
  })
}

async function assertRequiredFiles() {
  for (const path of [
    resolve(backendDirectory, 'artisan'),
    resolve(backendDirectory, 'database/seeders/PaymentBrowserTestSeeder.php'),
    resolve(webDirectory, 'playwright.payment.config.ts'),
  ]) {
    try {
      await readFile(path, { encoding: 'utf8' })
    } catch {
      throw new Error(`Payment browser E2E required file is unavailable: ${path}`)
    }
  }
}

function resolveBackendDirectory(configuredDirectory) {
  if (configuredDirectory === undefined || configuredDirectory === '') {
    return defaultBackendDirectory
  }
  if (!configuredDirectory.startsWith('/')) {
    throw new Error('LIVT_E2E_BACKEND_DIRECTORY must be absolute')
  }
  return resolve(configuredDirectory)
}

function parseMode(arguments_) {
  if (arguments_.length === 0) return 'headless'
  if (arguments_.length === 1 && arguments_[0] === '--headed') return 'headed'
  if (arguments_.length === 1 && arguments_[0] === '--ui') return 'ui'
  if (arguments_.length === 1 && arguments_[0] === '--edge-review') {
    return 'edge-review'
  }
  throw new Error('Use no option, --headed, --ui, or --edge-review')
}

function randomSecret() {
  return randomBytes(24).toString('base64url')
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

async function cleanup() {
  if (cleanupStarted) return
  cleanupStarted = true

  if (process.stdin.isTTY && process.stdin.isRaw) {
    process.stdin.setRawMode(false)
  }

  if (edgeReviewProfileName !== null) {
    await cleanupWindowsEdgeReview(edgeReviewProfileName)
  }

  if (databaseSocket !== null) {
    try {
      await execFileAsync(
        'mysqladmin',
        [
          '--no-defaults',
          '--protocol=socket',
          `--socket=${databaseSocket}`,
          '--user=root',
          'shutdown',
        ],
        { timeout: 5_000 },
      )
    } catch {
      // A failed or already stopped database is handled by the process cleanup.
    }
  }

  for (const { child } of childProcesses.reverse()) {
    if (child.exitCode === null && child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        // The process may have exited between the status check and signal.
      }
    }
  }

  await delay(200)
  if (temporaryDirectory !== null) {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

async function cleanupWindowsEdgeReview(profileName) {
  assertSafeEdgeReviewProfileName(profileName)
  const script = [
    `$profile = Join-Path $env:TEMP '${profileName}'`,
    `$matching = Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like ('*${profileName}*') }`,
    '$matching | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
    'Start-Sleep -Milliseconds 300',
    'if (Test-Path -LiteralPath $profile) { Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue }',
  ].join('; ')
  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 15_000 },
    )
  } catch {
    // Cleanup remains scoped to the generated review profile.
  }
}

function assertSafeEdgeReviewProfileName(profileName) {
  if (!/^livt-payment-edge-review-[0-9a-f]{16}$/.test(profileName)) {
    throw new Error('Unsafe Edge review profile name')
  }
}

function safeErrorMessage(error) {
  if (error instanceof Error) return error.message
  return 'Payment browser E2E failed'
}
