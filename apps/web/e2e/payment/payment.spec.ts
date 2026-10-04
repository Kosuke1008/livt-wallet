import { expect, test, type Page } from '@playwright/test'
import {
  browserEnvironment,
  paymentFixtures,
  readPaymentState,
  readRpcState,
  resetBackendFixtures,
  resetRpcScenario,
} from './support/environment'

test.beforeEach(async () => {
  resetBackendFixtures()
  await resetRpcScenario('happy')
})

test('Laravelの支払画面からWalletで送金し、backend検証で決済を確定する', async ({
  page,
}) => {
  await openPaymentAndCreateWallet(page, paymentFixtures.happyPaymentId)
  await expectAuthoritativePaymentDetails(page)
  await loginToLivt(page)

  await page
    .getByLabel('送金確認用Walletパスワード')
    .fill(browserEnvironment.walletPassword)
  await page.getByRole('button', { name: '内容を確認してJPYCを送る' }).click()

  await expect(
    page.getByRole('heading', { name: 'お支払いが確認されました' }),
  ).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('LivTで決済が確認されました。')).toBeVisible()

  const state = readPaymentState(paymentFixtures.happyPaymentId)
  expect(state.status).toBe('confirmed')
  expect(state.transactionHash).toMatch(/^0x[0-9a-f]{64}$/)
  expect(state.userId).toBe(910001)
  expect(state.hasPaidAt).toBe(true)

  const rpc = await readRpcState()
  expect(rpc.broadcasts).toBe(1)
  expect(rpc.backendReceiptReads).toBe(1)
  expect(rpc.lastTransfer).toEqual({
    recipient: checksumRecipient,
    amount: paymentFixtures.atomicAmount,
  })
})

test('receipt未反映時は再送せず、reload後に保存済みtxHashだけを再確認する', async ({
  page,
}) => {
  await resetRpcScenario('receipt-pending-once')
  await openPaymentAndCreateWallet(page, paymentFixtures.recoveryPaymentId)
  await loginToLivt(page)

  await page
    .getByLabel('送金確認用Walletパスワード')
    .fill(browserEnvironment.walletPassword)
  await page.getByRole('button', { name: '内容を確認してJPYCを送る' }).click()

  await expect(
    page.getByRole('heading', { name: 'LivTでの確認待ちです' }),
  ).toBeVisible({ timeout: 20_000 })
  await expect(
    page.getByText(
      '取引receiptがまだ見つかりません。送金せず確認だけ再試行してください。',
    ),
  ).toBeVisible()

  expect(readPaymentState(paymentFixtures.recoveryPaymentId)).toEqual({
    status: 'pending',
    transactionHash: null,
    userId: null,
    hasPaidAt: false,
  })
  let rpc = await readRpcState()
  expect(rpc.broadcasts).toBe(1)
  expect(rpc.backendReceiptReads).toBe(10)

  await page.reload()
  await page
    .getByLabel('パスワード', { exact: true })
    .fill(browserEnvironment.walletPassword)
  await page.getByRole('button', { name: 'ウォレットを解除' }).click()

  await expect(
    page.getByText(
      '保存済みの取引番号があります。送金せず確認だけ再試行してください。',
    ),
  ).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: '送金せず確認だけ再試行' }).click()

  await expect(
    page.getByRole('heading', { name: 'お支払いが確認されました' }),
  ).toBeVisible({ timeout: 15_000 })
  expect(readPaymentState(paymentFixtures.recoveryPaymentId)).toEqual({
    status: 'confirmed',
    transactionHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
    userId: 910001,
    hasPaidAt: true,
  })

  rpc = await readRpcState()
  expect(rpc.broadcasts).toBe(1)
  expect(rpc.backendReceiptReads).toBe(11)
})

test('異なる金額の連続2 Paymentを別transactionとして確定する', async ({
  page,
}) => {
  await openPaymentAndCreateWallet(
    page,
    paymentFixtures.sequentialFirstPaymentId,
  )
  await expectAuthoritativePaymentDetails(
    page,
    paymentFixtures.sequentialFirstAmount,
  )
  await loginToLivt(page)
  await submitPayment(page)

  await expect(
    page.getByRole('heading', { name: 'お支払いが確認されました' }),
  ).toBeVisible({ timeout: 20_000 })
  const firstState = readPaymentState(
    paymentFixtures.sequentialFirstPaymentId,
  )
  expect(firstState.status).toBe('confirmed')
  expect(firstState.transactionHash).toMatch(/^0x[0-9a-f]{64}$/)

  await openPaymentWithExistingWallet(
    page,
    paymentFixtures.sequentialSecondPaymentId,
  )
  await expectAuthoritativePaymentDetails(
    page,
    paymentFixtures.sequentialSecondAmount,
  )
  await expect(page.getByText('LivT利用者: Browser Review User')).toBeVisible()
  await expect(
    page.getByText('保存済みの取引番号があります。送金せず確認だけ再試行してください。'),
  ).toHaveCount(0)
  await submitPayment(page)

  await expect(
    page.getByRole('heading', { name: 'お支払いが確認されました' }),
  ).toBeVisible({ timeout: 20_000 })
  const secondState = readPaymentState(
    paymentFixtures.sequentialSecondPaymentId,
  )
  expect(secondState.status).toBe('confirmed')
  expect(secondState.transactionHash).toMatch(/^0x[0-9a-f]{64}$/)
  expect(secondState.transactionHash).not.toBe(firstState.transactionHash)
  expect(firstState.userId).toBe(910001)
  expect(secondState.userId).toBe(910001)

  const rpc = await readRpcState()
  expect(rpc.broadcasts).toBe(2)
  expect(rpc.backendReceiptReads).toBe(2)
  expect(rpc.transfers).toEqual([
    {
      transactionHash: firstState.transactionHash,
      recipient: checksumRecipient,
      amount: paymentFixtures.sequentialFirstAtomicAmount,
    },
    {
      transactionHash: secondState.transactionHash,
      recipient: checksumRecipient,
      amount: paymentFixtures.sequentialSecondAtomicAmount,
    },
  ])
})

test('期限切れのbackend決済情報ではログインも送金も開始しない', async ({ page }) => {
  await openPaymentAndCreateWallet(page, paymentFixtures.expiredPaymentId)

  await expect(page.getByRole('alert')).toContainText('この決済は期限切れです。')
  await expect(page.getByRole('button', { name: 'LivTへログイン' })).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: '内容を確認してJPYCを送る' }),
  ).toHaveCount(0)

  expect(readPaymentState(paymentFixtures.expiredPaymentId)).toEqual({
    status: 'pending',
    transactionHash: null,
    userId: null,
    hasPaidAt: false,
  })
  const rpc = await readRpcState()
  expect(rpc.simulations).toBe(0)
  expect(rpc.broadcasts).toBe(0)
})

test('決済履歴のAPI値をHTMLとして実行しない', async ({ page }) => {
  const attack = '<img src=x onerror="window.__livtXssExecuted=true">'
  const scriptAttack = '<script>window.__livtXssExecuted=true</script>'

  await page.addInitScript(() => {
    localStorage.setItem('user_token', 'browser-xss-test-token')
    Object.defineProperty(window, '__livtXssExecuted', {
      configurable: true,
      value: false,
      writable: true,
    })
  })
  await page.route('**/api/user/payments', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: {
        payments: [
          {
            amount: attack,
            store_name: scriptAttack,
            status: attack,
            paid_at: scriptAttack,
            tx_hash: attack,
          },
        ],
      },
      status: 200,
    })
  })

  await page.goto(new URL('/user/payments', browserEnvironment.backendUrl).href)

  const card = page.locator('.payment-card')
  await expect(card).toContainText(attack)
  await expect(card).toContainText(scriptAttack)
  await expect(card.locator('img, script')).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __livtXssExecuted?: boolean })
            .__livtXssExecuted,
      ),
    )
    .toBe(false)
})

async function openPaymentAndCreateWallet(
  page: Page,
  paymentId: number,
): Promise<void> {
  await page.goto(
    new URL(`/pay/${paymentId}`, browserEnvironment.backendUrl).href,
  )

  await expect(page.getByRole('button', { name: 'MetaMaskを接続' })).toBeVisible()
  await expect(page.getByRole('button', { name: /JPYCを支払う/ })).toBeVisible()
  const walletLink = page.getByRole('link', { name: 'LivT Walletで支払う' })
  const walletHref = await walletLink.getAttribute('href')
  if (walletHref === null) throw new Error('Wallet payment link is missing')
  expect(new URL(walletHref).href).toBe(
    new URL(`/?payment_id=${paymentId}`, browserEnvironment.walletUrl).href,
  )
  await walletLink.click()

  await expect(page).toHaveURL(
    new URL(`/?payment_id=${paymentId}`, browserEnvironment.walletUrl).href,
  )
  await page
    .getByLabel('パスワード', { exact: true })
    .fill(browserEnvironment.walletPassword)
  await page
    .getByRole('button', { name: 'ウォレットを作成して暗号化' })
    .click()
  await expect(page.locator('#wallet-password')).toHaveCount(0, {
    timeout: 15_000,
  })
}

async function openPaymentWithExistingWallet(
  page: Page,
  paymentId: number,
): Promise<void> {
  await page.goto(
    new URL(`/pay/${paymentId}`, browserEnvironment.backendUrl).href,
  )
  await page.getByRole('link', { name: 'LivT Walletで支払う' }).click()
  await expect(page).toHaveURL(
    new URL(`/?payment_id=${paymentId}`, browserEnvironment.walletUrl).href,
  )
  await page
    .getByLabel('パスワード', { exact: true })
    .fill(browserEnvironment.walletPassword)
  await page.getByRole('button', { name: 'ウォレットを解除' }).click()
  await expect(page.locator('#wallet-password')).toHaveCount(0, {
    timeout: 15_000,
  })
}

async function expectAuthoritativePaymentDetails(
  page: Page,
  amount: string = paymentFixtures.amount,
): Promise<void> {
  const details = page.locator('.payment-request-details')
  await expect(details).toContainText(paymentFixtures.storeName)
  await expect(details).toContainText(`${amount} JPYC`)
  await expect(details).toContainText('Kaia Kairos')
  await expect(details).toContainText('1001')
  await expect(details).toContainText(paymentFixtures.tokenAddress)
  await expect(details).toContainText(paymentFixtures.recipientAddress)
}

async function submitPayment(page: Page): Promise<void> {
  await page
    .getByLabel('送金確認用Walletパスワード')
    .fill(browserEnvironment.walletPassword)
  await page.getByRole('button', { name: '内容を確認してJPYCを送る' }).click()
}

async function loginToLivt(page: Page): Promise<void> {
  await page.getByLabel('メールアドレス').fill(paymentFixtures.email)
  await page.getByLabel('LivTパスワード').fill(browserEnvironment.userPassword)
  await page.getByRole('button', { name: 'LivTへログイン' }).click()
  await expect(page.getByText('LivT利用者: Browser Review User')).toBeVisible()
}

const checksumRecipient = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
