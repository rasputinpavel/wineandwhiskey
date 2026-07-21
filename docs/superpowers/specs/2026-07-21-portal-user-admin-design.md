# Portal User Administration — Design

**Date:** 2026-07-21
**Service:** `02_services/mission-control`
**Status:** Approved design, pending implementation plan

## Problem

Portal users live in the `MC_USERS` env var (JSON, plaintext passwords) on Railway.
Adding a user or changing their access requires editing the env var and redeploying.
We want a self-service **Users** admin section inside the portal: create/edit users,
assign section- and item-level access, disable accounts — no redeploy.

First concrete case: create user **Grace** with access to the **Sales** section only.

## Non-goals (v1)

- Self-service password change by the user themselves. Admin sets the password and
  shows it once; a user-facing "change my password" flow can come later.
- Roles/role templates. Access stays the existing allowlist model.
- Audit log of admin actions. Timestamps only (`created_at`, `updated_at`).
- Fixing the pre-existing `/m/sales` slug/route gating gap or the ungated `/api/m/*`
  routes — explicitly out of scope, tracked separately.

## Access model (unchanged)

We keep the existing model in `lib/auth.ts`: a user's `allowed` is either `'*'`
(full access) or an array mixing **section keys** (`'sales'` grants all items in the
section) and **item slugs** (`'sales-playbook'` grants one item). `hasAccess()` already
resolves both. The admin UI is a friendlier editor over this same array — the model
and `hasAccess()` logic do not change.

New per-user fields beyond today's `{login, password, allowed}`:
- `is_admin: boolean` — gates the Users section. Admins always have full access
  regardless of `allowed` (an admin managing users must be able to see the portal).
- `disabled: boolean` — a disabled user fails login and fails token verification.

## Storage: Supabase table + short-TTL cache

New schema `portal`, table `portal.users`:

| column         | type        | notes                                              |
|----------------|-------------|----------------------------------------------------|
| id             | uuid pk     | `gen_random_uuid()`                                |
| login          | text unique | case-sensitive, matches today's behavior           |
| password_hash  | text        | PBKDF2-SHA256, salted — format below               |
| allowed        | jsonb       | `"*"` or `["sales", ...]`                           |
| is_admin       | boolean     | default false                                      |
| disabled       | boolean     | default false                                      |
| created_at     | timestamptz | default now()                                      |
| updated_at     | timestamptz | default now(), bumped on write                     |

Schema `portal` must be added to Supabase **Exposed schemas** (same footnote as
`sales`/`promo`). Accessed via a new `sbPortal` client in `lib/supabase.ts`
(service-role key, `db.schema = 'portal'`). Migration is applied manually by the
user in the Supabase SQL Editor (per project convention — the service key is
PostgREST, not DDL).

**Why a table, not env or cookie-baked permissions:** the middleware checks access
on every request, so we need the current permission set to be readable cheaply and
to reflect changes quickly. We resolve users from the DB but cache the full user
list in module memory with a **~30s TTL** — so it's one lightweight query per
instance per 30s, not per request. Revoking access (disable/permission change) takes
effect within ~30s with no re-login and no redeploy. A cookie-baked-permissions
approach was rejected because revocation would require rotating `MC_SECRET` and
logging everyone out.

## Password hashing

PBKDF2-SHA256 via Web Crypto (`crypto.subtle`) — works in both Edge (middleware) and
Node runtimes, no new dependency. Stored as `pbkdf2$<iterations>$<saltB64>$<hashB64>`.
Verify is constant-time on the derived bytes. This replaces plaintext comparison for
DB users. Env-fallback users (see below) keep plaintext comparison since that's how
`MC_USERS` is authored.

## Env fallback (safety net)

`lib/auth.ts` gains a DB-backed source but keeps the env source as fallback:

1. If `portal.users` has ≥1 row → DB is the source of truth. `findUser`/
   `checkCredentials`/`verifyToken` read from the cached DB list.
2. If the table is empty **or** the DB read throws → fall back to today's
   `parseUsers()` (`MC_USERS`, then `MC_PASSWORD`→admin).

This guarantees that a failed migration or DB outage cannot lock the owner out of
their own portal. The existing `admin`/`MC_PASSWORD` login keeps working until the
first DB user is created. Plan of record: seed one admin row (`admin`, `is_admin`,
`allowed: '*'`) as the first action, then Grace.

## Self-lockout protection

Enforced in the write API, not just the UI:
- An admin cannot clear their own `is_admin`.
- An admin cannot set `disabled` on their own account.
- The last remaining enabled admin cannot be un-admined or disabled (count check).

## UI

New **Users** item in the **Tech** (`Техничка`) section of `lib/registry.ts`:
`slug: 'users'`, `route: m('users')`, `embed: { kind: 'native' }`, `status: 'live'`.
Because the item slug (`users`) equals its route segment, middleware gates it
correctly (unlike the known `sales-crm`/`sales` mismatch).

Gating is **is_admin**, not the allowlist: the Users page and its APIs check
`user.is_admin` server-side and 403/redirect otherwise. The registry item is also
hidden from the sidebar for non-admins — the sidebar filter in
`app/(portal)/layout.tsx` additionally drops the `users` slug when `!user.is_admin`.

Pages (`app/(portal)/m/users/`):
- **List** — table of users: login, access summary (chips), admin badge,
  disabled state, created date. Buttons: New user, Edit, Disable/Enable.
- **New / Edit form** — login, password (New: required, shown once after save;
  Edit: optional "set new password"), `is_admin` toggle, and an access editor:
  the section list from `lib/registry.ts` rendered as a tree — per-section checkbox
  ("all of X") plus expandable per-item checkboxes, mirroring how `allowed` mixes
  section keys and item slugs. A "Full access (\*)" master toggle sets `allowed: '*'`.

Server actions / API (`app/api/m/users/`):
- `GET /api/m/users` — list (admin only)
- `POST /api/m/users` — create
- `PATCH /api/m/users/[id]` — update fields / access / password / disabled
- All routes assert `is_admin` at the top (since `/api/m/*` is not gated by
  middleware). Reuse a small `requireAdmin(req)` helper reading the cookie via
  `verifyToken`.

## Data flow

1. Admin opens `/m/users` → layout confirms `is_admin` → list rendered from
   `sbPortal.from('users')`.
2. Admin saves a user → `POST/PATCH` validates (unique login, self-lockout rules,
   hash password if provided) → writes `portal.users` → **invalidates the auth
   cache** so the change is live immediately for that instance (other instances
   catch up within TTL).
3. Next request from any user → middleware `verifyToken` → cached DB list →
   `hasAccess`. Grace with `allowed: ['sales']` reaches `/m/sales*`, is redirected
   from everything else, and sees only Sales in the sidebar.

## Error handling

- Duplicate login → 409 with a clear message.
- Empty login/password on create → 400.
- Self-lockout attempts → 422 with the reason.
- DB unreachable on a write → 503; on a read in middleware → fall back to env source
  (login still works for env users; DB users are unreachable until DB returns —
  acceptable, matches "can't be locked out" goal for the owner).

## Testing

- Unit: password hash round-trip (hash → verify true; wrong password → false),
  self-lockout guards (last-admin, self-demote, self-disable), `allowed` editor
  serialization (tree selection ↔ array of keys/slugs).
- Unit: auth source selection (DB non-empty → DB; empty/throws → env fallback).
- Integration (manual, documented in plan): create Grace via UI, log in as Grace,
  confirm Sales-only visibility and redirect from `/m/income`.

## Rollout

1. Write migration `032_portal_users.sql` — user applies it manually in Supabase,
   adds `portal` to Exposed schemas.
2. Deploy code (env fallback keeps the owner's current `admin`/`MC_PASSWORD` login
   working while the table is empty).
3. Owner logs in as `admin`, opens `/m/users`, creates the real `admin` row
   (is_admin, full access) and **Grace** (`allowed: ['sales']`), notes Grace's
   password, hands it over.
4. Once the DB admin row exists and login is verified, `MC_PASSWORD` can be removed
   from Railway at the owner's discretion (env fallback then only triggers on an
   empty table / DB outage).
