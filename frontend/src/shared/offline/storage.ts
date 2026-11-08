/** IndexedDB vault. Diary payloads are encrypted; no notes are written to localStorage. */
import { bytesToB64, b64ToBytes } from '../lib/base64'

const DATABASE = 'moods-offline'
const STORE = 'vault'
let database: Promise<IDBDatabase> | null = null
let vaultKey: Promise<CryptoKey> | null = null

function openDatabase(): Promise<IDBDatabase> {
  if (database) return database
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close()
        database = null
        vaultKey = null
      }
      resolve(request.result)
    }
    request.onerror = () => {
      database = null
      reject(request.error)
    }
    request.onblocked = () => {
      database = null
      reject(new Error('Локальное хранилище занято другой вкладкой'))
    }
  })
  return database
}

export async function readValue<T>(key: string): Promise<T | undefined> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
    request.onsuccess = () => resolve(request.result as T | undefined)
    request.onerror = () => reject(request.error)
  })
}

export async function writeValue(key: string, value: unknown): Promise<void> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).put(value, key)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Запись на устройство отменена'))
  })
}

export async function removeValue(key: string): Promise<void> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).delete(key)
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error)
  })
}

export async function listKeys(prefix: string): Promise<string[]> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).getAllKeys()
    request.onsuccess = () =>
      resolve(
        request.result.filter(
          (key): key is string => typeof key === 'string' && key.startsWith(prefix),
        ),
      )
    request.onerror = () => reject(request.error)
  })
}

async function getVaultKey(): Promise<CryptoKey> {
  if (vaultKey) return vaultKey
  vaultKey = (async () => {
    const stored = await readValue<CryptoKey>('vault-key')
    if (stored) return stored
    const candidate = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ])
    const db = await openDatabase()
    // The final check and insert share a transaction, including across tabs.
    return new Promise<CryptoKey>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite')
      const store = transaction.objectStore(STORE)
      const request = store.get('vault-key')
      let selected = candidate
      request.onsuccess = () => {
        if (request.result) selected = request.result as CryptoKey
        else store.put(candidate, 'vault-key')
      }
      transaction.oncomplete = () => resolve(selected)
      transaction.onabort = () => reject(transaction.error)
    })
  })().catch((error: unknown) => {
    vaultKey = null
    throw error
  })
  return vaultKey
}

interface Sealed {
  iv: string
  data: string
}

export async function seal(value: unknown, context: string): Promise<Sealed> {
  const key = await getVaultKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) },
    key,
    new TextEncoder().encode(JSON.stringify(value)),
  )
  return { iv: bytesToB64(iv), data: bytesToB64(new Uint8Array(data)) }
}

export async function readSealed<T>(key: string): Promise<T | undefined> {
  const stored = await readValue<Sealed>(key)
  if (!stored) return undefined
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(stored.iv), additionalData: new TextEncoder().encode(key) },
    await getVaultKey(),
    b64ToBytes(stored.data),
  )
  return JSON.parse(new TextDecoder().decode(plain)) as T
}

export function resetVaultKey(): void {
  vaultKey = null
}

export async function clearVault(): Promise<void> {
  const db = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).clear()
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error)
  })
  vaultKey = null
}
