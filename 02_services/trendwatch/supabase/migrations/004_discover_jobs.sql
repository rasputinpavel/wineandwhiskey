-- Migration 004: Persistent discovery jobs.
-- Allows the UI to survive page reloads while a job is running in the background.

create table if not exists discover_jobs (
  id            uuid primary key default gen_random_uuid(),
  state         text not null default 'running'
                  check (state in ('running', 'done', 'failed')),
  hashtags      text[] not null,
  phase         text,                       -- 'hashtag' | 'account' | null
  phase_label   text,
  phase_current int,
  phase_total   int,
  logs          text[] not null default '{}',
  candidates    jsonb  not null default '[]'::jsonb,
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists discover_jobs_active_idx
  on discover_jobs(updated_at desc) where state = 'running';
