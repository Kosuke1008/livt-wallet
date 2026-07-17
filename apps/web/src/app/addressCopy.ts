import type { Address } from 'viem'

type ClipboardWriter = Pick<Clipboard, 'writeText'>

export class AddressCopyError extends Error {
  readonly name = 'AddressCopyError'

  constructor(options?: ErrorOptions) {
    super('The wallet address could not be copied', options)
  }
}

export function shortenWalletAddress(address: Address): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export async function copyWalletAddress(
  address: Address,
  clipboard?: ClipboardWriter,
): Promise<void> {
  const availableClipboard =
    clipboard ??
    (typeof navigator === 'undefined' ? undefined : navigator.clipboard)

  if (availableClipboard === undefined) throw new AddressCopyError()

  try {
    await availableClipboard.writeText(address)
  } catch (error) {
    throw new AddressCopyError({ cause: error })
  }
}
