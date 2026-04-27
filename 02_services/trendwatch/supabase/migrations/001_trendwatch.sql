-- Trendwatch service schema
-- Run in Supabase SQL editor.
-- Also create Storage bucket "trend-frames" (public: false) via Supabase dashboard.

create table if not exists trend_accounts (
  id              uuid primary key default gen_random_uuid(),
  username        text unique not null,
  display_name    text,
  followers_count integer,
  avg_reel_views  integer,
  relevance_score integer check (relevance_score between 1 and 10),
  category        text,  -- wine_store|wine_bar|sommelier|spirits|f&b
  is_active       boolean default false,
  last_reel_at    timestamptz,
  added_at        timestamptz default now()
);

create table if not exists trend_reels (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid references trend_accounts(id) on delete cascade,
  instagram_id   text unique not null,
  url            text,
  views_count    integer not null default 0,
  likes_count    integer,
  comments_count integer,
  caption        text,
  hashtags       text[],
  thumbnail_url  text,
  video_url      text,
  duration_s     float,
  published_at   timestamptz,
  discovered_at  timestamptz default now(),
  status         text not null default 'new',
  constraint trend_reels_status_check check (
    status in ('new','analyzing','analyzed','approved','skipped','briefed','published')
  )
);

create table if not exists trend_frames (
  id           uuid primary key default gen_random_uuid(),
  reel_id      uuid references trend_reels(id) on delete cascade,
  timestamp_s  float not null,
  storage_path text not null,
  created_at   timestamptz default now()
);

create table if not exists trend_analysis (
  id                uuid primary key default gen_random_uuid(),
  reel_id           uuid references trend_reels(id) on delete cascade unique,
  hook_type         text,
  hook_text         text,
  hook_duration_s   float,
  content_structure jsonb,
  format_type       text,
  music_type        text,
  text_overlays     text[],
  visual_elements   jsonb,
  why_performs      text,
  adaptation_score  integer check (adaptation_score between 1 and 10),
  analyzed_at       timestamptz default now()
);

create table if not exists trend_briefs (
  id                    uuid primary key default gen_random_uuid(),
  reel_id               uuid references trend_reels(id) on delete cascade unique,
  analysis_id           uuid references trend_analysis(id),
  hook_options          jsonb,
  content_outline       jsonb,
  music_direction       text,
  text_overlay_copy     text[],
  visual_notes          text,
  filming_instructions  text,
  visual_prompts        jsonb,
  video_url             text,
  video_status          text default 'idle',
  constraint trend_briefs_video_status_check check (
    video_status in ('idle','generating','assembling','ready','error')
  ),
  created_at            timestamptz default now()
);

create table if not exists trend_our_reels (
  id               uuid primary key default gen_random_uuid(),
  brief_id         uuid references trend_briefs(id),
  reel_id          uuid references trend_reels(id),
  instagram_url    text,
  published_at     timestamptz,
  views_7d         integer,
  views_14d        integer,
  views_30d        integer,
  likes_count      integer,
  followers_gained integer,
  notes            text,
  last_tracked_at  timestamptz,
  created_at       timestamptz default now()
);

create index if not exists idx_trend_reels_status     on trend_reels(status);
create index if not exists idx_trend_reels_account    on trend_reels(account_id);
create index if not exists idx_trend_reels_views      on trend_reels(views_count desc);
create index if not exists idx_trend_reels_discovered on trend_reels(discovered_at desc);
create index if not exists idx_trend_accounts_active  on trend_accounts(is_active);
