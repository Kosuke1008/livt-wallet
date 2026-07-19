import { defineConfig, devices } from '@playwright/test'

const walletUrl = process.env.LIVT_E2E_WALLET_URL

if (walletUrl === undefined) {
  throw new Error('Payment browser E2E environment is not initialized')
}

export default defineConfig({
  testDir: './e2e/payment',
  testMatch: 'payment.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: walletUrl,
    screenshot: 'only-on-failure',
    trace: 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'payment-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
