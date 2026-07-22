import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the store so no DB is needed.
vi.mock('./portal/users-store', () => ({ getAuthUsersCached: vi.fn() }))
import { getAuthUsersCached } from './portal/users-store'
import { hasAccess, findUser, type User } from './auth'

const mocked = getAuthUsersCached as unknown as ReturnType<typeof vi.fn>

describe('hasAccess', () => {
  it('grants everything to an admin regardless of allowed', () => {
    const u: User = { login: 'a', allowed: [], is_admin: true }
    expect(hasAccess(u, 'income')).toBe(true)
  })
  it('grants a section key', () => {
    const u: User = { login: 'g', allowed: ['sales'] }
    expect(hasAccess(u, 'sales-playbook')).toBe(true) // sales-playbook is in the sales section
  })
  it('denies an unlisted slug', () => {
    const u: User = { login: 'g', allowed: ['sales'] }
    expect(hasAccess(u, 'income')).toBe(false)
  })
})

describe('findUser (DB-first, env fallback)', () => {
  beforeEach(() => { mocked.mockReset(); delete process.env.MC_USERS; delete process.env.MC_PASSWORD })

  it('uses DB users when the store returns a non-empty list', async () => {
    mocked.mockResolvedValue([{ login: 'grace', allowed: ['sales'], is_admin: false }])
    const u = await findUser('grace')
    expect(u?.allowed).toEqual(['sales'])
  })

  it('falls back to MC_USERS when the store returns null', async () => {
    mocked.mockResolvedValue(null)
    process.env.MC_USERS = JSON.stringify([{ login: 'pavel', password: 'x', allowed: '*' }])
    const u = await findUser('pavel')
    expect(u?.allowed).toBe('*')
  })
})
