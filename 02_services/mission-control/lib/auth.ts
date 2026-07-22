import { findSectionForItem } from './registry'
import { getAuthUsersCached } from './portal/users-store'
import { verifyPassword } from './portal/password'

const SECRET = process.env.MC_SECRET || 'change-me-in-production'

export type User = {
  login: string
  // '*' = full access. Otherwise: a mix of section keys (grants all items in that
  // section) and item slugs (granular grant for a single item), matched by hasAccess.
  allowed: '*' | string[]
  is_admin?: boolean
  disabled?: boolean
  // Exactly one is set depending on source: env users carry plaintext `password`,
  // DB users carry `password_hash`.
  password?: string
  password_hash?: string
}

export const COOKIE_NAME = 'mc_auth'
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30

const ENC = new TextEncoder()

function parseEnvUsers(): User[] {
  const raw = process.env.MC_USERS
  if (raw) {
    try {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        return arr
          .filter(u => u && typeof u.login === 'string' && typeof u.password === 'string')
          .map(u => ({
            login: u.login,
            password: u.password,
            allowed: u.allowed === '*' ? '*' : Array.isArray(u.allowed) ? u.allowed : [],
            is_admin: u.is_admin === true,
          }))
      }
    } catch {}
  }
  const pw = process.env.MC_PASSWORD
  if (pw) return [{ login: 'admin', password: pw, allowed: '*' }]
  return []
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', ENC.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const buf = await crypto.subtle.sign('HMAC', key, ENC.encode(data))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function b64uEncode(str: string): string {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function b64uDecode(str: string): string {
  return decodeURIComponent(escape(atob(str.replace(/-/g, '+').replace(/_/g, '/'))))
}

async function resolveAllUsers(): Promise<User[]> {
  const db = await getAuthUsersCached()
  if (db && db.length > 0) return db
  return parseEnvUsers()
}

export async function findUser(login: string): Promise<User | null> {
  const users = await resolveAllUsers()
  return users.find(u => u.login === login) ?? null
}

export async function checkCredentials(login: string, password: string): Promise<User | null> {
  const u = await findUser(login)
  if (!u || u.disabled) return null
  const ok = u.password_hash
    ? await verifyPassword(password, u.password_hash)
    : u.password === password
  return ok ? u : null
}

export async function createToken(login: string): Promise<string> {
  const payload = JSON.stringify({ l: login, t: Date.now() })
  const sig = await hmac(SECRET, payload)
  return b64uEncode(`${payload}.${sig}`)
}

export async function verifyToken(token: string): Promise<User | null> {
  try {
    const decoded = b64uDecode(token)
    const dotIdx = decoded.lastIndexOf('.')
    if (dotIdx === -1) return null
    const payload = decoded.slice(0, dotIdx)
    const sig = decoded.slice(dotIdx + 1)
    const expected = await hmac(SECRET, payload)
    if (sig.length !== expected.length) return null
    let diff = 0
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i)
    if (diff !== 0) return null
    const parsed = JSON.parse(payload) as { l?: string }
    if (!parsed.l) return null
    const u = await findUser(parsed.l)
    return u && !u.disabled ? u : null
  } catch {
    return null
  }
}

export function hasAccess(user: User, slug: string): boolean {
  if (user.is_admin) return true
  if (user.allowed === '*') return true
  if (!Array.isArray(user.allowed)) return false
  if (user.allowed.includes(slug)) return true
  const section = findSectionForItem(slug)
  return !!section && user.allowed.includes(section.key)
}
