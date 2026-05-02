-- Migration 005: Persistent sync jobs for manual reel sync from /sync UI

create table if not exists sync_jobs (
  id              uuid primary key default gen_random_uuid(),
  state           text not null default 'running'
                    check (state in ('running','done','failed')),
  phase           text,                       -- 'account' | null
  phase_label     text,
  phase_current   int,
  phase_total     int,
  logs            text[] not null default '{}',
  found_reels     jsonb  not null default '[]'::jsonb,  -- array of { url, account, views, trigger_type, thumbnail }
  total_new       int    not null default 0,
  total_accounts  int    not null default 0,
  error           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists sync_jobs_active_idx
  on sync_jobs(updated_at desc) where state = 'running';
