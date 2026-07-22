import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from './password'

describe('password hashing', () => {
  it('verifies a correct password', async () => {
    const stored = await hashPassword('s3cret-pass')
    expect(stored.startsWith('pbkdf2$')).toBe(true)
    expect(await verifyPassword('s3cret-pass', stored)).toBe(true)
  })

  it('rejects a wrong password', async () => {
    const stored = await hashPassword('s3cret-pass')
    expect(await verifyPassword('wrong', stored)).toBe(false)
  })

  it('produces a different salt each time', async () => {
    const a = await hashPassword('same')
    const b = await hashPassword('same')
    expect(a).not.toBe(b)
    expect(await verifyPassword('same', a)).toBe(true)
    expect(await verifyPassword('same', b)).toBe(true)
  })

  it('returns false on a malformed stored value', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false)
    expect(await verifyPassword('x', 'pbkdf2$abc$salt$hash')).toBe(false)
  })
})
