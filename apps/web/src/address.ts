import { getAddress, isAddress, type Address } from 'viem'
import { z } from 'zod'

export const evmAddressSchema = z
  .string()
  .refine(isAddress, { message: 'Invalid EVM address' })
  .transform((address): Address => getAddress(address))

export class InvalidAddressError extends Error {
  readonly name = 'InvalidAddressError'

  constructor() {
    super('Invalid EVM address')
  }
}

export function normalizeEvmAddress(value: unknown): Address {
  const result = evmAddressSchema.safeParse(value)
  if (!result.success) throw new InvalidAddressError()
  return result.data
}

export function isValidEvmAddress(value: unknown): value is Address {
  return evmAddressSchema.safeParse(value).success
}
