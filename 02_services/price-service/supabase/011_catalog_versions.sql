-- Run in the Supabase SQL editor (project arbturzdpqvulsqwqpbd).
-- Explicit catalog versioning: price lists that are versions of the SAME catalog
-- share a version_group_id. Freshness (current/expired) applies only within a
-- group — unrelated lists of the same supplier stay independent (all current).
alter table price_lists add column if not exists version_group_id uuid;

create index if not exists price_lists_version_group_idx
  on price_lists(version_group_id) where version_group_id is not null;
