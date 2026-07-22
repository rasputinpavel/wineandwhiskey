# Portal User Administration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Users admin section to the mission-control portal so admins can create/edit users and assign section/item-level access from the UI, replacing hand-edited `MC_USERS` env JSON.

**Architecture:** Users move to a Supabase table `portal.users`. `lib/auth.ts` resolves users from a 30s-TTL in-memory cache of that table, falling back to the existing `MC_USERS`/`MC_PASSWORD` env source when the table is empty or the DB is unreachable (so the owner can never be locked out). Passwords are PBKDF2-SHA256 (Web Crypto, Edge+Node). The access model (`allowed: '*' | string[]` of section keys / item slugs) is unchanged; two new per-user fields — `is_admin` and `disabled` — gate the Users section and account state. A native `/m/users` module provides list + create/edit UI, guarded by `is_admin` in both middleware and the API routes.

**Tech Stack:** Next.js 15 (App Router, `next start` on Railway), `@supabase/supabase-js` (service-role, PostgREST), Web Crypto, vitest, Tailwind. All existing in the repo.

**Runtime note:** Middleware runs in the Edge runtime but under a single long-lived `next start` Node process on Railway, so module-level cache persists across requests (the 30s TTL genuinely caches). `@supabase/supabase-js` is fetch-based and Edge-compatible.

**Migration note:** Per project convention, SQL migrations are applied **manually by the user** in the Supabase SQL Editor (the service key is PostgREST, not DDL). Task 1 only writes the file; a checklist item flags the manual apply + Exposed-schemas step.

---

## File Structure

**Create:**
- `supabase/migrations/032_portal_users.sql` — `portal` schema + `users` table
- `lib/portal/password.ts` — PBKDF2 hash/verify
- `lib/portal/password.test.ts` — hash round-trip tests
- `lib/portal/users-store.ts` — DB CRUD + cached list + cache invalidation
- `lib/portal/guards.ts` — self-lockout rule checks
- `lib/portal/guards.test.ts` — self-lockout tests
- `lib/portal/require-admin.ts` — `requireAdmin(req)` helper for API routes
- `app/api/m/users/route.ts` — GET (list) + POST (create)
- `app/api/m/users/[id]/route.ts` — PATCH (update)
- `app/(portal)/m/users/page.tsx` — list page (server)
- `app/(portal)/m/users/UsersTableClient.tsx` — list interactions (disable/enable)
- `app/(portal)/m/users/new/page.tsx` — create page (server shell)
- `app/(portal)/m/users/[id]/page.tsx` — edit page (server shell)
- `app/(portal)/m/users/UserForm.tsx` — shared create/edit form + access tree (client)

**Modify:**
- `lib/supabase.ts` — add `sbPortal` client
- `lib/auth.ts` — `User` type (+`is_admin`,`disabled`,`password_hash`); async `findUser`; DB-first resolution with env fallback; `hashPassword` on writes; `is_admin`⇒full access; `disabled`⇒login/verify fail
- `lib/auth.test.ts` — **Create** — hasAccess/disabled/source-selection tests
- `app/api/auth/login/route.ts` — `await checkCredentials(...)`
- `lib/registry.ts` — add `users` item to the `tech` section
- `app/(portal)/layout.tsx` — expose `users` slug only to admins; pass `isAdmin` to shell
- `middleware.ts` — hard `is_admin` gate for `/m/users` and `/api/m/users`

---

## Task 1: Database migration + Supabase client

**Files:**
- Create: `supabase/migrations/032_portal_users.sql`
- Modify: `lib/supabase.ts` (after the `sbPromo` client, ~line 22)

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/032_portal_users.sql`:

```sql
-- Portal user administration. Moves portal logins out of the MC_USERS env var
-- into a table so admins can manage users + access from the UI (no redeploy).
--
-- Access model is unchanged from lib/auth.ts: `allowed` is '*' (full access) or
-- a jsonb array mixing SECTION KEYS ('sales' = all items in the section) and
-- ITEM SLUGS ('sales-playbook' = one item). Two new flags:
--   • is_admin — can open the Users section and manage everyone; implies full access
--   • disabled — account cannot log in
--
-- Passwords are PBKDF2-SHA256, stored as 'pbkdf2$<iter>$<saltB64>$<hashB64>'
-- (see lib/portal/password.ts). Never store plaintext.
--
-- IMPORTANT: After running this migration, add `portal` to the exposed schemas
-- in Supabase → Project Settings → API → Exposed schemas, or PostgREST returns
-- 404 on /rest/v1/ queries against portal-prefixed tables.

create schema if not exists portal;

create table if not exists portal.users (
  id            uuid primary key default gen_random_uuid(),
  login         text not null unique,
  password_hash text not null,
  allowed       jsonb not null default '[]'::jsonb,  -- '*' or ["sales", ...]
  is_admin      boolean not null default false,
  disabled      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Bump updated_at on every write.
create or replace function portal.touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_users_touch on portal.users;
create trigger trg_users_touch before update on portal.users
  for each row execute function portal.touch_updated_at();
```

- [ ] **Step 2: Add the `sbPortal` client**

In `lib/supabase.ts`, immediately after the `sbPromo` export, add:

```ts
// Portal user administration — logins, access, admin flags. See migration
// 032_portal_users.sql. Schema `portal` must be added to "Exposed schemas".
export const sbPortal = createClient(url, key, { db: { schema: 'portal' } })
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors from `lib/supabase.ts`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/032_portal_users.sql lib/supabase.ts
git commit -m "feat(portal): migration + client for portal.users table"
```

- [ ] **Step 5: MANUAL (user) — apply migration**

Ask the user to (a) run `032_portal_users.sql` in the Supabase SQL Editor and (b) add `portal` to Exposed schemas. Do not proceed to Task 7's manual verification until confirmed. (Code tasks 2-6 do not need the table to exist yet.)

---

## Task 2: Password hashing module

**Files:**
- Create: `lib/portal/password.ts`
- Test: `lib/portal/password.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/portal/password.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/portal/password.test.ts`
Expected: FAIL — cannot find module `./password`.

- [ ] **Step 3: Write the implementation**

Create `lib/portal/password.ts`:

```ts
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

function fromB64(str: string): Uint8Array {
  const bin = atob(str)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
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
  let salt: Uint8Array, expected: Uint8Array
  try { salt = fromB64(parts[2]); expected = fromB64(parts[3]) } catch { return false }
  const actual = await derive(password, salt, iterations)
  if (actual.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i]
  return diff === 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/portal/password.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/portal/password.ts lib/portal/password.test.ts
git commit -m "feat(portal): PBKDF2 password hashing"
```

---

## Task 3: Self-lockout guards

**Files:**
- Create: `lib/portal/guards.ts`
- Test: `lib/portal/guards.test.ts`

These are pure functions over the current user list + the proposed change, so they are trivially testable and reused by the API routes.

- [ ] **Step 1: Write the failing test**

Create `lib/portal/guards.test.ts`:

```ts
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
    // anna (not present) irrelevant; pavel is the only admin
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/portal/guards.test.ts`
Expected: FAIL — cannot find module `./guards`.

- [ ] **Step 3: Write the implementation**

Create `lib/portal/guards.ts`:

```ts
// Self-lockout protection for user administration. Pure over the current user
// list + the proposed change, so it's enforced in the API (not just the UI).

export type GuardUser = { id: string; login: string; is_admin: boolean; disabled: boolean }
export type GuardChange = { is_admin?: boolean; disabled?: boolean }
export type GuardResult = { ok: true } | { ok: false; reason: string }

/**
 * @param users     current users (from DB)
 * @param actorLogin login of the admin making the change
 * @param targetId   id of the user being changed
 * @param change     proposed field changes
 */
export function checkSelfLockout(
  users: GuardUser[], actorLogin: string, targetId: string, change: GuardChange,
): GuardResult {
  const target = users.find(u => u.id === targetId)
  if (!target) return { ok: true } // creation / unknown target — nothing to protect

  const isSelf = target.login === actorLogin

  if (isSelf && change.is_admin === false) {
    return { ok: false, reason: 'You cannot remove your own admin rights.' }
  }
  if (isSelf && change.disabled === true) {
    return { ok: false, reason: 'You cannot disable your own account.' }
  }

  // Last-enabled-admin protection: block a change that would drop the count of
  // enabled admins to zero.
  const losesAdmin = target.is_admin && (change.is_admin === false || change.disabled === true)
  if (losesAdmin) {
    const enabledAdmins = users.filter(u => u.is_admin && !u.disabled)
    const remaining = enabledAdmins.filter(u => u.id !== target.id)
    if (remaining.length === 0) {
      return { ok: false, reason: 'This is the last active admin — cannot demote or disable.' }
    }
  }

  return { ok: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/portal/guards.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/portal/guards.ts lib/portal/guards.test.ts
git commit -m "feat(portal): self-lockout guard rules"
```

---

## Task 4: User store (DB CRUD + cached list)

**Files:**
- Create: `lib/portal/users-store.ts`

This is the single choke point for reading/writing `portal.users`. It owns the 30s cache and its invalidation. No unit test here (it needs a live DB); it is exercised via Task 5's auth tests (which mock it) and Task 7's manual verification.

- [ ] **Step 1: Write the implementation**

Create `lib/portal/users-store.ts`:

```ts
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
```

- [ ] **Step 2: Verify it compiles** (types wire up in Task 5; expect a `User` shape error until then — that is fine, do not fix here)

Run: `npx tsc --noEmit 2>&1 | grep users-store || echo "no users-store errors"`
Expected: errors only about `is_admin`/`disabled`/`password_hash` not on `User` — resolved in Task 5.

- [ ] **Step 3: Commit**

```bash
git add lib/portal/users-store.ts
git commit -m "feat(portal): users-store (DB CRUD + 30s auth cache)"
```

---

## Task 5: Wire `lib/auth.ts` to the store (DB-first, env fallback)

**Files:**
- Modify: `lib/auth.ts`
- Create: `lib/auth.test.ts`
- Modify: `app/api/auth/login/route.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/auth.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/auth.test.ts`
Expected: FAIL — `findUser` is not async / `is_admin` not on `User`.

- [ ] **Step 3: Edit `lib/auth.ts`**

Replace the `User` type (lines 5-11) with:

```ts
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
```

Add this import at the top (after the existing `findSectionForItem` import):

```ts
import { getAuthUsersCached } from './portal/users-store'
import { verifyPassword } from './portal/password'
```

Rename the existing `parseUsers` to `parseEnvUsers` (it already maps to `{login,password,allowed}` — leave its body, just the name changes) and add the resolver above `findUser`:

```ts
async function resolveAllUsers(): Promise<User[]> {
  const db = await getAuthUsersCached()
  if (db && db.length > 0) return db
  return parseEnvUsers()
}
```

Replace `findUser`, `checkCredentials`, and the tail of `verifyToken` with async versions:

```ts
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
```

In `verifyToken`, replace the final two lines (`const parsed = ...; return findUser(parsed.l)`) with:

```ts
    const parsed = JSON.parse(payload) as { l?: string }
    if (!parsed.l) return null
    const u = await findUser(parsed.l)
    return u && !u.disabled ? u : null
```

Add `is_admin` short-circuit at the top of `hasAccess`:

```ts
export function hasAccess(user: User, slug: string): boolean {
  if (user.is_admin) return true
  if (user.allowed === '*') return true
  if (!Array.isArray(user.allowed)) return false
  if (user.allowed.includes(slug)) return true
  const section = findSectionForItem(slug)
  return !!section && user.allowed.includes(section.key)
}
```

- [ ] **Step 4: Fix the one external caller**

In `app/api/auth/login/route.ts`, change line 9 from `const user = checkCredentials(login, password)` to:

```ts
  const user = await checkCredentials(login, password)
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run lib/auth.test.ts && npx tsc --noEmit`
Expected: auth tests PASS; no type errors (Task 4's `users-store` errors are now resolved).

- [ ] **Step 6: Commit**

```bash
git add lib/auth.ts lib/auth.test.ts app/api/auth/login/route.ts
git commit -m "feat(portal): auth resolves DB users first, env fallback; is_admin/disabled"
```

---

## Task 6: Registry item, sidebar visibility, middleware gate

**Files:**
- Modify: `lib/registry.ts` (tech section, after the `supabase` item ~line 347)
- Modify: `app/(portal)/layout.tsx`
- Modify: `middleware.ts`

- [ ] **Step 1: Add the `users` registry item**

In `lib/registry.ts`, inside the `tech` section `items` array (after the `supabase` item), add:

```ts
      {
        slug: 'users', name: 'Users', icon: '👥', status: 'live',
        description: 'Portal accounts and access. Admins only.',
        route: m('users'),
        embed: { kind: 'native' },
      },
```

- [ ] **Step 2: Expose the item to admins only in the layout**

Replace the body of `app/(portal)/layout.tsx` with:

```tsx
import { cookies } from 'next/headers'
import { AppShell } from '@/components/shell/AppShell'
import { verifyToken, hasAccess, COOKIE_NAME } from '@/lib/auth'
import { ITEMS } from '@/lib/registry'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(COOKIE_NAME)?.value
  const user = token ? await verifyToken(token) : null
  // `users` is admin-only regardless of the allowlist; everything else via hasAccess
  // (admins get all of it because is_admin short-circuits hasAccess).
  const allowedSlugs = user
    ? ITEMS.filter(i => (i.slug === 'users' ? !!user.is_admin : hasAccess(user, i.slug))).map(i => i.slug)
    : []

  return (
    <AppShell allowedSlugs={allowedSlugs} userLogin={user?.login ?? ''}>
      {children}
    </AppShell>
  )
}
```

- [ ] **Step 3: Hard-gate the users routes in middleware**

In `middleware.ts`, immediately after the `if (!user) { ... }` block and before the `/m/` section check, add:

```ts
  // Users admin is is_admin-only — a stronger gate than the allowlist, since the
  // `users` item lives in the tech section and could otherwise be reached via a
  // `tech` section grant. Covers both the page (/m/users) and its API (/api/m/users).
  if (pathname.startsWith('/m/users') || pathname.startsWith('/api/m/users')) {
    if (!user.is_admin) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 })
      }
      const url = request.nextUrl.clone()
      url.pathname = '/'
      return NextResponse.redirect(url)
    }
  }
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/registry.ts "app/(portal)/layout.tsx" middleware.ts
git commit -m "feat(portal): Users item in tech section, admin-only gating"
```

---

## Task 7: API routes (`requireAdmin` + GET/POST/PATCH)

**Files:**
- Create: `lib/portal/require-admin.ts`
- Create: `app/api/m/users/route.ts`
- Create: `app/api/m/users/[id]/route.ts`

Middleware already blocks non-admins from `/api/m/users`, but the routes assert `is_admin` again (defense in depth — `/api/m/*` has no other gate) and need the actor's login for self-lockout checks.

- [ ] **Step 1: Write `requireAdmin`**

Create `lib/portal/require-admin.ts`:

```ts
import { cookies } from 'next/headers'
import { verifyToken, COOKIE_NAME, type User } from '@/lib/auth'

// Resolves the current user from the cookie and asserts admin. Returns the user
// or null; routes turn null into a 403.
export async function requireAdmin(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value
  const user = token ? await verifyToken(token) : null
  return user?.is_admin ? user : null
}
```

- [ ] **Step 2: Write the list + create route**

Create `app/api/m/users/route.ts`:

```ts
// GET  /api/m/users — list all portal users (no password hashes)
// POST /api/m/users — create a user
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/portal/require-admin'
import { listUsers, createUser, getGuardUsers } from '@/lib/portal/users-store'

export const dynamic = 'force-dynamic'

export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  try {
    return NextResponse.json({ users: await listUsers() })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 503 })
  }
}

export async function POST(req: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }

  const login = typeof body.login === 'string' ? body.login.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!login || !password) return NextResponse.json({ error: 'login and password required' }, { status: 400 })

  const allowed: '*' | string[] = body.allowed === '*'
    ? '*'
    : Array.isArray(body.allowed) ? body.allowed.filter((s): s is string => typeof s === 'string') : []
  const is_admin = body.is_admin === true

  // Guard against creating nothing useful is unnecessary; creation can't cause a
  // lockout, so no checkSelfLockout here.
  try {
    const { user, error } = await createUser({ login, password, allowed, is_admin })
    if (error === 'duplicate') return NextResponse.json({ error: 'login already exists' }, { status: 409 })
    if (error) return NextResponse.json({ error }, { status: 503 })
    return NextResponse.json({ user }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 503 })
  }
}
```

- [ ] **Step 3: Write the update route**

Create `app/api/m/users/[id]/route.ts`:

```ts
// PATCH /api/m/users/[id] — update access / admin / disabled / password
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/portal/require-admin'
import { updateUser, getGuardUsers, type UpdateInput } from '@/lib/portal/users-store'
import { checkSelfLockout } from '@/lib/portal/guards'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await params

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }

  const input: UpdateInput = {}
  if (body.allowed === '*') input.allowed = '*'
  else if (Array.isArray(body.allowed)) input.allowed = body.allowed.filter((s): s is string => typeof s === 'string')
  if (typeof body.is_admin === 'boolean') input.is_admin = body.is_admin
  if (typeof body.disabled === 'boolean') input.disabled = body.disabled
  if (typeof body.password === 'string' && body.password) input.password = body.password

  if (Object.keys(input).length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })

  // Self-lockout protection (last-admin / self-demote / self-disable).
  try {
    const guardUsers = await getGuardUsers()
    const guard = checkSelfLockout(guardUsers, admin.login, id, { is_admin: input.is_admin, disabled: input.disabled })
    if (!guard.ok) return NextResponse.json({ error: guard.reason }, { status: 422 })

    const { user, error } = await updateUser(id, input)
    if (error) return NextResponse.json({ error }, { status: 503 })
    return NextResponse.json({ user })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 503 })
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (Note: `getGuardUsers` is imported in `route.ts` only if used; the POST route imports it but does not call it — remove that import if `tsc`/lint flags it as unused. It is used in `[id]/route.ts`.)

Adjust: in `app/api/m/users/route.ts` Step 2, drop `getGuardUsers` from the import list (it is unused there). Final import line:

```ts
import { listUsers, createUser } from '@/lib/portal/users-store'
```

- [ ] **Step 5: Commit**

```bash
git add lib/portal/require-admin.ts app/api/m/users
git commit -m "feat(portal): users admin API (list/create/update) with lockout guards"
```

- [ ] **Step 6: Defer smoke-test**

The API can only be exercised once an admin with `is_admin: true` exists. The current env admin (`MC_PASSWORD`→`admin`) has `is_admin` undefined, so `requireAdmin` returns 403. Bootstrapping an env admin with `is_admin` is done in Task 10 Step 1. Full end-to-end smoke-test happens in Task 10 Step 4 after the UI (Tasks 8-9) is in place.

---

## Task 8: Users list page

**Files:**
- Create: `app/(portal)/m/users/page.tsx`
- Create: `app/(portal)/m/users/UsersTableClient.tsx`

- [ ] **Step 1: Write the list page (server)**

Create `app/(portal)/m/users/page.tsx`:

```tsx
import Link from 'next/link'
import { findItem, SECTIONS } from '@/lib/registry'
import { PaneHeader } from '@/components/shell/PaneHeader'
import { listUsers } from '@/lib/portal/users-store'
import { UsersTableClient } from './UsersTableClient'

export const dynamic = 'force-dynamic'

// Human-readable summary of an `allowed` value using registry labels.
function accessSummary(allowed: '*' | string[]): string {
  if (allowed === '*') return 'Full access'
  if (allowed.length === 0) return 'No access'
  const labels = allowed.map(key => {
    const section = SECTIONS.find(s => s.key === key)
    if (section) return section.label
    const item = findItem(key)
    return item ? item.name : key
  })
  return labels.join(', ')
}

export default async function UsersPage() {
  const item = findItem('users')!
  const users = await listUsers()

  return (
    <div>
      <PaneHeader icon={item.icon} title={item.name} subtitle={item.description} />
      <div className="p-6">
        <div className="mb-4">
          <Link href="/m/users/new" className="inline-block rounded-md bg-deep-black px-4 py-2 text-sm text-warm-white">
            + New user
          </Link>
        </div>
        <UsersTableClient
          users={users.map(u => ({
            id: u.id, login: u.login, is_admin: u.is_admin, disabled: u.disabled,
            access: accessSummary(u.allowed), created_at: u.created_at,
          }))}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write the client table**

Create `app/(portal)/m/users/UsersTableClient.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

type Row = {
  id: string; login: string; is_admin: boolean; disabled: boolean
  access: string; created_at: string
}

export function UsersTableClient({ users }: { users: Row[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function toggleDisabled(u: Row) {
    setBusy(u.id); setError(null)
    const res = await fetch(`/api/m/users/${u.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ disabled: !u.disabled }),
    })
    setBusy(null)
    if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error || 'Failed'); return }
    router.refresh()
  }

  return (
    <div>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-pale-stone text-left text-mid-stone">
            <th className="py-2 pr-4">Login</th>
            <th className="py-2 pr-4">Access</th>
            <th className="py-2 pr-4">Admin</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2 pr-4"></th>
          </tr>
        </thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id} className="border-b border-pale-stone/60">
              <td className="py-2 pr-4 font-medium">{u.login}</td>
              <td className="py-2 pr-4 text-mid-stone">{u.access}</td>
              <td className="py-2 pr-4">{u.is_admin ? '✓' : ''}</td>
              <td className="py-2 pr-4">{u.disabled ? <span className="text-red-600">disabled</span> : 'active'}</td>
              <td className="py-2 pr-4 text-right whitespace-nowrap">
                <Link href={`/m/users/${u.id}`} className="text-deep-black underline mr-3">Edit</Link>
                <button onClick={() => toggleDisabled(u)} disabled={busy === u.id} className="text-mid-stone underline">
                  {u.disabled ? 'Enable' : 'Disable'}
                </button>
              </td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr><td colSpan={5} className="py-6 text-center text-mid-stone">No users yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 3: Verify `PaneHeader` props match**

Run: `grep -n "export function PaneHeader\|icon\|title\|subtitle" components/shell/PaneHeader.tsx | head`
Expected: props include `icon`, `title`, `subtitle`. If the prop names differ, adjust the `<PaneHeader .../>` call to match the actual signature.

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "app/(portal)/m/users/page.tsx" "app/(portal)/m/users/UsersTableClient.tsx"
git commit -m "feat(portal): users list page"
```

---

## Task 9: Create/edit form with access tree

**Files:**
- Create: `app/(portal)/m/users/new/page.tsx`
- Create: `app/(portal)/m/users/[id]/page.tsx`
- Create: `app/(portal)/m/users/UserForm.tsx`

- [ ] **Step 1: Write the shared form (client)**

Create `app/(portal)/m/users/UserForm.tsx`:

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

// Section/item shape passed from the server (from lib/registry SECTIONS).
export type SectionOpt = { key: string; label: string; items: { slug: string; name: string }[] }

export type ExistingUser = {
  id: string; login: string; is_admin: boolean; disabled: boolean; allowed: '*' | string[]
}

type Props = { sections: SectionOpt[]; user?: ExistingUser }

export function UserForm({ sections, user }: Props) {
  const router = useRouter()
  const isEdit = !!user

  const [login, setLogin] = useState(user?.login ?? '')
  const [password, setPassword] = useState('')
  const [isAdmin, setIsAdmin] = useState(user?.is_admin ?? false)
  const [fullAccess, setFullAccess] = useState(user?.allowed === '*')
  const [selected, setSelected] = useState<Set<string>>(
    new Set(Array.isArray(user?.allowed) ? user!.allowed : []),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdPassword, setCreatedPassword] = useState<string | null>(null)

  function toggle(key: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function buildAllowed(): '*' | string[] {
    if (fullAccess) return '*'
    return [...selected]
  }

  async function submit() {
    setBusy(true); setError(null)
    const allowed = buildAllowed()
    try {
      if (isEdit) {
        const body: Record<string, unknown> = { allowed, is_admin: isAdmin }
        if (password) body.password = password
        const res = await fetch(`/api/m/users/${user!.id}`, {
          method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        })
        if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error || 'Failed'); setBusy(false); return }
        router.push('/m/users'); router.refresh()
      } else {
        const res = await fetch('/api/m/users', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ login, password, allowed, is_admin: isAdmin }),
        })
        if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error || 'Failed'); setBusy(false); return }
        // Show the password once, then let the admin return to the list.
        setCreatedPassword(password); setBusy(false)
      }
    } catch (e) { setError((e as Error).message); setBusy(false) }
  }

  if (createdPassword) {
    return (
      <div className="max-w-md">
        <p className="mb-2 text-sm">User <strong>{login}</strong> created.</p>
        <p className="mb-4 text-sm text-mid-stone">
          Password (shown once — copy it now and hand it over):
        </p>
        <code className="block rounded bg-pale-stone/40 px-3 py-2 text-sm">{createdPassword}</code>
        <button onClick={() => { router.push('/m/users'); router.refresh() }}
          className="mt-4 rounded-md bg-deep-black px-4 py-2 text-sm text-warm-white">
          Back to users
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-lg">
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <label className="mb-1 block text-sm font-medium">Login</label>
      <input value={login} onChange={e => setLogin(e.target.value)} disabled={isEdit}
        className="mb-4 w-full rounded border border-pale-stone px-3 py-2 text-sm disabled:bg-pale-stone/30" />

      <label className="mb-1 block text-sm font-medium">{isEdit ? 'New password (leave blank to keep)' : 'Password'}</label>
      <input value={password} onChange={e => setPassword(e.target.value)} type="text" autoComplete="off"
        className="mb-4 w-full rounded border border-pale-stone px-3 py-2 text-sm" />

      <label className="mb-4 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isAdmin} onChange={e => setIsAdmin(e.target.checked)} />
        Admin (can manage users; implies full access)
      </label>

      <label className="mb-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={fullAccess} onChange={e => setFullAccess(e.target.checked)} />
        Full access to all sections
      </label>

      {!fullAccess && !isAdmin && (
        <div className="mb-4 rounded border border-pale-stone p-3">
          <p className="mb-2 text-xs uppercase tracking-wide text-mid-stone">Section access</p>
          {sections.map(s => (
            <div key={s.key} className="mb-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={selected.has(s.key)} onChange={() => toggle(s.key)} />
                {s.label} <span className="text-xs text-mid-stone">(whole section)</span>
              </label>
              {!selected.has(s.key) && (
                <div className="ml-6 mt-1">
                  {s.items.map(it => (
                    <label key={it.slug} className="flex items-center gap-2 text-sm text-mid-stone">
                      <input type="checkbox" checked={selected.has(it.slug)} onChange={() => toggle(it.slug)} />
                      {it.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <button onClick={submit} disabled={busy || (!isEdit && (!login || !password))}
        className="rounded-md bg-deep-black px-4 py-2 text-sm text-warm-white disabled:opacity-40">
        {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create user'}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Write the New page (server)**

Create `app/(portal)/m/users/new/page.tsx`:

```tsx
import { findItem, SECTIONS } from '@/lib/registry'
import { PaneHeader } from '@/components/shell/PaneHeader'
import { UserForm } from '../UserForm'

export const dynamic = 'force-dynamic'

export default function NewUserPage() {
  const item = findItem('users')!
  const sections = SECTIONS.map(s => ({ key: s.key, label: s.label, items: s.items.map(i => ({ slug: i.slug, name: i.name })) }))
  return (
    <div>
      <PaneHeader icon={item.icon} title="New user" subtitle="Create a portal account" />
      <div className="p-6"><UserForm sections={sections} /></div>
    </div>
  )
}
```

- [ ] **Step 3: Write the Edit page (server)**

Create `app/(portal)/m/users/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { findItem, SECTIONS } from '@/lib/registry'
import { PaneHeader } from '@/components/shell/PaneHeader'
import { listUsers } from '@/lib/portal/users-store'
import { UserForm } from '../UserForm'

export const dynamic = 'force-dynamic'

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const item = findItem('users')!
  const users = await listUsers()
  const user = users.find(u => u.id === id)
  if (!user) notFound()

  const sections = SECTIONS.map(s => ({ key: s.key, label: s.label, items: s.items.map(i => ({ slug: i.slug, name: i.name })) }))
  return (
    <div>
      <PaneHeader icon={item.icon} title={`Edit ${user.login}`} subtitle="Portal account and access" />
      <div className="p-6">
        <UserForm sections={sections}
          user={{ id: user.id, login: user.login, is_admin: user.is_admin, disabled: user.disabled, allowed: user.allowed }} />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: build succeeds; `/m/users`, `/m/users/new`, `/m/users/[id]` appear in the route list.

- [ ] **Step 5: Commit**

```bash
git add "app/(portal)/m/users/new" "app/(portal)/m/users/[id]" "app/(portal)/m/users/UserForm.tsx"
git commit -m "feat(portal): user create/edit form with access tree editor"
```

---

## Task 10: Seed the first admin + verify end-to-end

The env admin (`MC_PASSWORD`→`admin`) has `is_admin` undefined, so it can log in but cannot open `/m/users`. We bootstrap by letting env users carry `is_admin`, log in as an env admin once, create the real DB users through the UI, then drop the env vars. No SQL hash juggling.

- [ ] **Step 1: Let env fallback users carry `is_admin`**

In `lib/auth.ts` `parseEnvUsers`, change the `.map(...)` to include the admin flag:

```ts
          .map(u => ({
            login: u.login,
            password: u.password,
            allowed: u.allowed === '*' ? '*' : Array.isArray(u.allowed) ? u.allowed : [],
            is_admin: u.is_admin === true,
          }))
```

- [ ] **Step 2: Commit the env-admin mapper change**

```bash
git add lib/auth.ts
git commit -m "feat(portal): env fallback users can carry is_admin for bootstrap"
```

- [ ] **Step 3: MANUAL (user) — bootstrap the first DB admin**

1. Set `.env.local` (and Railway):

```
MC_USERS=[{"login":"admin","password":"<your-temp-pass>","allowed":"*","is_admin":true}]
```

2. Restart dev / redeploy. Log in as `admin`; you now reach `/m/users`.
3. In the UI, create the real DB admin (e.g. `pavel`, admin, full access) and **Grace** (`allowed: ['sales']`, not admin).
4. Once the DB admin logs in successfully, remove `MC_USERS`/`MC_PASSWORD` from Railway (env fallback then only fires on an empty table / DB outage).

- [ ] **Step 4: MANUAL (user) — full verification checklist**

  - [ ] Migration `032` applied; `portal` in Exposed schemas.
  - [ ] Log in as bootstrap `admin` → sidebar shows **Users** under Техничка.
  - [ ] Create **Grace**, `allowed: ['sales']`, not admin. Password shown once.
  - [ ] Log out; log in as Grace → sidebar shows only **Sales**; `/m/sales` loads.
  - [ ] As Grace, hit `/m/income` directly → redirected to `/`; `GET /api/m/users` → 403.
  - [ ] Back as admin, open Grace → Edit, toggle a section, Save → change reflected within ~30s for Grace without her re-logging.
  - [ ] Try to remove your own admin flag → blocked with a 422 message.
  - [ ] Disable Grace → she can no longer log in.
  - [ ] Remove `MC_USERS`/`MC_PASSWORD` from Railway; confirm DB admin still logs in.

- [ ] **Step 5: Run the full test suite once**

Run: `npm test`
Expected: all suites pass (existing + `password`, `guards`, `auth`).

---

## Notes / out of scope (unchanged from spec)

- No self-service "change my password" for non-admins in v1.
- No audit log of admin actions.
- The pre-existing `sales-crm`/`sales` slug-route mismatch and the generally ungated `/api/m/*` surface are **not** addressed here (tracked separately). This plan only hard-gates `/api/m/users`.
