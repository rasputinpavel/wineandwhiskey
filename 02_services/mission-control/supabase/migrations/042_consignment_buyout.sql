-- 042_consignment_buyout.sql
-- Buyout — units bought OUT of a consignment pool onto our own books.
--
-- Normally we pay a consignment supplier per unit SOLD and the stock stays
-- theirs until it leaves the shop. Sometimes we buy specific bottles outright,
-- at a negotiated price, on a SEPARATE invoice — Harvest INV2026080030 of
-- 28 Aug 2026, 23 bottles at prices below the consignment HC, bought because
-- they were going out to the Spice House wine evening. From that moment those
-- units are OURS, and three things follow:
--
--   1. They leave the supplier's consignment stock:
--        Closing = Opening + Delivered − BoughtOut − BillableSold − Tastings
--   2. Selling them must NOT be billed to the supplier again. Owner's rule
--      (5 Sep 2026): a sale of a bought-out SKU draws from OUR pool first, and
--      only bills the supplier once our pool is empty.
--   3. Loyverse ON HAND holds BOTH pools (a bottle invoiced to a B2B client is
--      written off only when they pay), so the period-end check becomes
--        Closing (consignment) + Own remaining = Loyverse ON HAND
--
-- unit_price is the PRE-VAT price on the buyout invoice. It is usually LOWER
-- than the consignment HC — that is the whole point of buying out — so it is
-- stored per line and never inferred from consignment_price.
--
-- Apply manually in the Supabase SQL Editor (same as every other migration).

create table if not exists inventory.consignment_buyout (
  id           uuid primary key default gen_random_uuid(),
  supplier_id  uuid not null references inventory.supplier(id) on delete cascade,
  sku_id       uuid not null references inventory.sku(id) on delete cascade,
  bought_at    date not null,
  qty          integer not null check (qty > 0),
  unit_price   numeric(12,2),          -- pre-VAT per unit; null = not priced yet
  invoice_no   text,                   -- supplier's invoice number — groups the lines
  note         text,
  created_at   timestamptz not null default now()
);

create index if not exists consignment_buyout_supplier_date_idx
  on inventory.consignment_buyout(supplier_id, bought_at);

-- One SKU appears once per invoice line-set; makes the seed below re-runnable.
create unique index if not exists consignment_buyout_line_uniq
  on inventory.consignment_buyout(supplier_id, sku_id, bought_at, coalesce(invoice_no, ''));

-- ── Seed: Harvest Creation INV2026080030, 28 Aug 2026 ────────────────────
-- 23 bottles, ฿9,750 pre-VAT + ฿682.50 VAT = ฿10,432.50 (PO3043 in Loyverse).
-- Prices are as printed on the invoice, NOT the consignment HC.

insert into inventory.consignment_buyout (supplier_id, sku_id, bought_at, qty, unit_price, invoice_no)
select
  '11a6c8fb-2e8d-4d6c-8197-98345fd17545'::uuid,
  k.id,
  date '2026-08-28',
  v.qty,
  v.price,
  'INV2026080030'
from (values
  ('ADV.D.RoBr',        2, 600.00),
  ('ChTamChard2025',    3, 400.00),
  ('ChTamSignSaperavi', 3, 520.00),
  ('ArRies',            3, 490.00),
  ('ChTamDuoBl',        6, 360.00),
  ('ChTamDuoRed',       6, 360.00)
) as v(code, qty, price)
join inventory.sku k on k.loyverse_product_code = v.code
on conflict do nothing;
