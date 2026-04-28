-- Migration 003: Confidence, stability, freshness, decomposed copyability, tier, trigger metadata

-- trend_accounts
ALTER TABLE trend_accounts
  ADD COLUMN IF NOT EXISTS top1_median_ratio       real,
  ADD COLUMN IF NOT EXISTS stability_label         text,
  ADD COLUMN IF NOT EXISTS confidence_score        real,
  ADD COLUMN IF NOT EXISTS freshness_score         real,
  ADD COLUMN IF NOT EXISTS matched_clusters_count  integer,
  ADD COLUMN IF NOT EXISTS format_copyability      integer,
  ADD COLUMN IF NOT EXISTS production_copyability  integer,
  ADD COLUMN IF NOT EXISTS retail_copyability      integer,
  ADD COLUMN IF NOT EXISTS tier                    text DEFAULT 'c';

-- trend_reels: trigger metadata
ALTER TABLE trend_reels
  ADD COLUMN IF NOT EXISTS trigger_type            text,
  ADD COLUMN IF NOT EXISTS views_at_capture        integer,
  ADD COLUMN IF NOT EXISTS followers_at_capture    integer,
  ADD COLUMN IF NOT EXISTS ratio_at_capture        real;
