/**
 * Base64 для бинарных данных.
 *
 * Реализация через цикл, а не через `String.fromCharCode(...bytes)`:
 * спред большого массива превышает лимит аргументов функции,
 * а снапшот для врача может занимать сотни килобайт.
 */

/**
 * Байты, лежащие именно в ArrayBuffer (не в SharedArrayBuffer).
 * Web Crypto принимает только такой BufferSource.
 */
export type Bytes = Uint8Array<ArrayBuffer>

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/** Строгий стандартный Base64 с обязательным корректным padding. */
export function isValidB64(value: string): boolean {
  return value.length > 0 && value.length % 4 === 0 && BASE64_PATTERN.test(value)
}

export function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  for (const byte of bytes) bin += String.fromCharCode(byte)
  return btoa(bin)
}

export function b64ToBytes(b64: string): Bytes {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
