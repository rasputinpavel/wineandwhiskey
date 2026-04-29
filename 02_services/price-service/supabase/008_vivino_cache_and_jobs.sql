-- Vivino enrichment: durable cache + resumable jobs.
-- Run in Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- 1. Cache table — keyed by normalized search query.
-- ---------------------------------------------------------------------------
create table if not exists vivino_cache (
  query        text primary key,                     -- normalized query string we sent to Apify
  found        boolean not null,
  raw          jsonb,                                -- full Vivino result (null if not found)
  fetched_at   timestamptz not null default now()
);

create index if not exists vivino_cache_fetched_at_idx on vivino_cache(fetched_at);

-- ---------------------------------------------------------------------------
-- 2. Jobs — resumable enrichment runs.
-- ---------------------------------------------------------------------------
create table if not exists vivino_jobs (
  id            uuid primary key default gen_random_uuid(),
  price_list_id uuid not null references price_lists(id) on delete cascade,
  state         text not null default 'queued'
                  check (state in ('queued', 'running', 'paused', 'done', 'failed')),
  mode          text not null default 'missing'
                  check (mode in ('missing', 'failed', 'all')),
  total         int  not null default 0,
  processed    int  not null default 0,
  enriched     int  not null default 0,
  not_found    int  not null default 0,
  cache_hits   int  not null default 0,
  apify_runs   int  not null default 0,
  apify_items  int  not null default 0,
  last_error   text,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  heartbeat_at timestamptz
);

create index if not exists vivino_jobs_pricelist_idx on vivino_jobs(price_list_id, created_at desc);
create index if not exists vivino_jobs_active_idx    on vivino_jobs(state) where state in ('queued', 'running');

-- ---------------------------------------------------------------------------
-- 3. Per-item job state — drives resumability.
-- ---------------------------------------------------------------------------
create table if not exists vivino_job_items (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references vivino_jobs(id) on delete cascade,
  wine_item_id    uuid not null references wine_items(id)  on delete cascade,
  query           text not null,                          -- normalized query
  state           text not null default 'pending'
                    check (state in ('pending', 'done', 'not_found', 'error')),
  attempts        int  not null default 0,
  last_error      text,
  updated_at      timestamptz not null default now(),
  unique (job_id, wine_item_id)
);

create index if not exists vivino_job_items_job_state_idx on vivino_job_items(job_id, state);
create index if not exists vivino_job_items_query_idx     on vivino_job_items(query);

-- ---------------------------------------------------------------------------
-- 4. New columns on wine_items: separate failure marker + match confidence.
-- ---------------------------------------------------------------------------
alter table wine_items
  add column if not exists vivino_failed_at        timestamptz,
  add column if not exists vivino_match_confidence numeric(3,2),
  add column if not exists vivino_query            text;
