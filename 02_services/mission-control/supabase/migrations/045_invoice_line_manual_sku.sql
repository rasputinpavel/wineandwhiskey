-- 045_invoice_line_manual_sku.sql
-- Remember that a human, not the matcher, decided what this line is.
--
-- /m/inventory/admin/unmapped lets someone assign sku_id to an invoice line
-- the fuzzy matcher couldn't place. But sync_inventory_flow re-reads a detail
-- page and then DELETEs every line of that invoice and re-INSERTs it from
-- matchSku() — so the human's decision is thrown away and the line goes back
-- to whatever the matcher says, usually NULL again.
--
-- This is not hypothetical and not limited to backfills: Phase 3 re-enriches
-- every invoice that isn't Paid on both sides, so a mapping made on an
-- outstanding invoice is erased by the next scheduled run. It survived this
-- long only because most hand-mapped lines sit on Paid invoices, which the
-- skip rule happened to protect.
--
-- 37 lines currently hold a sku_id the matcher would not reproduce, across 8
-- distinct descriptions — FA texts too far from the Loyverse name for token
-- similarity to bridge ("GUINNES Beer" → Guinness Stout 440ML, 'PGI "Dolina
-- Dona" Vedernikovskoe dry white "Sibirkory"' → Sibirkovy Vedernikov). Exactly
-- the cases a human is needed for, and exactly the ones being erased.
--
-- The flag makes the distinction explicit rather than inferred: the sync
-- carries over sku_id wherever sku_id_manual is true and re-derives the rest,
-- so improvements to the matcher still reach every line nobody has ruled on.
--
-- Apply manually in the Supabase SQL Editor (same as every other migration).

alter table inventory.flowaccount_invoice_line
  add column if not exists sku_id_manual boolean not null default false;

-- Existing hand-made mappings can't be recognised in SQL — telling them apart
-- from the matcher's own output means running the matcher. 03_automation/
-- mark_manual_invoice_lines.ts does that pass and flips the flag; run it once
-- after this migration, before any FLOW_REENRICH backfill.
