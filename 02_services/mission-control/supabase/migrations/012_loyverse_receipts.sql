-- Persisted Loyverse data для B2B-аналитики.
--
-- До сих пор Loyverse receipts тянулись live в sync_dashboard.ts и нигде не
-- сохранялись. Mission-control умел показывать только flowaccount_invoice —
-- но клиент может платить картой/наличными в Loyverse без выставления
-- FA-инвойса (например JETRADAR). Эти продажи терялись в UI.
--
-- Что добавляем:
--   • loyverse_customer    — справочник клиентов Loyverse (для picker'а)
--   • loyverse_receipt     — все receipts (Sale + Refund) с B2B-флагами
--   • loyverse_receipt_line — детализация по SKU
--
-- B2B классификация (поле is_b2b) вычисляется на стороне sync-скрипта по
-- общему паттерну из 03_automation/lib/b2b.ts:
--   • payment_type = Bank Transfer → is_b2b=true
--   • customer name matches B2B_PATTERNS → is_b2b=true
--
-- Run in Supabase SQL Editor.

-- ─── Customers (для UI picker'а) ──────────────────────────────────────────
create table if not exists inventory.loyverse_customer (
  id            text primary key,                          -- Loyverse customer id (uuid string)
  name          text not null,
  email         text,
  phone         text,
  total_spent   numeric default 0,                         -- Loyverse aggregate
  scraped_at    timestamptz not null default now()
);
create index if not exists loyverse_customer_name_idx
  on inventory.loyverse_customer(lower(name));

-- ─── Receipts ─────────────────────────────────────────────────────────────
create table if not exists inventory.loyverse_receipt (
  id                  uuid primary key default gen_random_uuid(),
  receipt_number      text unique not null,                 -- e.g. "5-8402"
  loyverse_receipt_id text,                                 -- Loyverse-internal id (если есть)
  receipt_date        timestamptz not null,
  receipt_type        text not null,                        -- 'SALE' | 'REFUND'
  store               text,
  customer_id         text references inventory.loyverse_customer(id),
  customer_name       text,                                 -- denormalized name (на момент receipt)
  total               numeric not null,
  cost_total          numeric default 0,                    -- сумма cost_total из лайнов
  is_b2b              boolean not null default false,       -- по правилам lib/b2b.ts
  is_bank_transfer    boolean not null default false,       -- хотя бы один payment_type = Bank Transfer
  scraped_at          timestamptz not null default now()
);
create index if not exists loyverse_receipt_customer_idx on inventory.loyverse_receipt(customer_id);
create index if not exists loyverse_receipt_date_idx     on inventory.loyverse_receipt(receipt_date desc);
create index if not exists loyverse_receipt_b2b_idx      on inventory.loyverse_receipt(is_b2b) where is_b2b is true;

-- ─── Receipt lines ────────────────────────────────────────────────────────
create table if not exists inventory.loyverse_receipt_line (
  id            uuid primary key default gen_random_uuid(),
  receipt_id    uuid not null references inventory.loyverse_receipt(id) on delete cascade,
  sku           text,                                       -- Loyverse SKU (joined to inventory.sku.loyverse_product_code)
  product_name  text,
  qty           numeric not null,
  price         numeric,
  cost          numeric,
  line_total    numeric not null,
  scraped_at    timestamptz not null default now()
);
create index if not exists loyverse_receipt_line_receipt_idx on inventory.loyverse_receipt_line(receipt_id);
create index if not exists loyverse_receipt_line_sku_idx     on inventory.loyverse_receipt_line(sku) where sku is not null;
