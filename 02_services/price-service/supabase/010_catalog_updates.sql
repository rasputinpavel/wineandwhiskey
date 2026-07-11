-- Run this in the price-service Supabase SQL Editor (project arbturzdpqvulsqwqpbd).
-- Adds catalog reconciliation: wine_items lifecycle + a per-run diff record.

-- 1. wine_items lifecycle + reconciliation key
alter table wine_items
  add column if not exists status text not null default 'active'
    check (status in ('active','discontinued')),
  add column if not exists match_key text,
  add column if not exists discontinued_at timestamptz;

create index if not exists wine_items_supplier_matchkey_idx
  on wine_items(supplier_id, match_key) where status = 'active';

-- 2. price_lists gains a 'review' state (parsed, awaiting human diff approval)
alter table price_lists drop constraint if exists price_lists_status_check;
alter table price_lists add constraint price_lists_status_check
  check (status in ('pending','processing','review','done','error'));

-- 3. One row per reconciliation run: the diff, the review payload, the changelog
create table if not exists catalog_updates (
  id                 uuid default gen_random_uuid() primary key,
  supplier_id        uuid references suppliers(id) on delete set null,
  new_price_list_id  uuid references price_lists(id) on delete cascade,
  status             text not null default 'pending_review'
                       check (status in ('pending_review','applied','discarded')),
  diff               jsonb not null,
  created_at         timestamptz default now(),
  applied_at         timestamptz
);

-- Guard: at most one open review per supplier
create unique index if not exists catalog_updates_one_open_per_supplier
  on catalog_updates(supplier_id) where status = 'pending_review';
