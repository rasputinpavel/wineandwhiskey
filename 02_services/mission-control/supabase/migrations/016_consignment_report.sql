-- Consignment monthly sales report cells.
--
-- For each (supplier, sku, month) we store the manual numbers we can't
-- derive from Loyverse: opening_stock, closing_stock, tastings.
-- B2C / B2B sold counts are computed at view time from loyverse_receipt
-- + loyverse_receipt_line. Period is stored as YYYY-MM (ISO month).

create table if not exists inventory.consignment_report_cell (
  id              uuid primary key default gen_random_uuid(),
  supplier_id     uuid not null references inventory.supplier(id) on delete cascade,
  sku_id          uuid not null references inventory.sku(id) on delete cascade,
  period          text not null check (period ~ '^\d{4}-\d{2}$'),  -- YYYY-MM
  opening_stock   integer,
  closing_stock   integer,
  tastings        integer not null default 0 check (tastings >= 0),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (supplier_id, sku_id, period)
);

create index if not exists consignment_report_cell_supplier_period_idx
  on inventory.consignment_report_cell(supplier_id, period);
