// Edge-safe: uses Web Crypto only, so middleware can verify without Node APIs.
// The token carries nothing but its own expiry — there is one admin.

export const ADMIN_COOKIE = 'casino_admin'
export const ADMIN_MAX_AGE = 60 * 60 * 24 * 14

const ENC = new TextEncoder()

/**
 * lib/supabase.ts already has a `required()` helper that does exactly this
 * for the Supabase variables. It is not reused here: importing it would run
 * that module's own top-level env checks and pull @supabase/supabase-js into
 * every bundle that touches admin auth -- including middleware.ts, which runs
 * on the Edge runtime and needs none of it just to read one string. So the
 * same three lines are duplicated here instead, once, and both call sites
 * (middleware.ts and app/api/auth/login/route.ts) share this copy.
 *
 * Failing loudly matters: `process.env.CASINO_SECRET || 'change-me'` signs
 * the admin cookie with a value that sits in this public repository the
 * moment the Railway env var is missing, which lets anyone forge it and read
 * tonight's answers.
 */
export function requiredCasinoSecret(): string {
  const value = process.env.CASINO_SECRET
  if (!value) {
    throw new Error(
      'wine-casino: CASINO_SECRET is not set. Copy .env.example to .env.local for local work, ' +
      'or set it on the Railway service before deploying -- without it the admin cookie would ' +
      'be signed with a fallback value anyone can read in this repo.',
    )
  }
  return value
}

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
