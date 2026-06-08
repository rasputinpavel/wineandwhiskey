-- Payment method per Loyverse receipt, so the Income/Cash page can auto-derive
-- inflows: cash sales land in the Cash wallet, card / QR / bank-transfer land in
-- the company Account. Populated by 03_automation/sync_loyverse_receipts.ts from
-- the receipt's payments[] (Loyverse returns type + name inline).
--
--   'cash' | 'card' | 'qr' | 'transfer' | 'other'
--
-- Run in the Supabase SQL Editor, then backfill:
--   LOYVERSE_FROM=2025-01-01 LOYVERSE_TO=<today> npm run inv:receipts

alter table inventory.loyverse_receipt
  add column if not exists payment_method text;
