import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { b64ToBytes } from '../lib/base64'
import {
  ENC_KEY_STORAGE,
  DecryptionError,
  EncryptedDataFormatError,
  PBKDF2_ITERATIONS,
  WRAPPED_KEY_STORAGE,
  clearKeys,
  decrypt,
  decryptWithKey,
  deriveKey,
  encrypt,
  encryptWithKey,
  generateShareKey,
  setEncryptionEnabled,
  storeFromDerived,
  unwrapKey,
  wrapKey,
} from './crypto'

const PASSWORD = 'старый-пароль-2024'
const SALT_B64 = 'AQIDBAUGBwgJCgsMDQ4PEA=='
const EXPECTED_KEY_B64 = 'jVI7kr6uBICTWArTFbCUQYEla7d1m7PwvyZQtlZZsSY='
const LEGACY_TEXT = 'Запись из старой версии 🌿 line2'
const LEGACY_BLOB =
  'ERITFBUWFxgZGhsc:u1WbNvahmOXOcw8fK31Iou5yLjkVUfQwGBuyJBTMTZasvizAKNQRnLWHNolkhgGFbn4db6IhPrwdt/57iaI/1XMuOGPLaQ=='
const NOTE = 'Тревога 7/10 — стало легче после прогулки 🌿'

function toB64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function splitBlob(blob: string): [string, string] {
  const parts = blob.split(':')
  const iv = parts[0]
  const ciphertext = parts[1]
  if (parts.length !== 2 || !iv || !ciphertext) throw new Error('Некорректный тестовый blob')
  return [iv, ciphertext]
}

async function referenceDecrypt(rawKey: ArrayBuffer, blob: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt'])
  const [ivB64, ciphertextB64] = splitBlob(blob)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(ivB64) },
    key,
    b64ToBytes(ciphertextB64),
  )
  return new TextDecoder().decode(plaintext)
}

let keyBits: ArrayBuffer
let wrappingKeyB64: string

beforeAll(async () => {
  keyBits = await deriveKey(PASSWORD, SALT_B64)
  wrappingKeyB64 = toB64(crypto.getRandomValues(new Uint8Array(32)))
})

beforeEach(() => {
  clearKeys()
  sessionStorage.clear()
  localStorage.clear()
  setEncryptionEnabled(true)
  storeFromDerived(keyBits)
})

afterEach(() => {
  setEncryptionEnabled(true)
  clearKeys()
  sessionStorage.clear()
  localStorage.clear()
})

describe('критичный контракт шифрования', () => {
  it('сохраняет параметры PBKDF2 и имена ключей storage', () => {
    expect(PBKDF2_ITERATIONS).toBe(600000)
    expect(ENC_KEY_STORAGE).toBe('enc_key')
    expect(WRAPPED_KEY_STORAGE).toBe('wrapped_enc_key')
    expect(toB64(new Uint8Array(keyBits))).toBe(EXPECTED_KEY_B64)
  })

  it('делает UTF-8 roundtrip с уникальным IV длиной 12 байт', async () => {
    const first = await encrypt(NOTE)
    const second = await encrypt(NOTE)

    expect(first).not.toBe(second)
    expect(b64ToBytes(splitBlob(first)[0])).toHaveLength(12)
    await expect(decrypt(first)).resolves.toBe(NOTE)
  })

  it('читает зафиксированную запись из старой версии', async () => {
    await expect(decrypt(LEGACY_BLOB)).resolves.toBe(LEGACY_TEXT)
  })

  it('пишет данные, которые читает независимая реализация AES-GCM', async () => {
    await expect(referenceDecrypt(keyBits, await encrypt(NOTE))).resolves.toBe(NOTE)
  })

  it('обнаруживает подмену шифротекста', async () => {
    const [ivB64, ciphertextB64] = splitBlob(LEGACY_BLOB)
    const tampered = b64ToBytes(ciphertextB64)
    tampered[0] = (tampered[0] ?? 0) ^ 0xff

    await expect(decrypt(`${ivB64}:${toB64(tampered)}`)).rejects.toBeInstanceOf(DecryptionError)
  })

  it('восстанавливает локально обёрнутый ключ', async () => {
    const encrypted = await encrypt(NOTE)
    await wrapKey(wrappingKeyB64)
    sessionStorage.removeItem(ENC_KEY_STORAGE)

    await expect(unwrapKey(wrappingKeyB64)).resolves.toBe(true)
    expect(sessionStorage.getItem(ENC_KEY_STORAGE)).toBe(EXPECTED_KEY_B64)
    await expect(decrypt(encrypted)).resolves.toBe(NOTE)
  })

  it('при выключенном шифровании не требует ключ и не меняет текст', async () => {
    setEncryptionEnabled(false)
    clearKeys()

    await expect(encrypt(NOTE)).resolves.toBe(NOTE)
    await expect(decrypt(NOTE)).resolves.toBe(NOTE)
  })

  it('отклоняет основные варианты повреждённого формата до Web Crypto', async () => {
    for (const value of ['', 'без разделителя', 'AAAA:BBBB:CCCC', '!!!!:AAAA', 'AQID:QUJDRA==']) {
      await expect(decrypt(value)).rejects.toBeInstanceOf(EncryptedDataFormatError)
    }
  })
})

describe('шифрование публичной ссылки', () => {
  it('делает roundtrip с отдельным ключом без sessionStorage', async () => {
    const { raw } = generateShareKey()
    const encrypted = await encryptWithKey(raw, NOTE)
    clearKeys()

    await expect(decryptWithKey(raw, encrypted)).resolves.toBe(NOTE)
    await expect(referenceDecrypt(raw.buffer, encrypted)).resolves.toBe(NOTE)
  })

  it('не расшифровывает публичную копию чужим ключом', async () => {
    const { raw } = generateShareKey()
    const { raw: foreignKey } = generateShareKey()

    await expect(
      decryptWithKey(foreignKey, await encryptWithKey(raw, NOTE)),
    ).rejects.toBeInstanceOf(DecryptionError)
  })
})
