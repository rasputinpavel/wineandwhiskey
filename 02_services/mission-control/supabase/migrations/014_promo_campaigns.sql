-- Promo Pulse: weekly promo campaigns.
--
-- One promo per week, ad-hoc cadence. The brief (theme, mechanic, SKUs, dates,
-- mood) is captured in the portal form. Phase 2 will fill the copy fields via
-- Anthropic API; Phase 3 will render visuals and store them in Supabase Storage
-- bucket `promo`. Phase 4 will sync finished campaigns into
-- 05_creative/output/promo-<slug>_<starts_on>/ so they appear in Creative
-- Library after commit.
--
-- IMPORTANT: After running this migration, add `promo` to the list of exposed
-- schemas in Project Settings → API → Exposed schemas. Otherwise PostgREST
-- returns 404 on /rest/v1/promo-prefixed queries.
--
-- Also create the storage bucket once (private, signed URLs):
--   insert into storage.buckets (id, name, public) values ('promo', 'promo', false);

create schema if not exists promo;

do $$ begin
  create type promo.status as enum ('draft', 'generating', 'ready');
exception when duplicate_object then null; end $$;

-- Mirrors the four registers from 04_brand/design-system.md §7.
do $$ begin
  create type promo.mood as enum ('direct', 'casual', 'light', 'expert');
exception when duplicate_object then null; end $$;

do $$ begin
  create type promo.visual_mode as enum ('dark', 'light');
exception when duplicate_object then null; end $$;

-- Mirrors the five composition templates from 04_brand/design-system.md §4.
do $$ begin
  create type promo.composition as enum (
    'vitrina',    -- product hero
    'zayavka',    -- statement
    'moment',     -- action full-bleed
    'kartochka',  -- info card
    'tsena'       -- price drop
  );
exception when duplicate_object then null; end $$;

create table if not exists promo.campaign (
  id              uuid primary key default gen_random_uuid(),
  -- Slug shape: <theme-kebab>_<starts_on>, e.g. 'brunello-week_2026-05-19'.
  -- Used as folder name in 05_creative/output/ and storage key prefix.
  slug            text unique not null,
  theme           text not null,
  mechanic        text not null,
  starts_on       date not null,
  ends_on         date not null,
  mood            promo.mood not null default 'direct',
  -- Filenames in 04_brand/products/ without .png, e.g. 'brunello-banfi'.
  sku_slugs       text[] not null default '{}',
  status          promo.status not null default 'draft',

  -- ─── Generated copy (Phase 2) ─── English only per design-system §7.
  headline        text,
  subhead         text,
  caption_ig      text,
  caption_tg      text,
  visual_mode     promo.visual_mode,
  composition     promo.composition,

  -- ─── Generated assets (Phase 3) ─── Storage paths in bucket `promo`.
  -- Shape: { ig_post, ig_story, tg_post, poster_a2, stand_a3, web_banner_desktop, web_banner_mobile, preview }
  assets          jsonb,

  created_at      timestamptz not null default now(),
  generated_at    timestamptz,
  -- Bumped by the sync script when assets reach 05_creative/output/.
  synced_at       timestamptz
);

create index if not exists campaign_starts_idx on promo.campaign(starts_on desc);
create index if not exists campaign_status_idx on promo.campaign(status);

-- Regenerated assets force a re-sync to git.
create or replace function promo.tg_clear_synced() returns trigger as $$
begin
  if new.assets is distinct from old.assets then
    new.synced_at = null;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists campaign_resync on promo.campaign;
create trigger campaign_resync before update on promo.campaign
  for each row execute function promo.tg_clear_synced();

-- PostgREST access — service_role bypasses RLS but still needs schema USAGE.
grant usage on schema promo to anon, authenticated, service_role;
grant all on all tables    in schema promo to service_role;
grant all on all sequences in schema promo to service_role;
alter default privileges in schema promo grant all on tables    to service_role;
alter default privileges in schema promo grant all on sequences to service_role;
