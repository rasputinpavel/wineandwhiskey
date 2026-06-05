-- Closed-period state for a consignment supplier's monthly report.
--
-- When a month's report is agreed, we "close" it: the effective Closing stock
-- of each SKU is persisted into consignment_report_cell.closing_stock (so it
-- carries forward as next month's Opening) and the period is marked closed
-- here. Reopening just deletes the row; the closing values stay.

create table if not exists inventory.consignment_report_period (
  id            uuid primary key default gen_random_uuid(),
  supplier_id   uuid not null references inventory.supplier(id) on delete cascade,
  period        text not null check (period ~ '^\d{4}-\d{2}$'),  -- YYYY-MM
  closed_at     timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (supplier_id, period)
);
