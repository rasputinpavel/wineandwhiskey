-- 041_writeoff_weight.sql
-- Weight-based write-offs: sold_by_weight items (sausages) record grams instead
-- of pieces. Null for piece items (incl. per-pack cheese SKUs whose weight is in
-- the name). Apply manually in the Supabase SQL Editor.

alter table public.stock_writeoffs
  add column if not exists weight_grams integer;
