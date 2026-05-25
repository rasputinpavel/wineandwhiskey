-- Consignment supplier pricing.
--
-- Some suppliers (Harvest is the canonical case) don't sell us inventory
-- upfront — they ship on consignment and invoice once a month for what we
-- actually sold. To compute that running monthly liability the Finance
-- Pulse dashboard needs the per-SKU price the supplier charges us
-- ("HC to Latitude" column on the Harvest price list).
--
-- One row per (supplier, sku). Price changes by editing the row — no
-- history required for Phase 1; if Harvest ever bumps prices retroactively
-- we'll add a `valid_from` column then.
--
-- VAT (7% Thai) is NOT stored here — pulse adds it at compute time so the
-- same row works whether the supplier is VAT-registered or not.

create table if not exists inventory.consignment_price (
  id            uuid primary key default gen_random_uuid(),
  supplier_id   uuid not null references inventory.supplier(id) on delete cascade,
  sku_id        uuid not null references inventory.sku(id) on delete cascade,
  price_hc      numeric not null check (price_hc >= 0),   -- our wholesale cost (HC → Latitude)
  price_retail  numeric,                                   -- supplier's recommended retail (optional reference)
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (supplier_id, sku_id)
);

create index if not exists consignment_price_supplier_idx
  on inventory.consignment_price(supplier_id);
