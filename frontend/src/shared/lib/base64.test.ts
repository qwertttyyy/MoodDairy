/**
 * Тесты base64-хелперов.
 *
 * Base64 — единственный мост между байтами и строками во всём шифровании:
 * ключи, соли, IV и шифротексты хранятся и передаются именно так.
 * Ошибка здесь ломает расшифровку всех записей, поэтому проверяем и края
 * (пустой массив, все 256 значений байта), и большой объём.
 */

import { describe, expect, it } from 'vitest'

import { b64ToBytes, bytesToB64, isValidB64 } from './base64'

describe('bytesToB64 / b64ToBytes', () => {
  it('делает roundtrip на коротком массиве', () => {
    const bytes = new Uint8Array([1, 2, 3, 250, 251, 255])
    expect(Array.from(b64ToBytes(bytesToB64(bytes)))).toEqual(Array.from(bytes))
  })

  it('делает roundtrip на всех 256 значениях байта', () => {
    const bytes = new Uint8Array(256)
    for (let i = 0; i < 256; i++) bytes[i] = i

    const restored = b64ToBytes(bytesToB64(bytes))

    expect(restored.length).toBe(256)
    expect(Array.from(restored)).toEqual(Array.from(bytes))
  })

  it('делает roundtrip на 100000 байт (спред такого массива в fromCharCode падает)', () => {
    const size = 100000
    const bytes = new Uint8Array(size)
    for (let i = 0; i < size; i++) bytes[i] = i % 256

    const b64 = bytesToB64(bytes)
    const restored = b64ToBytes(b64)

    expect(restored.length).toBe(size)
    // Побайтовое сравнение массива такой длины через toEqual слишком медленное:
    // сверяем контрольные точки и общую сумму.
    expect(restored[0]).toBe(bytes[0])
    expect(restored[size - 1]).toBe(bytes[size - 1])
    expect(restored[size >> 1]).toBe(bytes[size >> 1])
    let sum = 0
    for (let i = 0; i < size; i++) sum += (restored[i] ?? 0) ^ (bytes[i] ?? 0)
    expect(sum).toBe(0)
  })

  it('обрабатывает пустой массив и пустую строку', () => {
    expect(bytesToB64(new Uint8Array(0))).toBe('')
    expect(b64ToBytes('').length).toBe(0)
  })

  it('ставит padding по стандарту base64', () => {
    expect(bytesToB64(new Uint8Array([1]))).toBe('AQ==')
    expect(bytesToB64(new Uint8Array([1, 2]))).toBe('AQI=')
    expect(bytesToB64(new Uint8Array([1, 2, 3]))).toBe('AQID')
  })

  it('не содержит двоеточия — на нём делится формат `ivB64:ctB64`', () => {
    const bytes = new Uint8Array(512)
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256
    expect(bytesToB64(bytes)).not.toContain(':')
  })

  it('b64ToBytes возвращает Uint8Array поверх ArrayBuffer (требование Web Crypto)', () => {
    const out = b64ToBytes('AQID')
    expect(out).toBeInstanceOf(Uint8Array)
    expect(out.buffer).toBeInstanceOf(ArrayBuffer)
  })

  it.each(['AQID', 'AQI=', 'AQ==', 'YWJjZA=='])('принимает строгий Base64 %s', (value) => {
    expect(isValidB64(value)).toBe(true)
  })

  it.each(['', 'AQI', 'AQ===', 'A Q==', '!!!!', 'AQ==tail'])('отклоняет %s', (value) => {
    expect(isValidB64(value)).toBe(false)
  })
})
