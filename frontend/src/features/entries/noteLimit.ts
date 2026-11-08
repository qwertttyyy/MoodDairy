import { isEncryptionEnabled } from '../../shared/crypto/crypto'

// API limit includes the AES-GCM tag and base64 envelope, not just the text.
const NOTE_WIRE_LIMIT = 8192

export function noteUsage(note: string): number {
  const text = note.trim()
  if (!text) return 0
  const size = isEncryptionEnabled()
    ? 17 + 4 * Math.ceil((new TextEncoder().encode(text).byteLength + 16) / 3)
    : Array.from(text).length
  return size / NOTE_WIRE_LIMIT
}
