import { expect, test, type Page } from '@playwright/test'
import { encodeFunctionResult } from 'viem'
import { erc20ReadAbi } from '../src/erc20Abi'
import { KAIROS_NETWORK } from '../src/kairos'
import { approvedJpycToken } from '../src/tokenRegistry'

const rpcUrlPattern = new RegExp(
  `^${KAIROS_NETWORK.rpcUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`,
)

interface MockKairosRpcOptions {
  nativeBalance?: bigint
  tokenBalance?: bigint
  failNative?: boolean
  failToken?: boolean
}

async function mockKairosRpc(
  page: Page,
  options: MockKairosRpcOptions = {},
) {
  const {
    nativeBalance = 1_000_000_000_000_000_000n,
    tokenBalance = 9_000_000_000_000_000_000_000n,
    failNative = false,
    failToken = false,
  } = options

  await page.route(rpcUrlPattern, async (route) => {
    const request = route.request().postDataJSON() as {
      id: number
      method: string
      params: readonly unknown[]
    }
    if (request.method === 'eth_getBalance' && failNative) {
      await route.abort('connectionfailed')
      return
    }
    if (request.method !== 'eth_getBalance' && failToken) {
      await route.abort('connectionfailed')
      return
    }

    let result: string
    if (request.method === 'eth_getBalance') {
      result = `0x${nativeBalance.toString(16)}`
    } else if (request.method === 'eth_getCode') {
      expect(String(request.params[0]).toLowerCase()).toBe(
        approvedJpycToken.contractAddress.toLowerCase(),
      )
      result = '0x6000'
    } else if (request.method === 'eth_call') {
      const call = request.params[0] as { data: string; to: string }
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
      } else {
        expect(call.data.startsWith('0x70a08231')).toBe(true)
        result = encodeFunctionResult({
          abi: erc20ReadAbi,
          functionName: 'balanceOf',
          result: tokenBalance,
        })
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
  const originalAddress = await page
    .getByLabel('ウォレットアドレス値')
    .textContent()
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
  await expect(page.getByLabel('ウォレットアドレス値')).toHaveText(
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
