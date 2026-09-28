import { describe, it, expect } from 'vitest'
import { signAdminToken, verifyAdminToken } from './admin-auth'

const SECRET = 'test-secret'

describe('admin token', () => {
  it('accepts a token it just signed', async () => {
    const token = await signAdminToken(SECRET, 60_000)
    expect(await verifyAdminToken(SECRET, token)).toBe(true)
  })

  it('rejects a token signed with a different secret', async () => {
    const token = await signAdminToken('other-secret', 60_000)
    expect(await verifyAdminToken(SECRET, token)).toBe(false)
  })

  it('rejects a tampered payload', async () => {
    const token = await signAdminToken(SECRET, 60_000)
    const [payload, sig] = token.split('.')
    const bumped = String(Number(payload) + 1_000_000)
    expect(await verifyAdminToken(SECRET, `${bumped}.${sig}`)).toBe(false)
  })

  it('rejects an expired token', async () => {
    const token = await signAdminToken(SECRET, -1000)
    expect(await verifyAdminToken(SECRET, token)).toBe(false)
  })

  it('rejects junk', async () => {
    expect(await verifyAdminToken(SECRET, '')).toBe(false)
    expect(await verifyAdminToken(SECRET, 'not-a-token')).toBe(false)
    expect(await verifyAdminToken(SECRET, 'a.b.c')).toBe(false)
  })
})
