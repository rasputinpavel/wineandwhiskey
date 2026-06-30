-- 030_consignment_retail_minus.sql
-- Second consignment settlement mode + seed Cigar Empire (cigars).
--
--   cost_plus    (default, = Harvest): pay HC per sold unit, +7% VAT.
--   retail_minus (Cigar Empire):       supplier price list is the VAT-inclusive
--                                       shelf price P; pay P × (1 − discount) × 1.07.

alter table inventory.supplier
  add column if not exists settlement_mode text not null default 'cost_plus',
  add column if not exists consignment_discount_pct numeric not null default 0;

alter table inventory.supplier
  drop constraint if exists supplier_settlement_mode_chk;
alter table inventory.supplier
  add constraint supplier_settlement_mode_chk
  check (settlement_mode in ('cost_plus', 'retail_minus'));

-- Optional per-SKU discount override (null = use the supplier default).
alter table inventory.consignment_price
  add column if not exists discount_pct numeric null;

-- Seed Cigar Empire. Consignment suppliers are not auto-registered from POs, so
-- insert explicitly. The name must match the Loyverse supplier for future
-- settlement-PO matching.
insert into inventory.supplier
  (name, type, settlement_mode, consignment_discount_pct, monthly_cycle_start_day, notes)
values
  ('Cigar Empire Company Limited', 'consignment', 'retail_minus', 30, 5,
   'Cigars on consignment. Net price list = VAT-inclusive shelf price; pay P×0.70×1.07 per sold unit. 5th-to-5th cycle. Ibrahim Tuncel +66 92 865 3180, access@cigar-empire.com')
on conflict (name) do update
  set type                     = excluded.type,
      settlement_mode          = excluded.settlement_mode,
      consignment_discount_pct = excluded.consignment_discount_pct,
      monthly_cycle_start_day  = excluded.monthly_cycle_start_day;
