import type { Address } from 'viem'
import { z } from 'zod'
import { evmAddressSchema } from '../blockchain/address'
import { createWallet, recoverAddress } from './wallet'

const STORAGE_KEY = 'livt-wallet:encrypted-wallet'
const PBKDF2_ITERATIONS = 310_000
const SALT_BYTES = 16
const IV_BYTES = 12

const base64Schema = z.string().min(1).regex(/^[A-Za-z0-9+/]+={0,2}$/)

export const encryptedWalletSchema = z
  .object({
    version: z.literal(1),
    address: evmAddressSchema,
    ciphertext: base64Schema,
    iv: base64Schema,
    salt: base64Schema,
    kdf: z
      .object({
        name: z.literal('PBKDF2'),
        hash: z.literal('SHA-256'),
        iterations: z.number().int().min(100_000),
      })
      .strict(),
  })
  .strict()

export type EncryptedWallet = z.infer<typeof encryptedWalletSchema>

type WalletStorage = Pick<Storage, 'getItem' | 'setItem'>

export class InvalidPasswordError extends Error {
  readonly name = 'InvalidPasswordError'

  constructor() {
    super('Password must not be empty')
  }
}

export class IncorrectPasswordError extends Error {
  readonly name = 'IncorrectPasswordError'

  constructor() {
    super('The password is incorrect or the encrypted wallet is corrupted')
  }
}

export class InvalidStoredWalletError extends Error {
  readonly name = 'InvalidStoredWalletError'

  constructor() {
    super('The stored wallet is malformed or corrupted')
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  try {
    const binary = atob(value)
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    throw new InvalidStoredWalletError()
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer
}

async function deriveEncryptionKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  if (password.length === 0) throw new InvalidPasswordError()

  const passwordBytes = new TextEncoder().encode(password)
  try {
    const passwordKey = await crypto.subtle.importKey(
      'raw',
      passwordBytes,
      'PBKDF2',
      false,
      ['deriveKey'],
    )

    return await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: toArrayBuffer(salt),
        iterations,
      },
      passwordKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
  } finally {
    passwordBytes.fill(0)
  }
}

export async function encryptMnemonic(
  mnemonic: string,
  password: string,
): Promise<EncryptedWallet> {
  const address = recoverAddress(mnemonic)
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const plaintext = new TextEncoder().encode(mnemonic)

  try {
    const key = await deriveEncryptionKey(password, salt, PBKDF2_ITERATIONS)
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      plaintext,
    )

    return encryptedWalletSchema.parse({
      version: 1,
      address,
      ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
      iv: bytesToBase64(iv),
      salt: bytesToBase64(salt),
      kdf: {
        name: 'PBKDF2',
        hash: 'SHA-256',
        iterations: PBKDF2_ITERATIONS,
      },
    })
  } finally {
    plaintext.fill(0)
  }
}

export async function decryptMnemonic(
  encryptedWallet: EncryptedWallet,
  password: string,
): Promise<string> {
  const parsedPayload = encryptedWalletSchema.safeParse(encryptedWallet)
  if (!parsedPayload.success) throw new InvalidStoredWalletError()
  const payload = parsedPayload.data
  const salt = base64ToBytes(payload.salt)
  const iv = base64ToBytes(payload.iv)
  const ciphertext = base64ToBytes(payload.ciphertext)

  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES) {
    throw new InvalidStoredWalletError()
  }

  try {
    const key = await deriveEncryptionKey(
      password,
      salt,
      payload.kdf.iterations,
    )
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(ciphertext),
    )
    const plaintextBytes = new Uint8Array(plaintext)

    try {
      const mnemonic = new TextDecoder('utf-8', { fatal: true }).decode(
        plaintextBytes,
      )
      if (recoverAddress(mnemonic) !== payload.address) {
        throw new InvalidStoredWalletError()
      }
      return mnemonic
    } finally {
      plaintextBytes.fill(0)
    }
  } catch (error) {
    if (
      error instanceof InvalidPasswordError ||
      error instanceof InvalidStoredWalletError
    ) {
      throw error
    }
    throw new IncorrectPasswordError()
  } finally {
    salt.fill(0)
    iv.fill(0)
    ciphertext.fill(0)
  }
}

export function saveEncryptedWallet(
  payload: EncryptedWallet,
  storage: WalletStorage = localStorage,
): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(encryptedWalletSchema.parse(payload)))
}

export function hasEncryptedWallet(
  storage: WalletStorage = localStorage,
): boolean {
  return storage.getItem(STORAGE_KEY) !== null
}

export function loadEncryptedWallet(
  storage: WalletStorage = localStorage,
): EncryptedWallet {
  const storedValue = storage.getItem(STORAGE_KEY)
  if (storedValue === null) throw new InvalidStoredWalletError()

  try {
    return encryptedWalletSchema.parse(JSON.parse(storedValue))
  } catch {
    throw new InvalidStoredWalletError()
  }
}

export async function createAndSaveWallet(
  password: string,
  storage: WalletStorage = localStorage,
): Promise<Address> {
  const wallet = createWallet()
  const payload = await encryptMnemonic(wallet.mnemonic, password)
  saveEncryptedWallet(payload, storage)
  return wallet.address
}

export async function unlockStoredWalletAddress(
  password: string,
  storage: WalletStorage = localStorage,
): Promise<Address> {
  const payload = loadEncryptedWallet(storage)
  const mnemonic = await decryptMnemonic(payload, password)
  return recoverAddress(mnemonic)
}
