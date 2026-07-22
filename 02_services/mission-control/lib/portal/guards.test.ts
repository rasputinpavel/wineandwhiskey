import { describe, it, expect } from 'vitest'
import { checkSelfLockout, type GuardUser } from './guards'

const admin = (login: string, over: Partial<GuardUser> = {}): GuardUser =>
  ({ id: login, login, is_admin: true, disabled: false, ...over })

describe('checkSelfLockout', () => {
  const users: GuardUser[] = [admin('pavel'), admin('anna'), { id: 'grace', login: 'grace', is_admin: false, disabled: false }]

  it('blocks removing your own admin flag', () => {
    const r = checkSelfLockout(users, 'pavel', 'pavel', { is_admin: false })
    expect(r.ok).toBe(false)
  })

  it('blocks disabling yourself', () => {
    const r = checkSelfLockout(users, 'pavel', 'pavel', { disabled: true })
    expect(r.ok).toBe(false)
  })

  it('blocks demoting the last remaining admin', () => {
    const solo: GuardUser[] = [admin('pavel'), { id: 'grace', login: 'grace', is_admin: false, disabled: false }]
    const r = checkSelfLockout(solo, 'grace', 'pavel', { is_admin: false })
    expect(r.ok).toBe(false)
  })

  it('allows demoting an admin when another enabled admin remains', () => {
    const r = checkSelfLockout(users, 'pavel', 'anna', { is_admin: false })
    expect(r.ok).toBe(true)
  })

  it('treats a disabled admin as not counting toward the last-admin check', () => {
    const withDisabled: GuardUser[] = [admin('pavel'), admin('anna', { disabled: true })]
    const r = checkSelfLockout(withDisabled, 'x', 'pavel', { is_admin: false })
    expect(r.ok).toBe(false) // pavel is the only *enabled* admin
  })
})
