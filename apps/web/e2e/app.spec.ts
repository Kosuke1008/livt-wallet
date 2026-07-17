import { expect, test, type Page } from '@playwright/test'
import { encodeFunctionResult, keccak256, type Hash, type Hex } from 'viem'
import { KAIROS_NETWORK } from '../src/blockchain/kairos'
import { erc20ReadAbi, erc20TransferAbi } from '../src/tokens/erc20Abi'
import { approvedJpycToken } from '../src/tokens/tokenRegistry'

const rpcUrlPattern = new RegExp(
  `^${KAIROS_NETWORK.rpcUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`,
)

interface MockKairosRpcOptions {
  nativeBalance?: bigint
  tokenBalance?: bigint
  refreshedNativeBalance?: bigint
  refreshedTokenBalance?: bigint
  failNative?: boolean
  failToken?: boolean
  chainId?: number
  simulationFails?: boolean
  receiptStatus?: 'success' | 'reverted'
}

interface MockKairosRpcState {
  chainChecks: number
  simulations: number
  broadcasts: number
  receiptReads: number
  nativeBalanceReads: number
  tokenBalanceReads: number
  transactionHash: Hash | null
}

async function mockKairosRpc(
  page: Page,
  options: MockKairosRpcOptions = {},
): Promise<MockKairosRpcState> {
  const {
    nativeBalance = 1_000_000_000_000_000_000n,
    tokenBalance = 9_000_000_000_000_000_000_000n,
    refreshedNativeBalance = 999_000_000_000_000_000n,
    refreshedTokenBalance = 8_999_000_000_000_000_000_000n,
    failNative = false,
    failToken = false,
    chainId = 1001,
    simulationFails = false,
    receiptStatus = 'success',
  } = options
  const state: MockKairosRpcState = {
    chainChecks: 0,
    simulations: 0,
    broadcasts: 0,
    receiptReads: 0,
    nativeBalanceReads: 0,
    tokenBalanceReads: 0,
    transactionHash: null,
  }
  const transactionSender = '0x0000000000000000000000000000000000000001'
  let transferConfirmed = false

  await page.route(rpcUrlPattern, async (route) => {
    const request = route.request().postDataJSON() as {
      id: number
      method: string
      params?: readonly unknown[]
    }
    const params = request.params ?? []
    if (request.method === 'eth_getBalance' && failNative) {
      await route.abort('connectionfailed')
      return
    }
    if (request.method !== 'eth_getBalance' && failToken) {
      await route.abort('connectionfailed')
      return
    }

    let result: unknown
    if (request.method === 'eth_getBalance') {
      const balance = transferConfirmed ? refreshedNativeBalance : nativeBalance
      state.nativeBalanceReads += 1
      result = `0x${balance.toString(16)}`
    } else if (request.method === 'eth_chainId') {
      state.chainChecks += 1
      result = `0x${chainId.toString(16)}`
    } else if (request.method === 'eth_getCode') {
      expect(String(params[0]).toLowerCase()).toBe(
        approvedJpycToken.contractAddress.toLowerCase(),
      )
      result = '0x6000'
    } else if (request.method === 'eth_call') {
      const call = params[0] as { data: string; from?: string; to: string }
      expect(call.to.toLowerCase()).toBe(
        approvedJpycToken.contractAddress.toLowerCase(),
      )
      if (call.data.startsWith('0x95d89b41')) {
        result = encodeFunctionResult({
          abi: erc20ReadAbi,
          functionName: 'symbol',
          result: 'JPYC',
        })
      } else if (call.data.startsWith('0x313ce567')) {
        result = encodeFunctionResult({
          abi: erc20ReadAbi,
          functionName: 'decimals',
          result: 18,
        })
      } else if (call.data.startsWith('0x70a08231')) {
        const balance = transferConfirmed ? refreshedTokenBalance : tokenBalance
        state.tokenBalanceReads += 1
        result = encodeFunctionResult({
          abi: erc20ReadAbi,
          functionName: 'balanceOf',
          result: balance,
        })
      } else {
        expect(call.data.startsWith('0xa9059cbb')).toBe(true)
        state.simulations += 1
        if (simulationFails) {
          await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: request.id,
              error: { code: 3, message: 'execution reverted' },
            }),
          })
          return
        }
        result = encodeFunctionResult({
          abi: erc20TransferAbi,
          functionName: 'transfer',
          result: true,
        })
      }
    } else if (request.method === 'eth_estimateGas') {
      result = '0xea60'
    } else if (request.method === 'eth_gasPrice') {
      result = '0x5d21dba00'
    } else if (request.method === 'eth_getTransactionCount') {
      expect(params[1]).toBe('pending')
      result = '0x0'
    } else if (request.method === 'eth_sendRawTransaction') {
      state.broadcasts += 1
      const serializedTransaction = params[0] as Hex
      state.transactionHash = keccak256(serializedTransaction)
      const input = params[0]
      expect(typeof input).toBe('string')
      result = state.transactionHash
    } else if (request.method === 'eth_getTransactionReceipt') {
      state.receiptReads += 1
      const transactionHash = params[0] as Hash
      expect(transactionHash).toBe(state.transactionHash)
      transferConfirmed = receiptStatus === 'success'
      result = {
        blockHash: `0x${'1'.repeat(64)}`,
        blockNumber: '0x1',
        contractAddress: null,
        cumulativeGasUsed: '0xea60',
        effectiveGasPrice: '0x5d21dba00',
        from: transactionSender,
        gasUsed: '0xea60',
        logs: [],
        logsBloom: `0x${'0'.repeat(512)}`,
        status: receiptStatus === 'success' ? '0x1' : '0x0',
        to: approvedJpycToken.contractAddress,
        transactionHash,
        transactionIndex: '0x0',
        type: '0x0',
      }
    } else {
      throw new Error(`Unexpected RPC method: ${request.method}`)
    }

    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result,
      }),
    })
  })
  return state
}

const transferPassword = 'e2e-transfer-password'
const transferRecipient = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

async function createAndUnlockWallet(page: Page): Promise<string> {
  await page.goto('/')
  await page.getByLabel('パスワード').fill(transferPassword)
  await page
    .getByRole('button', { name: 'ウォレットを作成して暗号化' })
    .click()
  await expect(page.getByLabel('JPYC残高値')).toBeVisible()
  const addressOutput = page.getByLabel('ウォレットアドレス値')
  return (
    (await addressOutput.getAttribute('title')) ??
    (await addressOutput.textContent()) ??
    ''
  )
}

async function openTransferReview(
  page: Page,
  recipient = transferRecipient,
  amount = '1',
): Promise<void> {
  await page.getByRole('button', { name: 'Send JPYC' }).click()
  await page.getByLabel('送り先アドレス').fill(recipient)
  await page.getByLabel('送るJPYCの数量').fill(amount)
  await page.getByRole('button', { name: '内容を確認' }).click()
}

async function confirmTransfer(page: Page): Promise<void> {
  await page.getByLabel('送金確認用パスワード').fill(transferPassword)
  await page.getByRole('button', { name: '確認して送る' }).click()
}

test('暗号化して保存し、再読み込み後に復号できる', async ({ page }) => {
  await mockKairosRpc(page)
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Wallet' })).toBeVisible()
  await expect(page.getByLabel('アクティブネットワーク')).toHaveText(
    KAIROS_NETWORK.name,
  )
  await expect(page.getByText(/Mainnet/i)).toHaveCount(0)
  await expect(page.locator('input[type="text"]')).toHaveCount(0)
  await page.getByLabel('パスワード').fill('e2e-test-password')
  await page
    .getByRole('button', { name: 'ウォレットを作成して暗号化' })
    .click()

  await expect(page.getByText('ウォレットアドレス')).toBeVisible()
  const addressOutput = page.getByLabel('ウォレットアドレス値')
  const originalAddress =
    (await addressOutput.getAttribute('title')) ??
    (await addressOutput.textContent())
  expect(originalAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
  await expect(page.getByLabel('KAIA残高値')).toHaveText('1 KAIA')
  await expect(page.getByLabel('JPYC残高値')).toHaveText('9000 JPYC')

  await page.reload()
  await expect(page.getByRole('button', { name: 'ウォレットを解除' })).toBeVisible()
  await expect(page.getByLabel('ウォレットアドレス値')).not.toBeVisible()
  await page.getByLabel('パスワード').fill('wrong-password')
  await page.getByRole('button', { name: 'ウォレットを解除' }).click()
  await expect(page.getByRole('alert')).toHaveText('パスワードが正しくありません')

  await page.getByLabel('パスワード').fill('e2e-test-password')
  await page.getByRole('button', { name: 'ウォレットを解除' }).click()
  await expect(page.getByLabel('ウォレットアドレス値')).toHaveAttribute(
    'title',
    originalAddress ?? '',
  )
  await expect(page.getByLabel('KAIA残高値')).toHaveText('1 KAIA')
  await expect(page.getByLabel('JPYC残高値')).toHaveText('9000 JPYC')
})

test('Kairos RPC障害を表示して再試行できる', async ({ page }) => {
  await mockKairosRpc(page, { failNative: true })
  await page.goto('/')
  await page.getByLabel('パスワード').fill('e2e-test-password')
  await page
    .getByRole('button', { name: 'ウォレットを作成して暗号化' })
    .click()

  await expect(page.getByRole('alert')).toHaveText(
    'Kairos RPCに接続できませんでした',
  )
  await expect(page.getByRole('button', { name: '再試行' })).toBeVisible()
  await expect(page.getByLabel('JPYC残高値')).toHaveText('9000 JPYC')
  await expect(page.getByText(/Mainnet/i)).toHaveCount(0)
})

test('zero JPYC balanceを0として表示する', async ({ page }) => {
  await mockKairosRpc(page, { tokenBalance: 0n })
  await page.goto('/')
  await page.getByLabel('パスワード').fill('e2e-test-password')
  await page
    .getByRole('button', { name: 'ウォレットを作成して暗号化' })
    .click()

  await expect(page.getByLabel('KAIA残高値')).toHaveText('1 KAIA')
  await expect(page.getByLabel('JPYC残高値')).toHaveText('0 JPYC')
})

test('JPYC RPC障害をnative KAIAと独立して再試行表示する', async ({ page }) => {
  await mockKairosRpc(page, { failToken: true })
  await page.goto('/')
  await page.getByLabel('パスワード').fill('e2e-test-password')
  await page
    .getByRole('button', { name: 'ウォレットを作成して暗号化' })
    .click()

  await expect(page.getByLabel('KAIA残高値')).toHaveText('1 KAIA')
  await expect(page.getByRole('alert')).toHaveText(
    'JPYC残高の取得中にKairos RPCへ接続できませんでした',
  )
  await expect(page.getByRole('button', { name: 'JPYCを再試行' })).toBeVisible()
  await expect(page.locator('input[type="text"]')).toHaveCount(0)
  await expect(page.getByText(/Mainnet/i)).toHaveCount(0)
})

test('手動JPYC送金を確認後に一度だけ送信し成功後の残高を更新する', async ({
  page,
}) => {
  const rpc = await mockKairosRpc(page)
  const sender = await createAndUnlockWallet(page)

  await openTransferReview(page, transferRecipient.toLowerCase(), '1.2500')
  const review = page.getByRole('region', { name: 'JPYC送金内容' })
  await expect(review).toBeVisible()
  await expect(review.getByText(KAIROS_NETWORK.name, { exact: true })).toBeVisible()
  await expect(review.getByText('1001', { exact: true })).toBeVisible()
  await expect(review.getByText(approvedJpycToken.contractAddress)).toBeVisible()
  await expect(review.getByText(sender, { exact: true })).toBeVisible()
  await expect(review.getByText(transferRecipient, { exact: true })).toBeVisible()
  await expect(review.getByText('1.2500 JPYC', { exact: true })).toBeVisible()
  await expect(review.getByText('1.25 JPYC', { exact: true })).toBeVisible()

  await confirmTransfer(page)

  await expect(page.getByRole('heading', { name: '送金が確定しました' })).toBeVisible()
  await expect(page.getByText('状態: 確定済み')).toBeVisible()
  const explorerLink = page.getByRole('link', { name: 'Kaiascanで確認' })
  await expect(explorerLink).toHaveAttribute(
    'href',
    `${KAIROS_NETWORK.blockExplorerUrl}/tx/${rpc.transactionHash}`,
  )
  await page.getByRole('button', { name: 'Back to wallet' }).click()
  await expect(page.getByLabel('KAIA残高値')).toHaveText('0.999 KAIA')
  await expect(page.getByLabel('JPYC残高値')).toHaveText('8999 JPYC')
  expect(rpc.broadcasts).toBe(1)
  expect(rpc.receiptReads).toBe(1)
  expect(rpc.nativeBalanceReads).toBeGreaterThanOrEqual(3)
  expect(rpc.tokenBalanceReads).toBe(2)
})

test('不正な送り先を確認画面へ進めずtransaction RPCを呼ばない', async ({
  page,
}) => {
  const rpc = await mockKairosRpc(page)
  await createAndUnlockWallet(page)

  await openTransferReview(page, '0x1234', '1')

  await expect(page.getByRole('alert')).toHaveText(
    '正しいEVMアドレスを入力してください。',
  )
  await expect(page.getByRole('heading', { name: 'JPYC送金内容' })).toHaveCount(0)
  expect(rpc.chainChecks).toBe(0)
  expect(rpc.simulations).toBe(0)
  expect(rpc.broadcasts).toBe(0)
})

test('数量0を確認画面へ進めずtransaction RPCを呼ばない', async ({ page }) => {
  const rpc = await mockKairosRpc(page)
  await createAndUnlockWallet(page)

  await openTransferReview(page, transferRecipient, '0')

  await expect(page.getByRole('alert')).toHaveText(
    '0より大きい数量を入力してください。',
  )
  await expect(page.getByRole('heading', { name: 'JPYC送金内容' })).toHaveCount(0)
  expect(rpc.chainChecks).toBe(0)
  expect(rpc.simulations).toBe(0)
  expect(rpc.broadcasts).toBe(0)
})

test('wrong chainではsimulation、signing、broadcast前に停止する', async ({ page }) => {
  const rpc = await mockKairosRpc(page, { chainId: 8217 })
  await createAndUnlockWallet(page)
  await openTransferReview(page)
  await confirmTransfer(page)

  await expect(page.getByRole('alert')).toHaveText(
    '接続先がKaia Kairos（番号1001）ではないため送信を止めました。',
  )
  expect(rpc.chainChecks).toBe(1)
  expect(rpc.simulations).toBe(0)
  expect(rpc.broadcasts).toBe(0)
})

test('simulation失敗ではbroadcastせず制御されたmessageを表示する', async ({
  page,
}) => {
  const rpc = await mockKairosRpc(page, { simulationFails: true })
  await createAndUnlockWallet(page)
  await openTransferReview(page)
  await confirmTransfer(page)

  await expect(page.getByRole('alert')).toHaveText(
    'JPYC送金の事前実行に失敗しました。残高と送り先を確認してください。',
  )
  expect(rpc.simulations).toBe(1)
  expect(rpc.broadcasts).toBe(0)
})

test('reverted receiptを成功表示せず自動再送しない', async ({ page }) => {
  const rpc = await mockKairosRpc(page, { receiptStatus: 'reverted' })
  await createAndUnlockWallet(page)
  await openTransferReview(page)
  await confirmTransfer(page)

  await expect(
    page.getByRole('heading', { name: '送金処理は取り消されました' }),
  ).toBeVisible()
  await expect(page.getByText('状態: 取り消し')).toBeVisible()
  await expect(page.getByRole('heading', { name: '送金が確定しました' })).toHaveCount(0)
  expect(rpc.broadcasts).toBe(1)
  expect(rpc.receiptReads).toBe(1)
  expect(rpc.tokenBalanceReads).toBe(1)
})

test('確認buttonの連続操作でもbroadcastは一度だけ', async ({ page }) => {
  const rpc = await mockKairosRpc(page)
  await createAndUnlockWallet(page)
  await openTransferReview(page)
  await page.getByLabel('送金確認用パスワード').fill(transferPassword)

  await page.getByRole('button', { name: '確認して送る' }).evaluate((button) => {
    const confirmationButton = button as HTMLButtonElement
    confirmationButton.click()
    confirmationButton.click()
  })

  await expect(page.getByRole('heading', { name: '送金が確定しました' })).toBeVisible()
  expect(rpc.broadcasts).toBe(1)
})

test('ホームはJPYCを主要残高として表示し、受取・送金・設定へ移動できる', async ({
  page,
}) => {
  await mockKairosRpc(page)
  const address = await createAndUnlockWallet(page)

  await expect(page.getByRole('heading', { name: 'LivT Wallet' })).toBeVisible()
  await expect(page.getByLabel('JPYC残高値')).toHaveText('9000 JPYC')
  await expect(page.getByLabel('ウォレットアドレス値')).toHaveAttribute(
    'title',
    address,
  )
  await expect(page.getByLabel('ウォレットアドレス値')).toHaveText(
    /^0x[a-fA-F0-9]+…[a-fA-F0-9]+$/,
  )
  await expect(page.getByLabel('KAIA残高値')).toHaveText('1 KAIA')
  await expect(page.getByRole('button', { name: 'Receive JPYC' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send JPYC' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy address' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open settings' })).toBeVisible()
})

test('アドレス複写は完全な公開アドレスだけをコピーし成功を通知する', async ({
  context,
  page,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await mockKairosRpc(page)
  const address = await createAndUnlockWallet(page)

  await page.getByRole('button', { name: 'Copy address' }).click()

  await expect(
    page.getByText('アドレスをコピーしました', { exact: true }),
  ).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(address)
})

test('受取画面は完全なアドレスとKairosの情報を表示しホームに戻れる', async ({
  page,
}) => {
  await mockKairosRpc(page)
  const address = await createAndUnlockWallet(page)

  await page.getByRole('button', { name: 'Receive JPYC' }).click()

  const receiveView = page.getByRole('region', { name: 'JPYCを受け取る' })
  await expect(receiveView.getByRole('heading', { name: 'JPYCを受け取る' })).toBeVisible()
  await expect(receiveView.getByText(address, { exact: true })).toBeVisible()
  await expect(
    receiveView.getByText(KAIROS_NETWORK.name, { exact: true }),
  ).toBeVisible()
  await expect(receiveView.getByText('1001', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Back to wallet' }).click()
  await expect(page.getByRole('button', { name: 'Receive JPYC' })).toBeVisible()
})

test('送金画面は既存フォームを開き、未送信のままホームに戻れる', async ({
  page,
}) => {
  const rpc = await mockKairosRpc(page)
  await createAndUnlockWallet(page)
  const nativeBalanceReads = rpc.nativeBalanceReads
  const tokenBalanceReads = rpc.tokenBalanceReads

  await openTransferReview(page)
  await page.getByLabel('送金確認用パスワード').fill(transferPassword)
  await page.getByRole('button', { name: 'Back to wallet' }).click()

  await expect(page.getByRole('button', { name: 'Send JPYC' })).toBeVisible()
  await page.getByRole('button', { name: 'Send JPYC' }).click()
  await expect(page.getByLabel('送り先アドレス')).toHaveValue('')
  await expect(page.getByLabel('送金確認用パスワード')).toHaveCount(0)
  await page.getByRole('button', { name: 'Back to wallet' }).click()
  expect(rpc.chainChecks).toBe(0)
  expect(rpc.simulations).toBe(0)
  expect(rpc.broadcasts).toBe(0)
  expect(rpc.nativeBalanceReads).toBe(nativeBalanceReads)
  expect(rpc.tokenBalanceReads).toBe(tokenBalanceReads)
})

test('設定画面はKairosの読み取り情報だけを表示しホームに戻れる', async ({
  page,
}) => {
  await mockKairosRpc(page)
  await createAndUnlockWallet(page)

  await page.getByRole('button', { name: 'Open settings' }).click()

  const settingsView = page.getByRole('region', { name: '設定' })
  await expect(settingsView.getByRole('heading', { name: '設定' })).toBeVisible()
  await expect(
    settingsView.getByText(KAIROS_NETWORK.name, { exact: true }),
  ).toBeVisible()
  await expect(settingsView.getByText('1001', { exact: true })).toBeVisible()
  await expect(page.getByText(/Mainnet/i)).toHaveCount(0)
  await expect(page.locator('input')).toHaveCount(0)
  await page.getByRole('button', { name: 'Back to wallet' }).click()
  await expect(page.getByRole('button', { name: 'Open settings' })).toBeVisible()
})

test('携帯幅でも主要操作が収まり各画面とホームを往復できる', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await mockKairosRpc(page)
  await createAndUnlockWallet(page)

  for (const action of [
    'Copy address',
    'Receive JPYC',
    'Send JPYC',
    'Open settings',
  ]) {
    await expect(page.getByRole('button', { name: action })).toBeVisible()
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)

  await page.getByRole('button', { name: 'Receive JPYC' }).click()
  await page.getByRole('button', { name: 'Back to wallet' }).click()
  await page.getByRole('button', { name: 'Send JPYC' }).click()
  await page.getByRole('button', { name: 'Back to wallet' }).click()
  await page.getByRole('button', { name: 'Open settings' }).click()
  await page.getByRole('button', { name: 'Back to wallet' }).click()
  await expect(page.getByLabel('JPYC残高値')).toBeVisible()
})
