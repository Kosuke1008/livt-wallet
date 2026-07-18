import type { Address } from 'viem'
import { z } from 'zod'
import { evmAddressSchema } from '../blockchain/address'
import { createWallet, recoverAddress } from './wallet'

const STORAGE_KEY = 'livt-wallet:encrypted-wallet'
const PBKDF2_ITERATIONS = 310_000
const SALT_BYTES = 16
const IV_BYTES = 12

const base64Schema = z.string().min(1).regex(/^[A-Za-z0-9+/]+={0,2}$/)

export const encryptedWalletSchema = z //ブラウザに保存する定義
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

export type WalletStorage = Pick<Storage, 'getItem' | 'setItem'>

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
  // 1. 空のパスワードでは暗号鍵を作らない
  if (password.length === 0) throw new InvalidPasswordError()

  // 2. パスワードをPBKDF2へ渡せるバイト列に変換する
  const passwordBytes = new TextEncoder().encode(password)
  try {
    const passwordKey = await crypto.subtle.importKey(
      'raw',
      passwordBytes,
      'PBKDF2',
      false,
      ['deriveKey'],
    )

    // 3. PBKDF2でパスワードとsaltからAES-GCM用の鍵を導出する
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
    // 4. 鍵導出後は、作業用のパスワードバイト列を上書きする
    passwordBytes.fill(0)
  }
}

export async function encryptMnemonic( //暗号化
  mnemonic: string,
  password: string,
): Promise<EncryptedWallet> {
  // 1. 受け取った復元用の単語列を検査し、対応する公開アドレスを求める
  const address = recoverAddress(mnemonic)
  // 2. 暗号化ごとに新しいsaltとIVを安全な乱数から作る
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  // 3. 復元用の単語列をAES-GCMで扱える作業用バイト列に変換する
  const plaintext = new TextEncoder().encode(mnemonic)

  try {
    // 4. パスワードから、この暗号化だけに使う鍵を導出する
    const key = await deriveEncryptionKey(password, salt, PBKDF2_ITERATIONS)
    // 5. AES-GCMで暗号化し、復号時に改ざんも検出できる形にする
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      plaintext,
    )

    // 6. 保存前と同じ定義で暗号化データの形を検査する
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
    // 7. 暗号化後は、作業用の平文バイト列を上書きする
    plaintext.fill(0)
  }
}

export async function decryptMnemonic(
  encryptedWallet: EncryptedWallet,
  password: string,
): Promise<string> {
  // 1. 復号前に、保存データの版と各項目をZodで検査する
  const parsedPayload = encryptedWalletSchema.safeParse(encryptedWallet)
  if (!parsedPayload.success) throw new InvalidStoredWalletError()
  const payload = parsedPayload.data
  // 2. 保存用のBase64文字列を暗号処理用のバイト列へ戻す
  const salt = base64ToBytes(payload.salt)
  const iv = base64ToBytes(payload.iv)
  const ciphertext = base64ToBytes(payload.ciphertext)

  // 3. saltとIVの長さが暗号化時の定義と一致するか確認する
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES) {
    throw new InvalidStoredWalletError()
  }

  try {
    // 4. 保存された条件で鍵を再導出し、AES-GCMで復号する
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
      // 5. 復号したバイト列を復元用の単語列へ戻し、文字コードの不正も拒否する
      const mnemonic = new TextDecoder('utf-8', { fatal: true }).decode(
        plaintextBytes,
      )
      //復号化した12単語からアドレスを復元して、保存されているアドレスと一致するか確認する
      // 6. 復元した公開アドレスが保存時のアドレスと一致するか確認する
      if (recoverAddress(mnemonic) !== payload.address) { 
        throw new InvalidStoredWalletError()
      }
      // 7. 復元用の単語列は保存せず、必要な呼び出し元へだけ返す
      return mnemonic
    } finally {
      // 8. 復号後は、作業用の平文バイト列を上書きする
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
    // 9. 復号に使った作業用バイト列を上書きする
    salt.fill(0)
    iv.fill(0)
    ciphertext.fill(0)
  }
}

export function saveEncryptedWallet(
  payload: EncryptedWallet,
  storage: WalletStorage = localStorage,
): void {
  // 1. 保存形式を再検査し、暗号文と検証・復号に必要な情報だけを保存する
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
  // 1. 固定の保存名から暗号化済みウォレットを読み込む
  const storedValue = storage.getItem(STORAGE_KEY)
  if (storedValue === null) throw new InvalidStoredWalletError()

  try {
    // 2. JSONを解析し、余分な項目を含む壊れた保存データを拒否する
    return encryptedWalletSchema.parse(JSON.parse(storedValue))
  } catch {
    throw new InvalidStoredWalletError()
  }
}

export async function createAndSaveWallet( //作成から保存まで
  password: string,
  storage: WalletStorage = localStorage,
): Promise<Address> {
  // 1. 新しい12単語と公開アドレスを端末内で生成する
  const wallet = createWallet() // １．２．wallet作成
  // 2. 12単語をパスワードで暗号化し、保存用データへ変換する
  const payload = await encryptMnemonic(wallet.mnemonic, password) //12単語と口座番号(adress)を暗号化して保存する
  // 3. localStorageには暗号化済みデータだけを保存する
  saveEncryptedWallet(payload, storage) //ブラウザ内保存領域
  // 4. Reactへは秘密情報ではなく公開アドレスだけを返す
  return wallet.address
}

export async function unlockStoredWalletAddress( //保存済みのwalletを復号化して、アドレスを取得する
  password: string,
  storage: WalletStorage = localStorage,
): Promise<Address> {
  // 1. 保存データを読み込み、形式を検査する
  const payload = loadEncryptedWallet(storage)
  // 2. 必要な間だけ復元用の単語列を復号する
  const mnemonic = await decryptMnemonic(payload, password)
  // 3. Reactへ返す公開アドレスを復元する
  return recoverAddress(mnemonic)
}
