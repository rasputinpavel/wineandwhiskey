-- Inventory service schema.
-- Single source of truth: Loyverse for stock, FlowAccount for B2B invoices.
-- This schema is the bridge — it mirrors both, computes balances, and tracks
-- consignment locations (e.g. Golden Brewery).
--
-- Run in Supabase SQL editor. Add `inventory` to "Exposed schemas" under
-- API settings so PostgREST can read/write.

create schema if not exists inventory;
grant usage on schema inventory to anon, authenticated, service_role;
grant all on all tables in schema inventory to service_role;
grant all on all sequences in schema inventory to service_role;
alter default privileges in schema inventory grant all on tables to service_role;
alter default privileges in schema inventory grant all on sequences to service_role;

-- ── SKU master ───────────────────────────────────────────────────────────
-- One row per Loyverse variant. `loyverse_product_code` is the matching key
-- against FlowAccount item codes (we sync these one-time so they line up).

create table if not exists inventory.sku (
  id                    uuid primary key default gen_random_uuid(),
  loyverse_variant_id   text unique not null,
  loyverse_item_id      text,
  loyverse_product_code text,
  name                  text not null,
  category              text,
  default_price         numeric,
  is_inventory_tracked  boolean not null default true,
  updated_at            timestamptz not null default now()
);
create index if not exists sku_product_code_idx on inventory.sku(loyverse_product_code);
create index if not exists sku_name_idx on inventory.sku(name);

-- ── Loyverse stock snapshot ──────────────────────────────────────────────
-- Latest qty per (sku, store). We overwrite on each sync — historical
-- snapshots live in sync_log + materialized history later if needed.

create table if not exists inventory.loyverse_stock (
  sku_id     uuid not null references inventory.sku(id) on delete cascade,
  store_id   text not null,
  qty        numeric not null,
  fetched_at timestamptz not null default now(),
  primary key (sku_id, store_id)
);

-- ── B2B customer registry ────────────────────────────────────────────────
-- Source of truth for credit terms. flowaccount_name is the canonical name
-- as it appears in FlowAccount; loyverse_customer_id is filled in once we
-- match (or NULL if the b2b client has no Loyverse customer record).

create table if not exists inventory.b2b_customer (
  id                   uuid primary key default gen_random_uuid(),
  flowaccount_name     text unique not null,
  loyverse_customer_id text,
  payment_terms_days   int not null default 0,
  credit_limit         numeric,
  is_consignment       boolean not null default false,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ── FlowAccount mirror: invoices ─────────────────────────────────────────

create table if not exists inventory.flowaccount_invoice (
  id            uuid primary key default gen_random_uuid(),
  number        text unique not null,                 -- e.g. INV202604280001
  customer_id   uuid references inventory.b2b_customer(id),
  customer_name text not null,                        -- raw name from FA (matches kept loose)
  issued_at     date not null,
  due_at        date,
  status        text not null,                        -- Paid|Unpaid|Overdue|Cancelled
  total         numeric not null,
  detail_url    text,
  scraped_at    timestamptz not null default now()
);
create index if not exists fa_invoice_status_idx on inventory.flowaccount_invoice(status);
create index if not exists fa_invoice_customer_idx on inventory.flowaccount_invoice(customer_id);
create index if not exists fa_invoice_issued_idx on inventory.flowaccount_invoice(issued_at desc);

create table if not exists inventory.flowaccount_invoice_line (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references inventory.flowaccount_invoice(id) on delete cascade,
  sku_id     uuid references inventory.sku(id),       -- null = unmapped (needs admin review)
  raw_text   text not null,                           -- product description as scraped
  qty        numeric not null,
  amount     numeric
);
create index if not exists fa_line_invoice_idx on inventory.flowaccount_invoice_line(invoice_id);
create index if not exists fa_line_sku_idx on inventory.flowaccount_invoice_line(sku_id);
create index if not exists fa_line_unmapped_idx on inventory.flowaccount_invoice_line(invoice_id) where sku_id is null;

-- ── FlowAccount mirror: receipts ─────────────────────────────────────────

create table if not exists inventory.flowaccount_receipt (
  id                  uuid primary key default gen_random_uuid(),
  number              text unique not null,
  customer_name       text not null,
  paid_at             date not null,
  amount              numeric not null,
  loyverse_payment_id text,                           -- filled when we push payment to Loyverse
  scraped_at          timestamptz not null default now()
);

create table if not exists inventory.flowaccount_receipt_invoice (
  receipt_id uuid not null references inventory.flowaccount_receipt(id) on delete cascade,
  invoice_id uuid not null references inventory.flowaccount_invoice(id) on delete cascade,
  primary key (receipt_id, invoice_id)
);

-- ── Consignment (Golden Brewery and friends) ─────────────────────────────

create table if not exists inventory.consignment_location (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null unique references inventory.b2b_customer(id),
  name        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists inventory.consignment_balance (
  location_id uuid not null references inventory.consignment_location(id) on delete cascade,
  sku_id      uuid not null references inventory.sku(id) on delete cascade,
  qty         numeric not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (location_id, sku_id)
);

create table if not exists inventory.delivery_note (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references inventory.consignment_location(id),
  number      text unique not null,
  issued_at   date not null,
  status      text not null default 'draft',          -- draft|issued|delivered
  pdf_url     text,
  created_by  text,
  created_at  timestamptz not null default now()
);

create table if not exists inventory.delivery_note_line (
  id         uuid primary key default gen_random_uuid(),
  note_id    uuid not null references inventory.delivery_note(id) on delete cascade,
  sku_id     uuid not null references inventory.sku(id),
  qty        numeric not null,
  unit_price numeric
);

-- ── Sync log ─────────────────────────────────────────────────────────────
-- One row per sync attempt. UI reads MAX(finished_at) WHERE ok=true to show
-- "data as of <ts>" per source.

create table if not exists inventory.sync_log (
  id          uuid primary key default gen_random_uuid(),
  source      text not null,                          -- loyverse_stock|loyverse_products|flowaccount_invoices|flowaccount_receipts
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  error       text,
  rows_in     int,
  rows_out    int
);
create index if not exists sync_log_source_idx on inventory.sync_log(source, started_at desc);

-- ── View: in-transit B2B (unpaid invoice lines, by SKU and customer) ────
-- "In transit" = invoice line where the parent invoice is not Paid AND not
-- Cancelled. This is what's physically gone but not yet written off in
-- Loyverse via a bank-transfer payment.

create or replace view inventory.v_b2b_in_transit as
select
  l.sku_id,
  i.customer_id,
  i.customer_name,
  i.number          as invoice_number,
  i.issued_at,
  i.due_at,
  i.status,
  l.qty,
  l.amount
from inventory.flowaccount_invoice_line l
join inventory.flowaccount_invoice      i on i.id = l.invoice_id
where i.status not in ('Paid','Cancelled')
  and l.sku_id is not null;

-- ── View: SKU breakdown (the main inventory page) ───────────────────────
-- on_hand        = Loyverse stock (sum across stores)
-- b2b_in_transit = sum of unpaid invoice line qty
-- on_consignment = sum of consignment_balance qty across locations
-- in_store       = on_hand - b2b_in_transit - on_consignment (clamped to 0)

create or replace view inventory.v_sku_breakdown as
with stock as (
  select sku_id, sum(qty) as qty from inventory.loyverse_stock group by sku_id
), transit as (
  select sku_id, sum(qty) as qty from inventory.v_b2b_in_transit group by sku_id
), consign as (
  select sku_id, sum(qty) as qty from inventory.consignment_balance group by sku_id
)
select
  s.id                                       as sku_id,
  s.loyverse_product_code,
  s.name,
  s.category,
  coalesce(stock.qty,   0)                   as on_hand,
  coalesce(transit.qty, 0)                   as b2b_in_transit,
  coalesce(consign.qty, 0)                   as on_consignment,
  greatest(coalesce(stock.qty,0)
         - coalesce(transit.qty,0)
         - coalesce(consign.qty,0), 0)       as in_store
from inventory.sku s
left join stock   on stock.sku_id   = s.id
left join transit on transit.sku_id = s.id
left join consign on consign.sku_id = s.id;
