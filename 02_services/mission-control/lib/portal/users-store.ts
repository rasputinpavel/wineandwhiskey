import { sbPortal } from '@/lib/supabase'
import { hashPassword } from './password'
import type { User } from '@/lib/auth'

// Row shape in portal.users.
export type DbUser = {
  id: string
  login: string
  password_hash: string
  allowed: '*' | string[]
  is_admin: boolean
  disabled: boolean
  created_at: string
  updated_at: string
}

// A DbUser without the password hash — safe to send to the browser.
export type PublicUser = Omit<DbUser, 'password_hash'>

const TTL_MS = 30_000
let cache: { users: User[]; at: number } | null = null

function toAuthUser(r: DbUser): User {
  return {
    login: r.login,
    allowed: r.allowed === '*' ? '*' : Array.isArray(r.allowed) ? r.allowed : [],
    is_admin: r.is_admin,
    disabled: r.disabled,
    password_hash: r.password_hash,
  }
}

function toPublic(r: DbUser): PublicUser {
  const { password_hash, ...rest } = r
  return rest
}

/**
 * Cached list of users in `lib/auth.User` shape for auth resolution.
 * Returns `null` when the DB is unreachable OR the table is empty — either way
 * the caller (lib/auth) should fall back to the env source.
 */
export async function getAuthUsersCached(): Promise<User[] | null> {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return cache.users.length > 0 ? cache.users : null
  }
  try {
    const { data, error } = await sbPortal.from('users').select('*')
    if (error) throw error
    const users = (data as DbUser[]).map(toAuthUser)
    cache = { users, at: Date.now() }
    return users.length > 0 ? users : null
  } catch {
    return null // DB down → env fallback; do not cache the failure
  }
}

// Drop the cache so a just-made change is visible immediately on this instance.
export function invalidateUsersCache(): void {
  cache = null
}

// ─── Admin CRUD (used by the API routes; always fresh, never cached) ────────

export async function listUsers(): Promise<PublicUser[]> {
  const { data, error } = await sbPortal.from('users').select('*').order('created_at', { ascending: true })
  if (error) throw error
  return (data as DbUser[]).map(toPublic)
}

export async function getGuardUsers(): Promise<Pick<DbUser, 'id' | 'login' | 'is_admin' | 'disabled'>[]> {
  const { data, error } = await sbPortal.from('users').select('id, login, is_admin, disabled')
  if (error) throw error
  return data as Pick<DbUser, 'id' | 'login' | 'is_admin' | 'disabled'>[]
}

export type CreateInput = {
  login: string
  password: string
  allowed: '*' | string[]
  is_admin: boolean
}

// Returns { error } for a duplicate login so the route can answer 409.
export async function createUser(input: CreateInput): Promise<{ user?: PublicUser; error?: string }> {
  const password_hash = await hashPassword(input.password)
  const { data, error } = await sbPortal.from('users')
    .insert({ login: input.login, password_hash, allowed: input.allowed, is_admin: input.is_admin })
    .select('*').single()
  if (error) {
    if (error.code === '23505') return { error: 'duplicate' } // unique_violation on login
    return { error: error.message }
  }
  invalidateUsersCache()
  return { user: toPublic(data as DbUser) }
}

export type UpdateInput = {
  allowed?: '*' | string[]
  is_admin?: boolean
  disabled?: boolean
  password?: string // when set, re-hash
}

export async function updateUser(id: string, input: UpdateInput): Promise<{ user?: PublicUser; error?: string }> {
  const patch: Record<string, unknown> = {}
  if (input.allowed !== undefined) patch.allowed = input.allowed
  if (input.is_admin !== undefined) patch.is_admin = input.is_admin
  if (input.disabled !== undefined) patch.disabled = input.disabled
  if (input.password) patch.password_hash = await hashPassword(input.password)
  if (Object.keys(patch).length === 0) return { error: 'nothing to update' }

  const { data, error } = await sbPortal.from('users').update(patch).eq('id', id).select('*').single()
  if (error) return { error: error.message }
  invalidateUsersCache()
  return { user: toPublic(data as DbUser) }
}
