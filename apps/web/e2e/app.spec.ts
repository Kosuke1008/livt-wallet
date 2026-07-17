import { expect, test } from '@playwright/test'

test('準備中の画面を表示する', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Wallet' })).toBeVisible()
  await expect(page.getByText('準備中です')).toBeVisible()
})
