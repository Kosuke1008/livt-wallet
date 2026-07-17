import { expect, test } from '@playwright/test'

test('暗号化して保存し、再読み込み後に復号できる', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Wallet' })).toBeVisible()
  await page.getByLabel('パスワード').fill('e2e-test-password')
  await page
    .getByRole('button', { name: 'ウォレットを作成して暗号化' })
    .click()

  await expect(page.getByText('ウォレットアドレス')).toBeVisible()
  const originalAddress = await page.locator('output').textContent()
  expect(originalAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)

  await page.reload()
  await expect(page.getByRole('button', { name: 'ウォレットを解除' })).toBeVisible()
  await expect(page.locator('output')).not.toBeVisible()
  await page.getByLabel('パスワード').fill('wrong-password')
  await page.getByRole('button', { name: 'ウォレットを解除' }).click()
  await expect(page.getByRole('alert')).toHaveText('パスワードが正しくありません')

  await page.getByLabel('パスワード').fill('e2e-test-password')
  await page.getByRole('button', { name: 'ウォレットを解除' }).click()
  await expect(page.locator('output')).toHaveText(originalAddress ?? '')
})
