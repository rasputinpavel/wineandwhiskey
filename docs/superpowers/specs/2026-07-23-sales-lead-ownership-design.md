# Sales Lead Ownership & Duplicate Detection — Design

**Date:** 2026-07-23
**Service:** `02_services/mission-control` — Sales B2B Outreach CRM (`/m/sales`)
**Status:** Approved design, pending implementation plan

## Problem

Two gaps in the Sales CRM:
1. **No "my leads" view.** A manager logging in sees all 40 leads. They should land on their own leads by default, while still being able to see everyone's.
2. **No duplicate protection.** The "Add lead" form inserts unconditionally. Two managers can create the same restaurant, causing territory conflicts. Creating a lead that already exists should be blocked with a clear message naming the current owner.

First user: **Grace**, sales-only access, should see her leads on login and be told when a lead she tries to add already belongs to someone.

## Background (current state, verified)

- `sales.lead.assignee` is **free text** (`013_sales_crm.sql:90`), values like "Irina"/"Benz". No link to the portal login (`user.login`).
- The Sales section is entirely **user-agnostic** — no page/route reads the auth cookie today.
- `POST /api/m/sales/leads` (`app/api/m/sales/leads/route.ts`) inserts with **no duplicate check**. Only dedup anywhere is `google_place_id` unique (scrape path), never by name.
- List page (`app/(portal)/m/sales/page.tsx`) builds a `sbSales` query from search params (stage/kind/district/q/…); there is no owner/assignee filter.

All UI copy in this feature is **English** (portal convention — non-Russian-speaking staff).

## Decisions (locked)

| Question | Decision |
|----------|----------|
| Identity ↔ leads | Add **`sales_name`** to the portal user. A lead's `assignee` stores that name; "my leads" = `assignee == sales_name`. Existing "Irina"/"Benz" leads keep working once those users get a matching `sales_name`. |
| Visibility | **Soft default.** Managers land on their own leads with a **My leads / All** toggle. Territory protection comes from the duplicate check, not from hiding. |
| Admin default | Admins default to **All** (oversight); managers with a `sales_name` default to **My leads**. |
| Duplicate rule | **Block on normalized-name match.** If the existing lead is owned → 409, show owner + "Open lead". If unassigned → offer **Claim it** instead of creating a copy. Match by normalized name across all leads (not district-scoped). |
| Auto-assign | On create, `assignee` pre-fills with the current user's `sales_name` (admins can change it). |

Non-goals (v1): reassignment workflows, per-district territories, fuzzy/punctuation-tolerant name matching, managers-table/enum. `assignee` stays free text (now conventionally set to a `sales_name`).

## Data model changes — migration `033_sales_ownership.sql`

Applied manually by the user (project convention).

```sql
-- Link a portal user to the sales name shown on the leads they own.
alter table portal.users add column if not exists sales_name text;

-- Normalized name for duplicate detection: lower + collapse whitespace + trim.
-- Generated + stored so it stays in sync and can be indexed. The app's
-- normalizeName() must produce the identical string.
alter table sales.lead add column if not exists name_norm text
  generated always as (lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))) stored;

create index if not exists lead_name_norm_idx on sales.lead (name_norm);
create index if not exists lead_assignee_idx  on sales.lead (assignee);
```

`portal.users` already grants `service_role` (migration 032); the new column inherits it. `name_norm` is `STORED` so existing rows backfill on migration.

## Feature A — "My leads" default filter

### Identity plumbing
- `lib/auth.ts` `User` type gains `sales_name?: string`.
- `lib/portal/users-store.ts` `toAuthUser` maps it; `DbUser`/`PublicUser`/`CreateInput`/`UpdateInput` gain `sales_name`. `parseEnvUsers` (`lib/auth.ts`) also maps `sales_name` so env/bootstrap users can carry it.
- Users admin form (`app/(portal)/m/users/UserForm.tsx`) gets a **Sales name** text input (hint: "Name shown on the leads this person owns"). `POST`/`PATCH /api/m/users` accept and persist it.

### List filtering (`app/(portal)/m/sales/page.tsx`)
- Read the current user server-side via the established recipe:
  ```ts
  const token = (await cookies()).get(COOKIE_NAME)?.value
  const user = token ? await verifyToken(token) : null
  ```
- Add `owner?: 'mine' | 'all'` to `SearchParams`.
- Resolve effective owner:
  - explicit `sp.owner` wins;
  - else if `user?.sales_name && !user.is_admin` → `'mine'`;
  - else → `'all'`.
- When effective owner is `'mine'` **and** `user.sales_name` is set, add `.eq('assignee', user.sales_name)` to the query. `'all'` adds no assignee clause.
- **My leads / All toggle**: two links in the header (next to Table/Kanban), built with the existing `makeHref` so all other filters/sort/view persist. `owner` is threaded through `makeHref`. Show the toggle only when `user?.sales_name` is set (otherwise "mine" is meaningless).
- Filter-chip counts (stage tallies) are computed from the already-fetched, owner-scoped result set, so they reflect the current view.

Edge cases: a user with no `sales_name` always sees All (no toggle). Unassigned leads appear only under All — a manager grabs them by switching to All and using Claim/Assign.

## Feature B — duplicate detection on create

### Normalization helper (`lib/sales/dedup.ts`)
```ts
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim()
}
```
Must mirror the SQL `name_norm` expression exactly. Unit-tested.

### API (`POST /api/m/sales/leads`)
Before the insert (`route.ts:48`):
```ts
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
No new lead is inserted on a hit. (Scrape import path is untouched — it dedups by `google_place_id`.)

### Create form (`components/modules/sales/NewLeadFormClient.tsx`)
- The server page passes the current user's `sales_name`; the `assignee` field pre-fills with it.
- On a `409 { error: 'duplicate', duplicate }` response, render a duplicate panel instead of a generic error:
  - `duplicate.assignee` set → `Lead "<name>" already exists — assigned to <assignee>.` with an **Open lead** link (`/m/sales/<id>`).
  - `duplicate.assignee` null → `Lead "<name>" already exists and is unassigned.` with a **Claim it** button → `PATCH /api/m/sales/leads/<id>` with `{ assignee: <mySalesName> }`, then navigate to that lead. (If the current user has no `sales_name`, show Open lead instead of Claim.)

## Data flow

1. Grace logs in → `/m/sales` reads her `user.sales_name` ("Grace"), no `owner` param → effective `'mine'` → query `.eq('assignee', 'Grace')`. She sees only her leads; toggle offers **All**.
2. Grace clicks Add lead → form pre-fills assignee "Grace" → submits "Kata Rock Cafe".
3. API normalizes → finds an existing "kata rock cafe" owned by "Benz" → 409 → form shows *assigned to Benz* + Open lead. No duplicate created.
4. If instead the match were unassigned → form shows **Claim it** → PATCH assigns it to Grace → it now shows under her My leads.

## Error handling

- 409 duplicate → structured `{ error, duplicate }` (above); form branches on it.
- Claim PATCH failure → inline error in the panel; no navigation.
- Missing `name` → existing 400 unchanged.
- User has no `sales_name`: All-only view, no auto-assign prefill, Claim replaced by Open.

## Testing

- Unit: `normalizeName` (case, collapsing internal/edge whitespace, tabs/newlines) — and a documented note that it must equal the SQL `name_norm`.
- Unit: effective-owner resolution (explicit param > manager-default `mine` > admin/no-name `all`) as a small pure helper `resolveOwner({ paramOwner, salesName, isAdmin })` in `lib/sales/dedup.ts` (or a sibling), so the branching is tested without a DB.
- Manual (in plan): apply migration; set Grace's `sales_name`; verify default My-leads view + toggle; attempt a duplicate (owned → blocked with owner; unassigned → Claim works).

## Rollout

1. Write migration `033_sales_ownership.sql`; user applies it in Supabase SQL Editor.
2. Deploy code.
3. Admin opens `/m/users`, sets Grace's **Sales name** = "Grace" (and any other managers' names to match their existing `assignee` values, e.g. "Irina"/"Benz", so their leads light up).
4. Verify with Grace.
