-- Алан wine cache: stores structured WineEvidence keyed by normalized
-- producer+name+vintage, so re-scans skip web research. Apply in Supabase SQL Editor.
create table if not exists public.alan_wine_cache (
  key        text primary key,
  identity   jsonb not null,
  evidence   jsonb not null,
  brief      text not null default '',
  created_at timestamptz not null default now()
);
