/**
 * Клиентское шифрование: PBKDF2 → AES-256-GCM.
 *
 * Порт модуля `Crypto` из backend/static/app.js. Формат и параметры менять нельзя —
 * иначе уже сохранённые у пользователей данные перестанут расшифровываться:
 *   - PBKDF2: 600 000 итераций, SHA-256, 256 бит;
 *   - AES-GCM, IV 12 байт;
 *   - формат шифротекста: `<ivB64>:<ctB64>`;
 *   - sessionStorage["enc_key"] — сырой ключ в base64;
 *   - localStorage["wrapped_enc_key"] — ключ, обёрнутый серверным wrapping_key.
 */

import { b64ToBytes, bytesToB64, isValidB64 } from '../lib/base64'
import type { Bytes } from '../lib/base64'

export const PBKDF2_ITERATIONS = 600000
export const ENC_KEY_STORAGE = 'enc_key'
export const WRAPPED_KEY_STORAGE = 'wrapped_enc_key'

const IV_LENGTH = 12
const KEY_LENGTH = 32

export class EncryptedDataFormatError extends Error {
  constructor() {
    super('Некорректный формат зашифрованных данных')
    this.name = 'EncryptedDataFormatError'
  }
}

export class DecryptionError extends Error {
  constructor(cause: unknown) {
    super('Не удалось расшифровать данные', { cause })
    this.name = 'DecryptionError'
  }
}

/**
 * Раньше флаг приходил из шаблона (`window.__APP_CONFIG__`),
 * теперь — из `GET /api/config/` через setEncryptionEnabled на старте приложения.
 */
let encryptionEnabled = true

/** Импортированный CryptoKey кэшируется: importKey на каждой записи заметно тормозит ленту. */
let cachedKey: CryptoKey | null = null

export function setEncryptionEnabled(enabled: boolean): void {
  encryptionEnabled = enabled
}

export function isEncryptionEnabled(): boolean {
  return encryptionEnabled
}

/** Выводит 256-битный ключ из пароля и соли (base64). */
export async function deriveKey(password: string, saltB64: string): Promise<ArrayBuffer> {
  const salt = decodeB64(saltB64)
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256,
  )
}

export function generateSalt(): string {
  return bytesToB64(crypto.getRandomValues(new Uint8Array(16)))
}

export async function encrypt(plaintext: string): Promise<string> {
  if (!encryptionEnabled) return plaintext
  const key = await getCryptoKey()
  return encryptWithCryptoKey(key, plaintext)
}

export async function decrypt(blob: string): Promise<string> {
  if (!encryptionEnabled) return blob || ''
  parseEncryptedBlob(blob)
  const key = await getCryptoKey()
  return decryptWithCryptoKey(key, blob)
}

/** Оборачивает ключ пользователя серверным wrapping_key и кладёт в localStorage. */
export async function wrapKey(wrappingKeyB64: string): Promise<void> {
  const raw = getRawKey()
  if (!raw) return
  const wrappingKey = await crypto.subtle.importKey(
    'raw',
    decodeEncryptionKey(wrappingKeyB64),
    'AES-GCM',
    false,
    ['encrypt'],
  )
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, raw)
  localStorage.setItem(
    WRAPPED_KEY_STORAGE,
    `${bytesToB64(iv)}:${bytesToB64(new Uint8Array(wrapped))}`,
  )
}

/** Восстанавливает ключ из localStorage. `false` — если обёрнутого ключа нет. */
export async function unwrapKey(wrappingKeyB64: string): Promise<boolean> {
  const blob = localStorage.getItem(WRAPPED_KEY_STORAGE)
  if (!blob) return false
  const { iv, ciphertext } = parseEncryptedBlob(blob)
  try {
    const wrappingKey = await crypto.subtle.importKey(
      'raw',
      decodeEncryptionKey(wrappingKeyB64),
      'AES-GCM',
      false,
      ['decrypt'],
    )
    const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, wrappingKey, ciphertext)
    storeRawKey(new Uint8Array(raw))
    return true
  } catch (error) {
    if (error instanceof EncryptedDataFormatError) throw error
    throw new DecryptionError(error)
  }
}

export function storeFromDerived(bits: ArrayBuffer): void {
  storeRawKey(new Uint8Array(bits))
}

export function hasKey(): boolean {
  return !!sessionStorage.getItem(ENC_KEY_STORAGE)
}

export function hasWrapped(): boolean {
  return !!localStorage.getItem(WRAPPED_KEY_STORAGE)
}

export function clearKeys(): void {
  sessionStorage.removeItem(ENC_KEY_STORAGE)
  localStorage.removeItem(WRAPPED_KEY_STORAGE)
  cachedKey = null
}

// ============================================
// Операции с произвольным ключом
// (снапшот для врача и его чтение на публичной странице)
// ============================================

/** Одноразовый 256-битный ключ для ссылки врачу. */
export function generateShareKey(): { raw: Bytes; b64: string } {
  const raw = crypto.getRandomValues(new Uint8Array(KEY_LENGTH))
  return { raw, b64: bytesToB64(raw) }
}

export async function encryptWithKey(rawKey: Bytes, plaintext: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt'])
  return encryptWithCryptoKey(key, plaintext)
}

export async function decryptWithKey(rawKey: Bytes, blob: string): Promise<string> {
  try {
    const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt'])
    return await decryptWithCryptoKey(key, blob)
  } catch (error) {
    if (error instanceof EncryptedDataFormatError || error instanceof DecryptionError) throw error
    throw new DecryptionError(error)
  }
}

// ============================================
// Внутреннее
// ============================================

async function encryptWithCryptoKey(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  )
  return `${bytesToB64(iv)}:${bytesToB64(new Uint8Array(ct))}`
}

async function decryptWithCryptoKey(key: CryptoKey, blob: string): Promise<string> {
  const { iv, ciphertext } = parseEncryptedBlob(blob)
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
    return new TextDecoder().decode(plain)
  } catch (error) {
    throw new DecryptionError(error)
  }
}

/** Проверяет `<ivB64>:<ctB64>` до передачи данных в Web Crypto. */
export function parseEncryptedBlob(blob: string): { iv: Bytes; ciphertext: Bytes } {
  const parts = blob.split(':')
  const ivB64 = parts[0]
  const ciphertextB64 = parts[1]
  if (
    parts.length !== 2 ||
    !ivB64 ||
    !ciphertextB64 ||
    !isValidB64(ivB64) ||
    !isValidB64(ciphertextB64)
  ) {
    throw new EncryptedDataFormatError()
  }

  const iv = b64ToBytes(ivB64)
  const ciphertext = b64ToBytes(ciphertextB64)
  if (iv.length !== IV_LENGTH || ciphertext.length < 16) throw new EncryptedDataFormatError()
  return { iv, ciphertext }
}

function decodeB64(value: string): Bytes {
  if (!isValidB64(value)) throw new EncryptedDataFormatError()
  return b64ToBytes(value)
}

export function decodeEncryptionKey(value: string): Bytes {
  const key = decodeB64(value)
  if (key.length !== KEY_LENGTH) throw new EncryptedDataFormatError()
  return key
}

function storeRawKey(raw: Bytes): void {
  sessionStorage.setItem(ENC_KEY_STORAGE, bytesToB64(raw))
  cachedKey = null
}

function getRawKey(): Bytes | null {
  const b64 = sessionStorage.getItem(ENC_KEY_STORAGE)
  return b64 ? decodeEncryptionKey(b64) : null
}

async function getCryptoKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey
  const raw = getRawKey()
  if (!raw) throw new Error('Encryption key not available')
  cachedKey = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
  return cachedKey
}
