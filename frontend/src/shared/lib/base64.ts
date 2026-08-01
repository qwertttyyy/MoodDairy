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

export function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

export function b64ToBytes(b64: string): Bytes {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
