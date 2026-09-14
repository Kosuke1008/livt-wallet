import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function activationReleaseCapable(): boolean {
  try {
    const path = fileURLToPath(new URL('./mainnet-pilot-activation.json', import.meta.url))
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return typeof value === 'object' && value !== null
      && Object.keys(value).length === 1
      && Reflect.get(value, 'release') === 'phase-13-mainnet-pilot-v1'
  } catch {
    return false
  }
}

export default defineConfig(({ mode }) => ({
  // Unit/integration tests use explicit fixtures and never load operator env files.
  envDir: mode === 'test' ? false : undefined,
  plugins: [react()],
  define: {
    __LIVT_MAINNET_ACTIVATION_RELEASE__: JSON.stringify(
      mode !== 'test' && activationReleaseCapable(),
    ),
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
}))
