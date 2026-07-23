# Sales Lead Ownership & Duplicate Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each sales manager a default "my leads" view (with a My/All toggle) and block creating a lead whose name already exists, naming its current owner.

**Architecture:** Add a `sales_name` to portal users; a lead's free-text `assignee` conventionally holds that name. The sales list page reads the logged-in user and filters `assignee == sales_name` by default. A generated `name_norm` column + an app-side `normalizeName()` power an exact duplicate check in the create API, which returns a 409 the form turns into an "assigned to X / Claim it" panel.

**Tech Stack:** Next.js 15 App Router (`next start` on Railway), `@supabase/supabase-js` (PostgREST, schema `sales` + `portal`), vitest, Tailwind. All existing.

**Migration note:** SQL migrations are applied **manually by the user** in the Supabase SQL Editor. Task 1 writes the file only.

**UI copy:** English (portal convention).

---

## File Structure

**Create:**
- `supabase/migrations/033_sales_ownership.sql` — `portal.users.sales_name`, `sales.lead.name_norm` + indexes
- `lib/sales/dedup.ts` — `normalizeName()` + `resolveOwner()` pure helpers
- `lib/sales/dedup.test.ts` — unit tests

**Modify:**
- `lib/auth.ts` — `User` type += `sales_name`; `parseEnvUsers` maps it
- `lib/portal/users-store.ts` — `DbUser`/`PublicUser`/`CreateInput`/`UpdateInput` += `sales_name`; `toAuthUser`, `createUser`, `updateUser`
- `app/(portal)/m/users/UserForm.tsx` — Sales name field; include in create/edit bodies
- `app/(portal)/m/users/[id]/page.tsx` — pass `sales_name` into the form
- `app/api/m/users/route.ts` — POST accepts `sales_name`
- `app/api/m/users/[id]/route.ts` — PATCH accepts `sales_name`
- `app/api/m/sales/leads/route.ts` — duplicate check before insert
- `app/(portal)/m/sales/page.tsx` — owner filter + My/All toggle (reads current user)
- `app/(portal)/m/sales/new/page.tsx` — read current user, pass `salesName` to the form
- `components/modules/sales/NewLeadFormClient.tsx` — prefill assignee, handle 409 duplicate panel + Claim

---

## Task 1: Migration `033_sales_ownership.sql`

**Files:**
- Create: `supabase/migrations/033_sales_ownership.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/033_sales_ownership.sql`:

```sql
-- Sales lead ownership + duplicate detection.
--
-- 1) portal.users.sales_name — links a portal login to the free-text `assignee`
--    shown on the leads they own. The sales list uses it for the "my leads"
--    default filter; a lead's assignee is set to this value.
-- 2) sales.lead.name_norm — normalized name (lower + collapse whitespace + trim)
--    for duplicate detection on manual lead creation. GENERATED + STORED so it
--    stays in sync and is indexable. The app's normalizeName() in
--    lib/sales/dedup.ts must produce the IDENTICAL string.
--
-- Manual-apply migration (service key is PostgREST, not DDL). portal + sales
-- are already exposed schemas; no settings change needed.

alter table portal.users add column if not exists sales_name text;

alter table sales.lead add column if not exists name_norm text
  generated always as (lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))) stored;

create index if not exists lead_name_norm_idx on sales.lead (name_norm);
create index if not exists lead_assignee_idx  on sales.lead (assignee);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/033_sales_ownership.sql
git commit -m "feat(sales): migration — sales_name + name_norm for ownership/dedup"
```

- [ ] **Step 3: MANUAL (user) — apply in Supabase SQL Editor**

Ask the user to run `033_sales_ownership.sql`. Code Tasks 2-7 do not require the columns to exist to compile, but the runtime verification in Task 8 does.

---

## Task 2: Identity plumbing — `sales_name` in auth + store

**Files:**
- Modify: `lib/auth.ts`
- Modify: `lib/portal/users-store.ts`

- [ ] **Step 1: Add `sales_name` to the `User` type**

In `lib/auth.ts`, the `User` type currently ends with `password?` / `password_hash?`. Add `sales_name`:

```ts
export type User = {
  login: string
  allowed: '*' | string[]
  is_admin?: boolean
  disabled?: boolean
  sales_name?: string
  password?: string
  password_hash?: string
}
```

- [ ] **Step 2: Map `sales_name` in `parseEnvUsers`**

In `lib/auth.ts` `parseEnvUsers`, extend the `.map(...)` object (currently ends at `is_admin: u.is_admin === true,`):

```ts
          .map(u => ({
            login: u.login,
            password: u.password,
            allowed: u.allowed === '*' ? '*' : Array.isArray(u.allowed) ? u.allowed : [],
            is_admin: u.is_admin === true,
            sales_name: typeof u.sales_name === 'string' ? u.sales_name : undefined,
          }))
```

- [ ] **Step 3: Add `sales_name` throughout `users-store.ts`**

In `lib/portal/users-store.ts`:

(a) `DbUser` type — add after `disabled`:
```ts
  sales_name: string | null
```

(b) `toAuthUser` — add to the returned object:
```ts
    sales_name: r.sales_name ?? undefined,
```

(c) `CreateInput` type — add:
```ts
  sales_name?: string | null
```

(d) `createUser` insert object — add `sales_name`:
```ts
    .insert({ login: input.login, password_hash, allowed: input.allowed, is_admin: input.is_admin, sales_name: input.sales_name ?? null })
```

(e) `UpdateInput` type — add:
```ts
  sales_name?: string | null
```

(f) `updateUser` — add a patch line alongside the others (after the `disabled` line):
```ts
  if (input.sales_name !== undefined) patch.sales_name = input.sales_name
```

`PublicUser` is `Omit<DbUser, 'password_hash'>`, so it automatically includes `sales_name` — no change needed there.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/auth.ts lib/portal/users-store.ts
git commit -m "feat(sales): carry sales_name through auth + users-store"
```

---

## Task 3: Users admin form — Sales name field

**Files:**
- Modify: `app/(portal)/m/users/UserForm.tsx`
- Modify: `app/(portal)/m/users/[id]/page.tsx`
- Modify: `app/api/m/users/route.ts`
- Modify: `app/api/m/users/[id]/route.ts`

- [ ] **Step 1: Add `sales_name` to `ExistingUser` + form state**

In `app/(portal)/m/users/UserForm.tsx`:

(a) Extend `ExistingUser`:
```ts
export type ExistingUser = {
  id: string; login: string; is_admin: boolean; disabled: boolean; allowed: '*' | string[]; sales_name?: string | null
}
```

(b) Add state next to the other `useState` calls:
```ts
  const [salesName, setSalesName] = useState(user?.sales_name ?? '')
```

(c) Add the input right after the password `<label>...<input .../>` block (before the Admin checkbox):
```tsx
      <label className="mb-1 block text-sm font-medium">Sales name</label>
      <input value={salesName} onChange={e => setSalesName(e.target.value)}
        placeholder="Name shown on leads this person owns (e.g. Grace)"
        className="mb-4 w-full rounded border border-pale-stone px-3 py-2 text-sm" />
```

(d) Include it in BOTH request bodies inside `submit()`. In the edit branch body object:
```ts
        const body: Record<string, unknown> = { allowed, is_admin: isAdmin, sales_name: salesName || null }
```
In the create branch `fetch('/api/m/users', ...)` body:
```ts
          body: JSON.stringify({ login, password, allowed, is_admin: isAdmin, sales_name: salesName || null }),
```

- [ ] **Step 2: Pass `sales_name` from the edit page**

In `app/(portal)/m/users/[id]/page.tsx`, the `<UserForm ... user={{ ... }} />` object — add `sales_name`:
```tsx
          user={{ id: user.id, login: user.login, is_admin: user.is_admin, disabled: user.disabled, allowed: user.allowed, sales_name: user.sales_name }} />
```

- [ ] **Step 3: Accept `sales_name` in the create route**

In `app/api/m/users/route.ts` `POST`, after the `const is_admin = ...` line, add:
```ts
  const sales_name = typeof body.sales_name === 'string' && body.sales_name.trim() ? body.sales_name.trim() : null
```
and pass it into `createUser`:
```ts
    const { user, error } = await createUser({ login, password, allowed, is_admin, sales_name })
```

- [ ] **Step 4: Accept `sales_name` in the update route**

In `app/api/m/users/[id]/route.ts` `PATCH`, alongside the other `input.*` assignments, add:
```ts
  if (typeof body.sales_name === 'string') input.sales_name = body.sales_name.trim() || null
  else if (body.sales_name === null) input.sales_name = null
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add "app/(portal)/m/users/UserForm.tsx" "app/(portal)/m/users/[id]/page.tsx" app/api/m/users/route.ts "app/api/m/users/[id]/route.ts"
git commit -m "feat(sales): manage sales_name from the Users admin form"
```

---

## Task 4: Pure helpers — `normalizeName` + `resolveOwner`

**Files:**
- Create: `lib/sales/dedup.ts`
- Test: `lib/sales/dedup.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/sales/dedup.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { normalizeName, resolveOwner } from './dedup'

describe('normalizeName (must match SQL name_norm)', () => {
  it('lowercases', () => { expect(normalizeName('Kata Rock')).toBe('kata rock') })
  it('collapses internal whitespace', () => { expect(normalizeName('Kata   Rock')).toBe('kata rock') })
  it('trims ends', () => { expect(normalizeName('  Kata Rock  ')).toBe('kata rock') })
  it('normalizes tabs/newlines', () => { expect(normalizeName('Kata\tRock\nCafe')).toBe('kata rock cafe') })
})

describe('resolveOwner', () => {
  it('explicit mine wins (with sales_name)', () => {
    expect(resolveOwner({ paramOwner: 'mine', salesName: 'Grace', isAdmin: false })).toBe('mine')
  })
  it('explicit all wins', () => {
    expect(resolveOwner({ paramOwner: 'all', salesName: 'Grace', isAdmin: false })).toBe('all')
  })
  it('manager with sales_name defaults to mine', () => {
    expect(resolveOwner({ paramOwner: undefined, salesName: 'Grace', isAdmin: false })).toBe('mine')
  })
  it('admin defaults to all', () => {
    expect(resolveOwner({ paramOwner: undefined, salesName: 'Grace', isAdmin: true })).toBe('all')
  })
  it('no sales_name is always all', () => {
    expect(resolveOwner({ paramOwner: undefined, salesName: undefined, isAdmin: false })).toBe('all')
  })
  it('mine is downgraded to all without a sales_name', () => {
    expect(resolveOwner({ paramOwner: 'mine', salesName: undefined, isAdmin: false })).toBe('all')
  })
})
```

- [ ] **Step 2: Run it, verify it FAILS**

Run: `npx vitest run lib/sales/dedup.test.ts`
Expected: FAIL — module `./dedup` not found.

- [ ] **Step 3: Write the implementation**

Create `lib/sales/dedup.ts`:

```ts
// Duplicate-detection + ownership helpers for the sales CRM.

// Normalized lead name for duplicate detection. MUST produce the identical
// string to the SQL generated column sales.lead.name_norm
// (lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))) — see migration 033.
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim()
}

// Which lead set to show: the logged-in user's own leads ('mine') or all.
// - an explicit param always wins (but 'mine' needs a sales_name to be meaningful)
// - otherwise a manager with a sales_name defaults to 'mine', everyone else 'all'
export function resolveOwner(
  { paramOwner, salesName, isAdmin }: { paramOwner?: string; salesName?: string; isAdmin?: boolean },
): 'mine' | 'all' {
  const wantMine = paramOwner === 'mine' || (paramOwner !== 'all' && !!salesName && !isAdmin)
  return wantMine && !!salesName ? 'mine' : 'all'
}
```

- [ ] **Step 4: Run tests, verify PASS**

Run: `npx vitest run lib/sales/dedup.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/sales/dedup.ts lib/sales/dedup.test.ts
git commit -m "feat(sales): normalizeName + resolveOwner helpers"
```

---

## Task 5: Duplicate check on lead creation

**Files:**
- Modify: `app/api/m/sales/leads/route.ts`

- [ ] **Step 1: Import `normalizeName`**

In `app/api/m/sales/leads/route.ts`, add to the imports:
```ts
import { normalizeName } from '@/lib/sales/dedup'
```

- [ ] **Step 2: Add the duplicate check before the insert**

The route validates `name` (400 if empty), then builds `row` and does `await sbSales.from('lead').insert(row)`. Insert a duplicate check **after** the `name` check and **before** the insert:

```ts
  // Duplicate guard: block manual creation of a lead whose normalized name
  // already exists. Owned → the form shows the owner; unassigned → the form
  // offers to claim it. Matches the generated name_norm column (migration 033).
  const norm = normalizeName(name)
  const { data: dup } = await sbSales.from('lead')
    .select('id, name, assignee').eq('name_norm', norm).limit(1).maybeSingle()
  if (dup) {
    return NextResponse.json(
      { error: 'duplicate', duplicate: { id: dup.id, name: dup.name, assignee: dup.assignee ?? null } },
      { status: 409 },
    )
  }
```

Make sure this sits before `const row = {...}` / the insert. Leave the activity log and the rest untouched.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/m/sales/leads/route.ts
git commit -m "feat(sales): block duplicate lead names on create (409 with owner)"
```

---

## Task 6: Sales list — owner filter + My/All toggle

**Files:**
- Modify: `app/(portal)/m/sales/page.tsx`

- [ ] **Step 1: Add imports (current user + resolveOwner)**

At the top of `app/(portal)/m/sales/page.tsx`, add:
```ts
import { cookies } from 'next/headers'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'
import { resolveOwner } from '@/lib/sales/dedup'
```

- [ ] **Step 2: Add `owner` to `SearchParams`**

In the `SearchParams` type, add:
```ts
  owner?: 'mine' | 'all'
```

- [ ] **Step 3: Resolve the current user + effective owner, and filter the query**

Right after `const sp = await searchParams`, add:
```ts
  const token = (await cookies()).get(COOKIE_NAME)?.value
  const currentUser = token ? await verifyToken(token) : null
  const salesName = currentUser?.sales_name
  const owner = resolveOwner({ paramOwner: sp.owner, salesName, isAdmin: currentUser?.is_admin })
```

Then, in the query-building block (after the other `.eq` filters, e.g. right after the district filter), add the assignee narrowing:
```ts
  if (owner === 'mine' && salesName) {
    query = query.eq('assignee', salesName)
  }
```

- [ ] **Step 4: Render the My/All toggle**

In the `<PaneHeader ... rightSlot={...}>`, the toggle group currently holds only Table/Kanban. Add a My/All group **before** the Table/Kanban `<div className="flex border ...">`, shown only when the user has a `sales_name`:
```tsx
            {salesName && (
              <div className="flex border border-pale-stone rounded-sm overflow-hidden">
                <Link
                  href={makeHref(sp, { owner: 'mine' })}
                  className={owner === 'mine' ? 'text-xs px-3 py-1.5 bg-deep-black text-warm-white' : 'text-xs px-3 py-1.5 text-graphite hover:text-wine-red'}
                >My leads</Link>
                <Link
                  href={makeHref(sp, { owner: 'all' })}
                  className={owner === 'all' ? 'text-xs px-3 py-1.5 bg-deep-black text-warm-white' : 'text-xs px-3 py-1.5 text-graphite hover:text-wine-red'}
                >All</Link>
              </div>
            )}
```

`makeHref` already serializes any string value in `SearchParams`, so `owner` threads through automatically — no change to `makeHref` needed. The stage-count chips are computed from the fetched (owner-scoped) `leads`, so they already reflect the current view.

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: build succeeds; `/m/sales` present.

- [ ] **Step 6: Commit**

```bash
git add "app/(portal)/m/sales/page.tsx"
git commit -m "feat(sales): default my-leads filter + My/All toggle"
```

---

## Task 7: New lead form — prefill assignee + duplicate panel + Claim

**Files:**
- Modify: `app/(portal)/m/sales/new/page.tsx`
- Modify: `components/modules/sales/NewLeadFormClient.tsx`

- [ ] **Step 1: Pass the current user's sales_name into the form**

Replace `app/(portal)/m/sales/new/page.tsx` with (adds auth read + `salesName` prop; keeps the existing layout):

```tsx
import Link from 'next/link'
import { cookies } from 'next/headers'
import { findItem } from '@/lib/registry'
import { PaneHeader } from '@/components/shell/PaneHeader'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'
import { NewLeadFormClient } from '@/components/modules/sales/NewLeadFormClient'

export const dynamic = 'force-dynamic'

export default async function NewLeadPage() {
  const item = findItem('sales-crm')!
  const token = (await cookies()).get(COOKIE_NAME)?.value
  const user = token ? await verifyToken(token) : null
  return (
    <>
      <PaneHeader
        item={item}
        rightSlot={
          <Link href="/m/sales" className="text-xs px-3 py-1.5 border border-pale-stone hover:border-wine-red hover:text-wine-red text-graphite rounded-sm">
            ← Back to leads
          </Link>
        }
      />
      <div className="flex-1 overflow-y-auto bg-warm-white">
        <div className="max-w-[760px] mx-auto px-6 py-6 space-y-4">
          <div>
            <div className="overline text-graphite">B2B outreach</div>
            <h1 className="font-display text-deep-black uppercase tracking-display" style={{ fontSize: 36, lineHeight: 1 }}>
              Add lead
            </h1>
            <p className="text-sm text-graphite mt-1 max-w-xl">
              For leads that didn’t come from Apify — referrals, walk-ins, places not on Google Maps yet.
            </p>
          </div>
          <NewLeadFormClient salesName={user?.sales_name ?? ''} />
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Prefill assignee + handle the 409 duplicate in the form**

In `components/modules/sales/NewLeadFormClient.tsx`:

(a) Change the component signature + assignee initial state, and add duplicate state. Replace the `export function NewLeadFormClient() {` line and the `assignee`/`error` state lines:

```tsx
type Duplicate = { id: string; name: string; assignee: string | null }

export function NewLeadFormClient({ salesName }: { salesName: string }) {
  const router = useRouter()
  const [name, setName]                 = useState('')
  const [kind, setKind]                 = useState<BusinessKind>('restaurant')
  const [stage, setStage]               = useState<LeadStage>('lead')
  const [district, setDistrict]         = useState<District | ''>('')
  const [address, setAddress]           = useState('')
  const [phone, setPhone]               = useState('')
  const [website, setWebsite]           = useState('')
  const [assignee, setAssignee]         = useState(salesName)
  const [notes, setNotes]               = useState('')
  const [submitting, setSubmitting]     = useState(false)
  const [error, setError]               = useState<string | null>(null)
  const [duplicate, setDuplicate]       = useState<Duplicate | null>(null)
  const [claiming, setClaiming]         = useState(false)
```

(b) Replace the `submit` handler's tail — everything from `setSubmitting(true)` through the closing of the `finally` block (the current `try/catch/finally`) — with the following. Do NOT re-add the `setError(null)` / `if (!name.trim())` guard above it; that stays as-is. This replaces the single existing `setSubmitting(true)` line, so it is not duplicated:

```tsx
    setSubmitting(true)
    setDuplicate(null)
    try {
      const res = await fetch('/api/m/sales/leads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, business_kind: kind, stage,
          district: district || undefined,
          address: address || undefined,
          phone:   phone   || undefined,
          website: website || undefined,
          assignee: assignee || undefined,
          notes:   notes   || undefined,
        }),
      })
      const json = await res.json()
      if (res.status === 409 && json.error === 'duplicate') { setDuplicate(json.duplicate as Duplicate); return }
      if (!res.ok) { setError(json.error ?? 'Failed to create lead'); return }
      router.push(`/m/sales/${json.lead.id}`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
```

(c) Add a `claim` handler right after the `submit` function:

```tsx
  async function claim() {
    if (!duplicate) return
    setClaiming(true); setError(null)
    try {
      const res = await fetch(`/api/m/sales/leads/${duplicate.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignee: salesName }),
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error ?? 'Failed to claim'); return }
      router.push(`/m/sales/${duplicate.id}`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setClaiming(false)
    }
  }
```

(d) Render the duplicate panel. Just above the existing `{error && ...}` line, add:

```tsx
      {duplicate && (
        <div className="text-sm bg-amber-gold/10 border border-amber-gold/50 rounded-sm px-3 py-3 space-y-2">
          {duplicate.assignee ? (
            <div>Lead <strong>“{duplicate.name}”</strong> already exists — assigned to <strong>{duplicate.assignee}</strong>.</div>
          ) : (
            <div>Lead <strong>“{duplicate.name}”</strong> already exists and is unassigned.</div>
          )}
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => router.push(`/m/sales/${duplicate.id}`)}
              className="text-xs px-3 py-1.5 border border-pale-stone text-graphite rounded-sm hover:border-wine-red hover:text-wine-red">
              Open lead
            </button>
            {!duplicate.assignee && salesName && (
              <button type="button" onClick={claim} disabled={claiming}
                className="text-xs px-3 py-1.5 bg-wine-red text-warm-white rounded-sm hover:bg-burgundy-deep disabled:opacity-50">
                {claiming ? 'Claiming…' : 'Claim it'}
              </button>
            )}
          </div>
        </div>
      )}
```

(e) Update the assignee field placeholder to reflect the prefill (optional, but clearer). Change the assignee `<input ... placeholder="Who's working this lead" />` to:
```tsx
        <input value={assignee} onChange={e => setAssignee(e.target.value)}
          placeholder="Who's working this lead"
          className="w-full text-sm border border-pale-stone bg-warm-white rounded-sm px-2 py-1.5"
        />
```
(No functional change if it already matches — the value now defaults to `salesName`.)

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add "app/(portal)/m/sales/new/page.tsx" components/modules/sales/NewLeadFormClient.tsx
git commit -m "feat(sales): prefill assignee, show duplicate owner, claim unassigned"
```

---

## Task 8: Rollout + verification

- [ ] **Step 1: MANUAL (user) — apply migration**
Confirm `033_sales_ownership.sql` was run in Supabase (Task 1 Step 3).

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all suites pass (existing + `dedup`).

- [ ] **Step 3: MANUAL (user) — set Grace's Sales name**
As admin, open `/m/users` → edit **grace** → set **Sales name** = `Grace` → Save. (Optionally set other managers' Sales name to match their existing `assignee` values, e.g. "Irina"/"Benz", so their leads light up under "My leads".)

- [ ] **Step 4: MANUAL (user) — verify end-to-end**
  - [ ] Log in as Grace → `/m/sales` shows only her leads (assignee "Grace"); a **My leads / All** toggle is present; **All** shows everyone.
  - [ ] Add lead → assignee field is pre-filled with "Grace".
  - [ ] Add a lead whose name matches an existing owned lead → blocked with "assigned to <owner>" + Open lead; no duplicate created.
  - [ ] Add a lead whose name matches an existing **unassigned** lead → "Claim it" appears; clicking it assigns to Grace and opens the lead.
  - [ ] Admin login → `/m/sales` defaults to All.

---

## Notes / out of scope

- `assignee` stays free text (now conventionally a `sales_name`); no managers table.
- Duplicate matching is exact on the normalized name across all districts; near-duplicates with different spelling/punctuation are not caught (v1).
- No reassignment UI beyond Claim; editing `assignee` inline (table/detail) already exists.
