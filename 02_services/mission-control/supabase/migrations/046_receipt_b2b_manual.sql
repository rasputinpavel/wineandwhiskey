-- 046_receipt_b2b_manual.sql
-- Remember that a human, not the classifier, ruled on this receipt.
--
-- inventory.loyverse_receipt.is_b2b is derived on every sync from two signals:
-- a Bank Transfer payment, or a linked Loyverse customer whose name matches
-- B2B_PATTERNS. Both signals are missing whenever a B2B sale is rung up at the
-- till without picking the customer card and paid by cash/card/QR — the money
-- looks exactly like a walk-in purchase, and the sale lands in retail.
--
-- The case that prompted this: receipt 5-9217 (06.09.2026, ฿10,125.41, QR, no
-- customer) is the payment of FlowAccount invoice INV202608100001 issued to
-- FAMILY UFO BURGERS CO.,LTD for exactly ฿10,125.41. The Loyverse receipt
-- cannot be corrected after the fact, so the correction has to live here.
--
-- A plain UPDATE would not survive: sync_loyverse_receipts re-reads the last 30
-- days three times a day and upserts is_b2b/customer_name straight from the
-- derivation, so the fix would be gone by the next run. Same failure mode that
-- migration 045 fixed for hand-mapped invoice lines, and the same shape of fix:
-- an explicit "a human decided this" flag that the sync carries over instead of
-- recomputing.
--
--   b2b_manual       — the classification below was set by a person; sync keeps
--                      is_b2b, customer_name and b2b_customer_id as they stand.
--   b2b_customer_id  — which B2B customer the sale belongs to. Needed because
--                      attribution normally runs through customer_id →
--                      loyverse_customer → b2b_customer.loyverse_customer_id,
--                      and these clients often have no Loyverse customer card
--                      at all (FAMILY UFO BURGERS has none).
--
-- Portal: /m/customers/<id>?tab=loyverse → "+ attach receipt" sets both, and
-- the ✕ next to a manual row clears them and hands the receipt back to the
-- classifier. No SQL needed for the next one.
--
-- Apply manually in the Supabase SQL Editor (same as every other migration).
-- Apply it BEFORE the next receipt sync run: the sync selects b2b_manual.

alter table inventory.loyverse_receipt
  add column if not exists b2b_manual      boolean not null default false,
  add column if not exists b2b_customer_id uuid references inventory.b2b_customer(id);

create index if not exists loyverse_receipt_b2b_customer_idx
  on inventory.loyverse_receipt(b2b_customer_id) where b2b_customer_id is not null;

-- The receipt this migration exists for. customer_name carries the human's
-- attribution (the sync leaves it alone while b2b_manual is true) so the sale
-- reads as FAMILY UFO BURGERS everywhere a receipt shows a customer.
update inventory.loyverse_receipt r
   set is_b2b          = true,
       b2b_manual      = true,
       b2b_customer_id = c.id,
       customer_name   = c.flowaccount_name
  from inventory.b2b_customer c
 where r.receipt_number = '5-9217'
   and c.flowaccount_name = 'FAMILY UFO BURGERS CO.,LTD';
