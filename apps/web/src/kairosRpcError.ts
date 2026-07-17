import { HttpRequestError, ParseRpcError, TimeoutError } from 'viem'

export type KairosRpcFailureReason = 'malformed-response' | 'timeout' | 'unavailable'

export class KairosRpcError extends Error {
  readonly name = 'KairosRpcError'
  readonly retryable = true
  readonly reason: KairosRpcFailureReason

  constructor(reason: KairosRpcFailureReason, options?: ErrorOptions) {
    super(`Kaia Kairos RPC ${reason}`, options)
    this.reason = reason
  }
}

export function isKairosRpcTransportError(error: unknown): boolean {
  return findKairosRpcTransportError(error) !== undefined
}

export function toKairosRpcError(error: unknown): KairosRpcError {
  const transportError = findKairosRpcTransportError(error)
  if (transportError instanceof KairosRpcError) return transportError
  if (transportError instanceof TimeoutError) {
    return new KairosRpcError('timeout', { cause: error })
  }
  if (transportError instanceof ParseRpcError) {
    return new KairosRpcError('malformed-response', { cause: error })
  }
  if (transportError instanceof HttpRequestError) {
    return new KairosRpcError('unavailable', { cause: error })
  }
  return new KairosRpcError('unavailable', { cause: error })
}

function findKairosRpcTransportError(error: unknown): unknown {
  const visited = new Set<unknown>()
  let current = error
  while (current !== undefined && current !== null && !visited.has(current)) {
    visited.add(current)
    if (
      current instanceof KairosRpcError ||
      current instanceof TimeoutError ||
      current instanceof ParseRpcError ||
      current instanceof HttpRequestError
    ) {
      return current
    }
    current =
      typeof current === 'object' && 'cause' in current
        ? (current as { cause?: unknown }).cause
        : undefined
  }
  return undefined
}
