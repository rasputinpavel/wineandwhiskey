-- Per-upload progress for the UI bar (0-100 integer).
-- Parsers update this through an onProgress callback as they work.
alter table price_lists
  add column if not exists progress int not null default 0
  check (progress >= 0 and progress <= 100);

alter table price_lists
  add column if not exists progress_phase text;
