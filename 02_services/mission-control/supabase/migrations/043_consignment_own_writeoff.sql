-- 043_consignment_own_writeoff.sql
-- Bottles of OUR OWN bought-out stock that left without a sale.
--
-- `tastings` already records the supplier's bottles we consume for free. Once a
-- SKU has been bought out (migration 042) the same shelf holds two pools, and a
-- bottle that disappears may have been ours rather than theirs — poured at an
-- event, broken, taken. Recording it as a tasting would wrongly shrink the
-- supplier's closing stock; recording it as a sale would bill them for a bottle
-- we already paid for on the buyout invoice. So it gets its own field, sitting
-- next to tastings and edited the same way.
--
-- Effect: it consumes our own pool only. The supplier's Closing is untouched,
-- nothing is billed, and the period-end identity keeps holding —
--   Closing (consignment) + Own remaining = Loyverse ON HAND
--
-- First use: Aug-2026 Harvest cycle — one bottle each of Aristov Riesling,
-- Tamagne Duo Blanc and Tamagne Duo Rouge, all three bought out on
-- INV2026080030 and written off by hand during the period.
--
-- Apply manually in the Supabase SQL Editor (same as every other migration).

alter table inventory.consignment_report_cell
  add column if not exists own_writeoff integer not null default 0;
