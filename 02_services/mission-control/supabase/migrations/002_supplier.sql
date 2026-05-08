-- Supplier registry. Promotes the free-text `purchase_orders.supplier`
-- column into a first-class entity so we can attach metadata like
-- payment terms or "is consignment" — and later, in step B, hang
-- supplier_delivery (delivery notes vs tax invoices) off it.
--
-- Run in Supabase SQL editor. The `inventory` schema is already exposed
-- via API settings (see migration 001).

create table if not exists inventory.supplier (
  id                   uuid primary key default gen_random_uuid(),
  name                 text unique not null,
  is_consignment       boolean not null default false,
  payment_terms_days   int not null default 0,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists supplier_name_idx on inventory.supplier(lower(name));

-- One-shot seed from the existing Loyverse-scraped supplier values.
-- Idempotent: re-running will only insert names not already present.
insert into inventory.supplier (name)
select distinct trim(supplier)
from public.purchase_orders
where supplier is not null and trim(supplier) <> ''
on conflict (name) do nothing;
