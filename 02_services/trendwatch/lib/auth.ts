const SECRET = process.env.TRENDWATCH_SECRET || 'change-me-in-production'
const PASSWORD = process.env.TRENDWATCH_PASSWORD || ''

export const COOKIE_NAME = 'tw_auth'
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 7

const ENC = new TextEncoder()

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

export function checkPassword(input: string): boolean {
  return PASSWORD.length > 0 && input === PASSWORD
}

export async function createToken(): Promise<string> {
  const payload = `tw:${Date.now()}`
  const sig = await hmac(SECRET, payload)
  return b64uEncode(`${payload}.${sig}`)
}

export async function verifyToken(token: string): Promise<boolean> {
  try {
    const decoded = b64uDecode(token)
    const dotIdx = decoded.lastIndexOf('.')
    if (dotIdx === -1) return false
    const payload = decoded.slice(0, dotIdx)
    const sig = decoded.slice(dotIdx + 1)
    const expected = await hmac(SECRET, payload)
    if (sig.length !== expected.length) return false
    let diff = 0
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i)
    return diff === 0
  } catch {
    return false
  }
}
