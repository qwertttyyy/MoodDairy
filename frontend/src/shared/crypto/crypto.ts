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

import { b64ToBytes, bytesToB64 } from '../lib/base64'
import type { Bytes } from '../lib/base64'

export const PBKDF2_ITERATIONS = 600000
export const ENC_KEY_STORAGE = 'enc_key'
export const WRAPPED_KEY_STORAGE = 'wrapped_enc_key'

const IV_LENGTH = 12
const KEY_LENGTH = 32

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
  const salt = b64ToBytes(saltB64)
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
  if (!blob || !blob.includes(':')) return ''
  const key = await getCryptoKey()
  return decryptWithCryptoKey(key, blob)
}

/** Оборачивает ключ пользователя серверным wrapping_key и кладёт в localStorage. */
export async function wrapKey(wrappingKeyB64: string): Promise<void> {
  const raw = getRawKey()
  if (!raw) return
  const wrappingKey = await crypto.subtle.importKey(
    'raw',
    b64ToBytes(wrappingKeyB64),
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
  const [ivB64, ctB64] = blob.split(':', 2)
  const wrappingKey = await crypto.subtle.importKey(
    'raw',
    b64ToBytes(wrappingKeyB64),
    'AES-GCM',
    false,
    ['decrypt'],
  )
  const raw = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(ivB64) },
    wrappingKey,
    b64ToBytes(ctB64),
  )
  storeRawKey(new Uint8Array(raw))
  return true
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
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt'])
  return decryptWithCryptoKey(key, blob)
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
  const [ivB64, ctB64] = blob.split(':', 2)
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(ivB64) },
    key,
    b64ToBytes(ctB64),
  )
  return new TextDecoder().decode(plain)
}

function storeRawKey(raw: Bytes): void {
  sessionStorage.setItem(ENC_KEY_STORAGE, bytesToB64(raw))
  cachedKey = null
}

function getRawKey(): Bytes | null {
  const b64 = sessionStorage.getItem(ENC_KEY_STORAGE)
  return b64 ? b64ToBytes(b64) : null
}

async function getCryptoKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey
  const raw = getRawKey()
  if (!raw) throw new Error('Encryption key not available')
  cachedKey = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
  return cachedKey
}
