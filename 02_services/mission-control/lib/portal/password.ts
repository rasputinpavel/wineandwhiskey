// PBKDF2-SHA256 password hashing via Web Crypto — works in both the Edge
// (middleware) and Node runtimes with no extra dependency. Stored format:
//   pbkdf2$<iterations>$<saltBase64>$<hashBase64>

const ENC = new TextEncoder()
const ITERATIONS = 100_000
const KEY_BITS = 256

function toB64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromB64(str: string): Uint8Array<ArrayBuffer> {
  const bin = atob(str)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// `salt` is typed to an ArrayBuffer-backed view because TS 5.9's DOM lib requires
// BufferSource (ArrayBufferView<ArrayBuffer>) for deriveBits — a plain Uint8Array
// is Uint8Array<ArrayBufferLike>, which admits SharedArrayBuffer and is rejected.
async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ENC.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, KEY_BITS,
  )
  return new Uint8Array(bits)
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derive(password, salt, ITERATIONS)
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(hash)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false
  const iterations = parseInt(parts[1], 10)
  if (!Number.isFinite(iterations) || iterations <= 0) return false
  let salt: Uint8Array<ArrayBuffer>, expected: Uint8Array<ArrayBuffer>
  try { salt = fromB64(parts[2]); expected = fromB64(parts[3]) } catch { return false }
  const actual = await derive(password, salt, iterations)
  if (actual.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i]
  return diff === 0
}
