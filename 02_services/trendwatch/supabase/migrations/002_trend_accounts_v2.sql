-- Migration 002: Extended scoring fields for trend_accounts
-- Run in Supabase Dashboard → SQL Editor

ALTER TABLE trend_accounts
  ADD COLUMN IF NOT EXISTS median_reel_views  integer,
  ADD COLUMN IF NOT EXISTS top3_avg_views     integer,
  ADD COLUMN IF NOT EXISTS hit_rate_50k       real,
  ADD COLUMN IF NOT EXISTS virality_ratio     real,
  ADD COLUMN IF NOT EXISTS size_bucket        text,
  ADD COLUMN IF NOT EXISTS source_clusters    text[],
  ADD COLUMN IF NOT EXISTS sample_size        integer,
  ADD COLUMN IF NOT EXISTS business_model     text,
  ADD COLUMN IF NOT EXISTS why_matters        text;
