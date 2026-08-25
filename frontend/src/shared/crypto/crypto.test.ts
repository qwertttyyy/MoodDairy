/**
 * Тесты клиентского шифрования.
 *
 * Это защита от самой дорогой регрессии в проекте: у действующих пользователей
 * записи уже лежат на сервере зашифрованными. Если поменяются параметры вывода ключа
 * (PBKDF2: 600 000 итераций, SHA-256, 256 бит), алгоритм (AES-GCM, IV 12 байт),
 * формат хранения (`ivB64:ctB64`) или ключи storage — данные станут нечитаемыми.
 *
 * Поэтому часть тестов намеренно НЕ пользуется модулем для шифрования:
 * вектор готовится независимой реализацией прямо здесь (и один вектор вообще
 * зашит константой), а модуль проверяется только на чтение. Так тест проверяет
 * формат хранения, а не «модуль согласован сам с собой».
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { b64ToBytes } from '../lib/base64'
import type { Bytes } from '../lib/base64'
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
  generateSalt,
  generateShareKey,
  hasKey,
  hasWrapped,
  isEncryptionEnabled,
  setEncryptionEnabled,
  storeFromDerived,
  unwrapKey,
  wrapKey,
} from './crypto'

// ============================================
// Эталонные (golden) значения
// ============================================

const PASSWORD = 'старый-пароль-2024'
/** base64 от байт 0x01…0x10 — фиксированная соль, чтобы вывод ключа был воспроизводим. */
const SALT_B64 = 'AQIDBAUGBwgJCgsMDQ4PEA=='

/** Ключ, который PBKDF2 обязан выдать на PASSWORD + SALT_B64 при 600 000 итерациях и SHA-256. */
const EXPECTED_KEY_B64 = 'jVI7kr6uBICTWArTFbCUQYEla7d1m7PwvyZQtlZZsSY='

const LEGACY_TEXT = 'Запись из старой версии 🌿 line2'
/**
 * Запись «из прошлого»: зашифрована сторонним кодом на том же ключе.
 * Константа зафиксирована один раз и меняться не должна — она играет роль
 * реальной строки из базы пользователя.
 */
const LEGACY_BLOB =
  'ERITFBUWFxgZGhsc:u1WbNvahmOXOcw8fK31Iou5yLjkVUfQwGBuyJBTMTZasvizAKNQRnLWHNolkhgGFbn4db6IhPrwdt/57iaI/1XMuOGPLaQ=='

const TRICKY_TEXT = 'Тревога 7/10 — «сжатие» в груди 😮‍💨\nСтало легче после прогулки ✅'

// ============================================
// Независимая от модуля реализация (эталон формата)
// ============================================

function toB64(bytes: Uint8Array): string {
  let bin = ''
  for (const byte of bytes) bin += String.fromCharCode(byte)
  return btoa(bin)
}

function splitBlob(blob: string): [string, string] {
  const parts = blob.split(':')
  const iv = parts[0]
  const ciphertext = parts[1]
  if (parts.length !== 2 || !iv || !ciphertext) throw new Error('Некорректный тестовый blob')
  return [iv, ciphertext]
}

function fromB64(b64: string): Bytes {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** PBKDF2 «как в старом app.js», записанный здесь целиком и без ссылок на модуль. */
async function referenceDeriveBits(password: string, saltB64: string): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromB64(saltB64), iterations: 600000, hash: 'SHA-256' },
    keyMaterial,
    256,
  )
}

/** AES-GCM с IV 12 байт и форматом `ivB64:ctB64` — тоже независимо от модуля. */
async function referenceEncrypt(rawKey: ArrayBuffer, plaintext: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  )
  return `${toB64(iv)}:${toB64(new Uint8Array(ct))}`
}

async function referenceDecrypt(rawKey: ArrayBuffer, blob: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt'])
  const [ivB64, ctB64] = splitBlob(blob)
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(ivB64) },
    key,
    fromB64(ctB64),
  )
  return new TextDecoder().decode(plain)
}

// ============================================
// Общая подготовка
// ============================================

/** Формат `ivB64:ctB64`: два base64-куска без внутренних двоеточий. */
const BLOB_SHAPE = /^[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/

/** PBKDF2 с 600 000 итераций недёшев — выводим ключи один раз на весь файл. */
let keyBits: ArrayBuffer
let keyBitsRepeat: ArrayBuffer
let keyBitsOtherSalt: ArrayBuffer
let wrappingKeyB64: string

beforeAll(async () => {
  keyBits = await deriveKey(PASSWORD, SALT_B64)
  keyBitsRepeat = await deriveKey(PASSWORD, SALT_B64)
  keyBitsOtherSalt = await deriveKey(PASSWORD, toB64(new Uint8Array(16).fill(9)))
  wrappingKeyB64 = toB64(crypto.getRandomValues(new Uint8Array(32)))
})

beforeEach(() => {
  // clearKeys() важен не только из-за storage: он сбрасывает кэш CryptoKey внутри модуля,
  // иначе состояние протекает между тестами.
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

// ============================================
// Тесты
// ============================================

describe('контракт параметров (менять нельзя)', () => {
  it('PBKDF2_ITERATIONS === 600000', () => {
    expect(PBKDF2_ITERATIONS).toBe(600000)
  })

  it('ENC_KEY_STORAGE === "enc_key"', () => {
    expect(ENC_KEY_STORAGE).toBe('enc_key')
  })

  it('WRAPPED_KEY_STORAGE === "wrapped_enc_key"', () => {
    expect(WRAPPED_KEY_STORAGE).toBe('wrapped_enc_key')
  })

  it('шифрование включено по умолчанию', () => {
    expect(isEncryptionEnabled()).toBe(true)
  })
})

describe('deriveKey', () => {
  it('выдаёт 32 байта (256 бит)', () => {
    expect(keyBits.byteLength).toBe(32)
  })

  it('детерминирован: тот же пароль и соль дают те же байты', () => {
    expect(toB64(new Uint8Array(keyBitsRepeat))).toBe(toB64(new Uint8Array(keyBits)))
  })

  it('другая соль даёт другой ключ', () => {
    expect(toB64(new Uint8Array(keyBitsOtherSalt))).not.toBe(toB64(new Uint8Array(keyBits)))
  })

  it('другой пароль даёт другой ключ', async () => {
    const other = await deriveKey(`${PASSWORD}!`, SALT_B64)
    expect(toB64(new Uint8Array(other))).not.toBe(toB64(new Uint8Array(keyBits)))
  })

  it('совпадает с эталонным ключом — фиксирует итерации, хеш и длину', () => {
    expect(toB64(new Uint8Array(keyBits))).toBe(EXPECTED_KEY_B64)
  })

  it('совпадает с независимой реализацией PBKDF2', async () => {
    const reference = await referenceDeriveBits(PASSWORD, SALT_B64)
    expect(toB64(new Uint8Array(keyBits))).toBe(toB64(new Uint8Array(reference)))
  })
})

describe('encrypt / decrypt roundtrip', () => {
  it('возвращает исходный ASCII-текст', async () => {
    expect(await decrypt(await encrypt('plain note'))).toBe('plain note')
  })

  it('возвращает исходный текст с кириллицей и эмодзи (UTF-8 через TextEncoder)', async () => {
    expect(await decrypt(await encrypt(TRICKY_TEXT))).toBe(TRICKY_TEXT)
  })

  it('переносит переводы строк и двоеточия внутри текста', async () => {
    const text = 'Утро: 8/10\nВечер: 4/10'
    expect(await decrypt(await encrypt(text))).toBe(text)
  })

  it('переносит длинный текст (несколько блоков AES)', async () => {
    const text = 'ё'.repeat(5000)
    expect(await decrypt(await encrypt(text))).toBe(text)
  })

  it('шифрует пустую строку и возвращает её обратно', async () => {
    const blob = await encrypt('')
    expect(blob).toMatch(BLOB_SHAPE)
    expect(await decrypt(blob)).toBe('')
  })

  it('без ключа в sessionStorage отклоняет промис', async () => {
    clearKeys()
    await expect(encrypt('нет ключа')).rejects.toThrow('Encryption key not available')
  })
})

describe('формат шифротекста', () => {
  it('состоит ровно из двух частей, разделённых двоеточием', async () => {
    const [iv, ciphertext] = splitBlob(await encrypt(TRICKY_TEXT))
    expect(iv.length).toBeGreaterThan(0)
    expect(ciphertext.length).toBeGreaterThan(0)
  })

  it('первая часть — base64 от 12 байт IV', async () => {
    const [ivB64] = splitBlob(await encrypt('x'))
    expect(b64ToBytes(ivB64).length).toBe(12)
  })

  it('IV случайный: две шифровки одного текста различаются', async () => {
    const first = await encrypt(TRICKY_TEXT)
    const second = await encrypt(TRICKY_TEXT)

    expect(first).not.toBe(second)
    expect(first.split(':')[0]).not.toBe(second.split(':')[0])
    expect(await decrypt(first)).toBe(TRICKY_TEXT)
    expect(await decrypt(second)).toBe(TRICKY_TEXT)
  })

  it('шифротекст длиннее открытого текста на тег GCM (16 байт)', async () => {
    const plainLength = new TextEncoder().encode('короткая запись').length
    const [, ctB64] = splitBlob(await encrypt('короткая запись'))
    expect(b64ToBytes(ctB64).length).toBe(plainLength + 16)
  })
})

describe('совместимость с уже сохранёнными данными', () => {
  it('читает зашитый эталонный вектор (строка «из базы пользователя»)', async () => {
    expect(await decrypt(LEGACY_BLOB)).toBe(LEGACY_TEXT)
  })

  it('читает вектор, зашифрованный независимой реализацией в этом тесте', async () => {
    const blob = await referenceEncrypt(keyBits, TRICKY_TEXT)
    expect(await decrypt(blob)).toBe(TRICKY_TEXT)
  })

  it('пишет так, что независимая реализация читает результат модуля', async () => {
    const blob = await encrypt(TRICKY_TEXT)
    expect(await referenceDecrypt(keyBits, blob)).toBe(TRICKY_TEXT)
  })

  it('не расшифровывает вектор, зашифрованный другим ключом', async () => {
    const foreign = await referenceEncrypt(keyBitsOtherSalt, TRICKY_TEXT)
    await expect(decrypt(foreign)).rejects.toBeInstanceOf(DecryptionError)
  })

  it('отклоняет вектор с подменённым шифротекстом (аутентификация GCM)', async () => {
    const [ivB64, ctB64] = splitBlob(LEGACY_BLOB)
    const tampered = b64ToBytes(ctB64)
    tampered[0] = (tampered[0] ?? 0) ^ 0xff
    await expect(decrypt(`${ivB64}:${toB64(tampered)}`)).rejects.toBeInstanceOf(DecryptionError)
  })
})

describe('wrapKey / unwrapKey', () => {
  it('пишет обёрнутый ключ в localStorage в формате ivB64:ctB64 с IV 12 байт', async () => {
    await wrapKey(wrappingKeyB64)

    const blob = localStorage.getItem(WRAPPED_KEY_STORAGE)
    expect(blob).toMatch(BLOB_SHAPE)
    if (!blob) throw new Error('Обёрнутый ключ не сохранён')
    const [iv, ciphertext] = splitBlob(blob)
    expect(b64ToBytes(iv).length).toBe(12)
    // 32 байта ключа + 16 байт тега GCM.
    expect(b64ToBytes(ciphertext).length).toBe(48)
  })

  it('восстанавливает ключ и читает ранее зашифрованный текст', async () => {
    const blob = await encrypt(TRICKY_TEXT)
    await wrapKey(wrappingKeyB64)

    // Подменяем ключ чужим — так сбрасывается внутренний кэш CryptoKey,
    // и успех расшифровки ниже нельзя объяснить кэшем.
    storeFromDerived(keyBitsOtherSalt)
    await expect(decrypt(blob)).rejects.toBeInstanceOf(DecryptionError)

    sessionStorage.removeItem(ENC_KEY_STORAGE)
    expect(hasKey()).toBe(false)

    await expect(unwrapKey(wrappingKeyB64)).resolves.toBe(true)
    expect(hasKey()).toBe(true)
    expect(sessionStorage.getItem(ENC_KEY_STORAGE)).toBe(EXPECTED_KEY_B64)
    expect(await decrypt(blob)).toBe(TRICKY_TEXT)
  })

  it('возвращает false, если обёрнутого ключа в localStorage нет', async () => {
    expect(localStorage.getItem(WRAPPED_KEY_STORAGE)).toBeNull()
    await expect(unwrapKey(wrappingKeyB64)).resolves.toBe(false)
  })

  it('ничего не пишет, если ключа в сессии нет', async () => {
    clearKeys()
    await wrapKey(wrappingKeyB64)
    expect(localStorage.getItem(WRAPPED_KEY_STORAGE)).toBeNull()
  })

  it('не разворачивает ключ чужим wrapping_key', async () => {
    await wrapKey(wrappingKeyB64)
    const foreign = toB64(crypto.getRandomValues(new Uint8Array(32)))
    await expect(unwrapKey(foreign)).rejects.toBeInstanceOf(DecryptionError)
  })
})

describe('hasKey / hasWrapped / clearKeys', () => {
  it('hasKey отражает наличие ключа в sessionStorage', () => {
    expect(hasKey()).toBe(true)
    sessionStorage.removeItem(ENC_KEY_STORAGE)
    expect(hasKey()).toBe(false)
  })

  it('hasWrapped отражает наличие обёрнутого ключа в localStorage', async () => {
    expect(hasWrapped()).toBe(false)
    await wrapKey(wrappingKeyB64)
    expect(hasWrapped()).toBe(true)
  })

  it('clearKeys убирает оба ключа', async () => {
    await wrapKey(wrappingKeyB64)
    expect(hasKey()).toBe(true)
    expect(hasWrapped()).toBe(true)

    clearKeys()

    expect(hasKey()).toBe(false)
    expect(hasWrapped()).toBe(false)
    expect(sessionStorage.getItem(ENC_KEY_STORAGE)).toBeNull()
    expect(localStorage.getItem(WRAPPED_KEY_STORAGE)).toBeNull()
  })
})

describe('шифрование выключено', () => {
  // Флаг — модульное состояние: возвращаем его в afterEach, иначе течёт в другие тесты.
  beforeEach(() => {
    setEncryptionEnabled(false)
  })

  afterEach(() => {
    setEncryptionEnabled(true)
  })

  it('isEncryptionEnabled сообщает false', () => {
    expect(isEncryptionEnabled()).toBe(false)
  })

  it('encrypt возвращает текст без изменений', async () => {
    expect(await encrypt(TRICKY_TEXT)).toBe(TRICKY_TEXT)
  })

  it('encrypt работает даже без ключа', async () => {
    clearKeys()
    expect(await encrypt('без ключа')).toBe('без ключа')
  })

  it('decrypt возвращает вход как есть', async () => {
    expect(await decrypt('открытый текст')).toBe('открытый текст')
    expect(await decrypt(LEGACY_BLOB)).toBe(LEGACY_BLOB)
  })

  it('decrypt пустой строки даёт пустую строку', async () => {
    expect(await decrypt('')).toBe('')
  })
})

describe('decrypt на некорректном входе', () => {
  it.each([
    '',
    'нешифрованный текст',
    'AAAA:BBBB:CCCC',
    '!!!!:AAAA',
    'AQID:QUJDRA==',
    'AAAAAAAAAAAAAAAA:AA==',
  ])('отклоняет некорректный формат без передачи в Web Crypto', async (value) => {
    await expect(decrypt(value)).rejects.toBeInstanceOf(EncryptedDataFormatError)
  })

  it('проверяет формат до поиска локального ключа', async () => {
    clearKeys()
    await expect(decrypt('нет двоеточия')).rejects.toBeInstanceOf(EncryptedDataFormatError)
  })
})

describe('generateSalt', () => {
  it('возвращает base64 от 16 байт', () => {
    expect(b64ToBytes(generateSalt()).length).toBe(16)
  })

  it('не повторяется', () => {
    const salts = new Set(Array.from({ length: 50 }, () => generateSalt()))
    expect(salts.size).toBe(50)
  })
})

describe('ключ для ссылки врачу', () => {
  it('generateShareKey даёт 32 байта и согласованный base64', () => {
    const { raw, b64 } = generateShareKey()

    expect(raw.length).toBe(32)
    expect(toB64(raw)).toBe(b64)
    expect(b64ToBytes(b64).length).toBe(32)
  })

  it('generateShareKey не повторяется', () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateShareKey().b64))
    expect(keys.size).toBe(50)
  })

  it('encryptWithKey / decryptWithKey делают roundtrip', async () => {
    const { raw } = generateShareKey()
    const blob = await encryptWithKey(raw, TRICKY_TEXT)

    expect(blob).toMatch(BLOB_SHAPE)
    expect(b64ToBytes(splitBlob(blob)[0]).length).toBe(12)
    expect(await decryptWithKey(raw, blob)).toBe(TRICKY_TEXT)
  })

  it('чужой ключ расшифровать не может', async () => {
    const { raw } = generateShareKey()
    const { raw: foreign } = generateShareKey()
    const blob = await encryptWithKey(raw, TRICKY_TEXT)

    await expect(decryptWithKey(foreign, blob)).rejects.toBeInstanceOf(DecryptionError)
  })

  it('работает независимо от ключа пользователя в сессии', async () => {
    const { raw } = generateShareKey()
    const blob = await encryptWithKey(raw, TRICKY_TEXT)

    clearKeys()

    expect(await decryptWithKey(raw, blob)).toBe(TRICKY_TEXT)
  })

  it('снапшот, зашифрованный share-ключом, читается независимой реализацией', async () => {
    const { raw } = generateShareKey()
    const blob = await encryptWithKey(raw, TRICKY_TEXT)
    // raw.buffer — тот же формат ключа, что принимает importKey напрямую.
    expect(await referenceDecrypt(raw.buffer, blob)).toBe(TRICKY_TEXT)
  })
})
