// Edge-safe: uses Web Crypto only, so middleware can verify without Node APIs.
// The token carries nothing but its own expiry — there is one admin.

export const ADMIN_COOKIE = 'casino_admin'
export const ADMIN_MAX_AGE = 60 * 60 * 24 * 14

const ENC = new TextEncoder()

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', ENC.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const buf = await crypto.subtle.sign('HMAC', key, ENC.encode(data))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** `<expiresAtMs>.<hmac>` */
export async function signAdminToken(secret: string, ttlMs: number): Promise<string> {
  const payload = String(Date.now() + ttlMs)
  return `${payload}.${await hmac(secret, payload)}`
}

export async function verifyAdminToken(secret: string, token: string | undefined): Promise<boolean> {
  if (!token) return false
  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [payload, sig] = parts
  const expires = Number(payload)
  if (!Number.isFinite(expires) || expires < Date.now()) return false
  return (await hmac(secret, payload)) === sig
}
