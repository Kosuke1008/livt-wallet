import { describe, expect, it } from 'vitest'
import {
  getActiveNetwork,
  selectActiveNetwork,
  UnsupportedChainError,
} from '../../../src/blockchain/activeNetwork'

describe('active network', () => {
  it('常にKaia Kairosへ解決する', () => {
    expect(getActiveNetwork().id).toBe(1001)
    expect(selectActiveNetwork(1001)).toBe(getActiveNetwork())
  })

  it('Kairos以外のchain IDを拒否する', () => {
    expect(() => selectActiveNetwork(1)).toThrow(UnsupportedChainError)
    expect(() => selectActiveNetwork(8217)).toThrow(UnsupportedChainError)
  })
})
