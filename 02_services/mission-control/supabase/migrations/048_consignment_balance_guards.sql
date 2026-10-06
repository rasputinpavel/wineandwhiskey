-- 048_consignment_balance_guards.sql
-- Stop invoices that were never about the shelf from eating the shelf.
--
-- v_consignment_balance = delivered on notes − invoiced. Migration 044 made
-- every non-Cancelled invoice to the customer consume the pool, on the premise
-- that an invoice to a consignment customer IS the "this sold" report. Two ways
-- that premise breaks, both live in production right now:
--
--   1. Invoices older than the shelf. 044 rewrote the view and dropped the
--      zero-point guard migration 005 had put there: only invoices issued on or
--      after the location's first delivery note may subtract. Without it every
--      historical invoice to that customer — business done before the shelf
--      existed — eats bottles delivered later.
--        Fine Cusine: INV202608270001 (27.08, 11 units) against a shelf opened
--        11.09 → 4 bottles gone (Victor Dravigny 2, Signature Saperavi 2).
--        Golden Brewery: 17 pre-zero invoices, 75 units → 22 bottles gone.
--
--   2. Sales on top of the shelf. We also sell the same customer stock outright,
--      billed to the same FlowAccount card. Those bottles never stood on their
--      shelf, so they must not be deducted from it.
--        Fine Cusine: INV202609290001 (29.09, ฿16,104.57, 26 units) bills 6 NUDE
--        SAPERAVI and 5 Cabernet where the note delivered 2 of each, plus Anima
--        Rosé and Par La Mer that no note ever carried → 8 more bottles gone.
--
-- Nothing in the data distinguishes case 2 from a genuine sell-through report,
-- so it becomes an explicit per-invoice ruling, defaulting to the 044 behaviour.
-- The flag sits on flowaccount_invoice; sync_inventory_flow upserts a fixed
-- column list, so it survives re-scrapes.
--
-- Apply manually in the Supabase SQL Editor (same as every other migration).

-- 1) The ruling: this invoice is a sale ON TOP of the shelf, not a report of
--    what sold from it.
alter table inventory.flowaccount_invoice
  add column if not exists consignment_exempt boolean not null default false;

comment on column inventory.flowaccount_invoice.consignment_exempt is
  'true = this invoice billed stock that never stood on the customer consignment shelf (a wholesale sale alongside the consignment arrangement), so it must not reduce v_consignment_balance. Default false keeps the normal case: an invoice to a consignment customer reports what sold off their shelf.';

-- 2) Rebuild the balance with both guards. Everything else is migration 044:
--    a bottle leaves the pool when invoiced, not when paid.
create or replace view inventory.v_consignment_balance as
with first_dn as (
  select cl.id as location_id, min(dn.issued_at) as zero_date
  from inventory.consignment_location cl
  join inventory.delivery_note      dn  on dn.location_id = cl.id
  where dn.status in ('draft','issued','delivered')
  group by cl.id
), deliveries as (
  select cl.id as location_id, dnl.sku_id, sum(dnl.qty) as qty
  from inventory.consignment_location cl
  join inventory.delivery_note      dn  on dn.location_id = cl.id
  join inventory.delivery_note_line dnl on dnl.note_id = dn.id
  where dn.status in ('draft','issued','delivered')
  group by cl.id, dnl.sku_id
), sold as (
  select cl.id as location_id, fil.sku_id, sum(fil.qty) as qty
  from inventory.consignment_location     cl
  join first_dn                           fd  on fd.location_id = cl.id
  join inventory.flowaccount_invoice      fi  on fi.customer_id = cl.customer_id
  join inventory.flowaccount_invoice_line fil on fil.invoice_id = fi.id
  where fi.status <> 'Cancelled'
    and fi.consignment_exempt is not true      -- guard 2: sold on top of the shelf
    and fi.issued_at >= fd.zero_date           -- guard 1: older than the shelf
    and fil.sku_id is not null
  group by cl.id, fil.sku_id
)
select
  d.location_id,
  d.sku_id,
  greatest(coalesce(d.qty,0) - coalesce(s.qty,0), 0) as qty
from deliveries d
left join sold s on s.location_id = d.location_id and s.sku_id = d.sku_id
where (coalesce(d.qty,0) - coalesce(s.qty,0)) > 0;

-- 3) The one invoice we already know is a sale on top of the Fine Cusine shelf.
--    Idempotent; add further rulings from the portal, not by editing this file.
update inventory.flowaccount_invoice
   set consignment_exempt = true
 where number = 'INV202609290001';
