import { expect, test, type Page } from '@playwright/test'
import { KAIROS_NETWORK } from '../src/kairos'

const rpcUrlPattern = new RegExp(
  `^${KAIROS_NETWORK.rpcUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`,
)

async function mockKairosBalance(page: Page) {
  await page.route(rpcUrlPattern, async (route) => {
    const request = route.request().postDataJSON() as { id: number }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result: '0xde0b6b3a7640000',
      }),
    })
  })
}

test('暗号化して保存し、再読み込み後に復号できる', async ({ page }) => {
  await mockKairosBalance(page)
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Wallet' })).toBeVisible()
  await expect(page.getByLabel('アクティブネットワーク')).toHaveText(
    KAIROS_NETWORK.name,
  )
  await expect(page.getByText(/Mainnet/i)).toHaveCount(0)
  await page.getByLabel('パスワード').fill('e2e-test-password')
  await page
    .getByRole('button', { name: 'ウォレットを作成して暗号化' })
    .click()

  await expect(page.getByText('ウォレットアドレス')).toBeVisible()
  const originalAddress = await page
    .getByLabel('ウォレットアドレス値')
    .textContent()
  expect(originalAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
  await expect(page.getByLabel('KAIA残高値')).toHaveText('1 KAIA')

  await page.reload()
  await expect(page.getByRole('button', { name: 'ウォレットを解除' })).toBeVisible()
  await expect(page.getByLabel('ウォレットアドレス値')).not.toBeVisible()
  await page.getByLabel('パスワード').fill('wrong-password')
  await page.getByRole('button', { name: 'ウォレットを解除' }).click()
  await expect(page.getByRole('alert')).toHaveText('パスワードが正しくありません')

  await page.getByLabel('パスワード').fill('e2e-test-password')
  await page.getByRole('button', { name: 'ウォレットを解除' }).click()
  await expect(page.getByLabel('ウォレットアドレス値')).toHaveText(
    originalAddress ?? '',
  )
  await expect(page.getByLabel('KAIA残高値')).toHaveText('1 KAIA')
})

test('Kairos RPC障害を表示して再試行できる', async ({ page }) => {
  await page.route(rpcUrlPattern, async (route) => {
    await route.abort('connectionfailed')
  })
  await page.goto('/')
  await page.getByLabel('パスワード').fill('e2e-test-password')
  await page
    .getByRole('button', { name: 'ウォレットを作成して暗号化' })
    .click()

  await expect(page.getByRole('alert')).toHaveText(
    'Kairos RPCに接続できませんでした',
  )
  await expect(page.getByRole('button', { name: '再試行' })).toBeVisible()
  await expect(page.getByText(/Mainnet/i)).toHaveCount(0)
})
