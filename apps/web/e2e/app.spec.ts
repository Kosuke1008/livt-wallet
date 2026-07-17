import { expect, test } from '@playwright/test'

test('ウォレットを作成して有効なアドレスを表示する', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Wallet' })).toBeVisible()
  await page.getByRole('button', { name: 'ウォレットを作成' }).click()

  await expect(page.getByText('ウォレットアドレス')).toBeVisible()
  await expect(page.locator('output')).toHaveText(/^0x[a-fA-F0-9]{40}$/)
})
