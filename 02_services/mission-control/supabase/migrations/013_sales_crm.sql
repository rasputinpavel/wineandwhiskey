-- B2B outreach CRM: leads loaded from Apify Google Places, moved through a
-- pipeline (Лиды → Взят в работу → Контакт → … → Первая закупка).
--
-- Architecture:
--   • sales.lead          — one row per business (uniq by google_place_id)
--   • sales.lead_activity — append-only log: call, meeting, note, stage_change
--   • sales.scrape_run    — bookkeeping for Apify runs (input, dataset id, counts)
--
-- Stage transitions happen app-side; we keep enums in DB so PostgREST + UI stay
-- in sync. `first_taken_at` is set the first time stage ≠ 'lead'; `last_contact_at`
-- is bumped by the "Зафиксировать контакт" button or any logged activity.
--
-- IMPORTANT: After running this migration in Supabase, add `sales` to the list
-- of exposed schemas in Project Settings → API → Exposed schemas. Otherwise
-- PostgREST returns 404 on /rest/v1/sales-prefixed queries.

create schema if not exists sales;

-- ─── Enums ────────────────────────────────────────────────────────────────
do $$ begin
  create type sales.lead_stage as enum (
    'lead',           -- raw, just from Apify
    'in_work',        -- взят в работу
    'contacted',      -- контакт состоялся
    'meeting_set',    -- назначена встреча
    'meeting_done',   -- встреча проведена
    'negotiating',    -- переговоры
    'first_purchase', -- первая закупка (deal closed)
    'rejected'        -- отказ / не интересно
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type sales.business_kind as enum (
    'restaurant', 'bar', 'hotel', 'tour', 'event', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type sales.scrape_status as enum (
    'pending', 'running', 'succeeded', 'failed', 'aborted', 'imported'
  );
exception when duplicate_object then null; end $$;

-- ─── Scrape runs (Apify bookkeeping) ──────────────────────────────────────
create table if not exists sales.scrape_run (
  id                uuid primary key default gen_random_uuid(),
  apify_run_id      text,
  apify_dataset_id  text,
  -- Input form params (districts, search terms, kind, min_rating, min_reviews,
  -- price levels, max_per_search). Stored verbatim so we can replay or audit.
  input             jsonb not null,
  status            sales.scrape_status not null default 'pending',
  -- Filled when /import has run.
  scraped_count     int default 0,   -- raw items pulled from dataset
  imported_count    int default 0,   -- new leads inserted
  duplicate_count   int default 0,   -- existing leads updated (stage preserved)
  rejected_count    int default 0,   -- filtered out by min_reviews / price etc
  error             text,
  created_at        timestamptz not null default now(),
  finished_at       timestamptz
);
create index if not exists scrape_run_status_idx on sales.scrape_run(status);
create index if not exists scrape_run_created_idx on sales.scrape_run(created_at desc);

-- ─── Leads ────────────────────────────────────────────────────────────────
create table if not exists sales.lead (
  id                uuid primary key default gen_random_uuid(),
  -- Apify-side identity: Google's Place ID is the stable dedup key.
  google_place_id   text unique,
  -- Business profile
  name              text not null,
  business_kind     sales.business_kind not null default 'other',
  google_categories text[],                  -- raw `categories[]` from Apify
  address           text,
  district          text,                    -- our Phuket bucket (Patong, Karon, ...)
  lat               numeric,
  lng               numeric,
  phone             text,
  website           text,
  rating            numeric,                 -- totalScore
  reviews_count     int,
  price_level       text,                    -- "$" | "$$" | "$$$" | "$$$$"
  opening_hours     jsonb,
  menu_url          text,
  image_url         text,                    -- first image from Apify
  raw               jsonb,                   -- full Apify item, for "did we miss something" recall
  -- Pipeline
  stage             sales.lead_stage not null default 'lead',
  assignee          text,                    -- free text (one manager, but extendable)
  first_taken_at    timestamptz,             -- set when stage first ≠ 'lead'
  last_contact_at   timestamptz,             -- bumped by activity / "Зафиксировать контакт"
  next_action_at    timestamptz,             -- optional reminder
  notes             text,                    -- free-form scratch pad
  -- Link to existing customer once "first_purchase" reached (loose FK; we don't
  -- enforce it because customers live in inventory schema and link is set manually).
  customer_id       uuid,
  source_run_id     uuid references sales.scrape_run(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists lead_stage_idx     on sales.lead(stage);
create index if not exists lead_kind_idx      on sales.lead(business_kind);
create index if not exists lead_district_idx  on sales.lead(district);
-- Helps the "stale > 5 days" red-highlight query.
create index if not exists lead_active_stale_idx on sales.lead(last_contact_at)
  where stage in ('in_work', 'contacted', 'meeting_set', 'meeting_done', 'negotiating');

-- ─── Activity log ─────────────────────────────────────────────────────────
create table if not exists sales.lead_activity (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references sales.lead(id) on delete cascade,
  -- 'call' | 'meeting' | 'whatsapp' | 'email' | 'note' | 'stage_change' | 'import'
  kind        text not null,
  note        text,
  -- e.g. { from: 'in_work', to: 'contacted' } for stage_change.
  meta        jsonb,
  at          timestamptz not null default now()
);
create index if not exists lead_activity_lead_idx on sales.lead_activity(lead_id, at desc);

-- ─── Trigger: keep updated_at fresh ───────────────────────────────────────
create or replace function sales.tg_set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists lead_set_updated_at on sales.lead;
create trigger lead_set_updated_at before update on sales.lead
  for each row execute function sales.tg_set_updated_at();

-- ─── Grant PostgREST access ───────────────────────────────────────────────
-- service_role bypasses RLS, but still needs schema USAGE.
grant usage on schema sales to anon, authenticated, service_role;
grant all on all tables    in schema sales to service_role;
grant all on all sequences in schema sales to service_role;
alter default privileges in schema sales grant all on tables to service_role;
alter default privileges in schema sales grant all on sequences to service_role;
