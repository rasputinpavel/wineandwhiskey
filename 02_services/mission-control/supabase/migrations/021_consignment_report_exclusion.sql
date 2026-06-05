-- Per-period receipt exclusions for a consignment supplier's monthly report.
--
-- Some Loyverse receipts must not count toward the consignment settlement —
-- e.g. a B2B batch billed outside consignment terms, or previous-owner
-- handover sales. We exclude them by receipt_number per (supplier, period);
-- the Monthly Report skips these receipts when aggregating sold units.

create table if not exists inventory.consignment_report_exclusion (
  id              uuid primary key default gen_random_uuid(),
  supplier_id     uuid not null references inventory.supplier(id) on delete cascade,
  period          text not null check (period ~ '^\d{4}-\d{2}$'),  -- YYYY-MM
  receipt_number  text not null,
  note            text,
  created_at      timestamptz not null default now(),
  unique (supplier_id, period, receipt_number)
);

create index if not exists consignment_report_exclusion_supplier_period_idx
  on inventory.consignment_report_exclusion(supplier_id, period);

-- Seed: the 19 May 2026 off-consignment B2B batch (Fine Cuisine Co.,LTD) that
-- must not count toward Harvest's May settlement.
insert into inventory.consignment_report_exclusion (supplier_id, period, receipt_number, note)
select s.id, '2026-05', rn, 'Fine Cuisine B2B batch, 19 May — off consignment'
from inventory.supplier s
cross join (values ('5-8639'),('5-8643'),('5-8644'),('5-8645'),('5-8646')) as t(rn)
where lower(s.name) like '%harvest%'
on conflict (supplier_id, period, receipt_number) do nothing;
