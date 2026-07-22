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
