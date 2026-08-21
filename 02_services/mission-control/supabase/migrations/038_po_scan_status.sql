-- 038_po_scan_status.sql
-- Operator review workflow for PO scans (see docs/superpowers/specs/
-- 2026-08-20-po-scan-operator-workflow-design.md).
--
--   status       draft → needs_corrections → approved (operator-driven).
--                Bot inserts omit status → DB default 'draft' (review queue).
--   loyverse_po  link OR number of the PO created by hand in Loyverse.
--
-- The Loyverse public REST API does not expose Purchase Orders, so the operator
-- creates the PO in Loyverse and records the link/number here — no automation.

-- Add columns first WITHOUT a status default so existing rows land as NULL and
-- can be backfilled, then attach the default for future bot inserts.
alter table public.po_scans add column if not exists status text;
alter table public.po_scans add column if not exists loyverse_po text;

-- Existing rows predate the review workflow; they are already processed. Marking
-- them 'approved' keeps the operator's draft queue clean (only new scans appear).
update public.po_scans set status = 'approved' where status is null;

alter table public.po_scans alter column status set default 'draft';
alter table public.po_scans alter column status set not null;

alter table public.po_scans drop constraint if exists po_scans_status_chk;
alter table public.po_scans
  add constraint po_scans_status_chk
  check (status in ('draft', 'needs_corrections', 'approved'));

create index if not exists po_scans_status_idx on public.po_scans (status);
