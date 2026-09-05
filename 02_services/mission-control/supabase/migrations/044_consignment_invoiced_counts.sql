-- 044_consignment_invoiced_counts.sql
-- An invoice issued to a consignment customer means the bottle is SOLD.
--
-- Migration 006 excluded consignment customers from v_b2b_in_transit on the
-- assumption that their bottles were already counted in v_consignment_balance
-- via a delivery note. That holds only while (a) every invoiced bottle went out
-- on a delivery note, and (b) the invoice gets paid quickly. Neither is
-- reliable: bottles reach a consignment point without a note (restocked by
-- hand, swapped for something else, added to an existing shelf), and an invoice
-- can sit Unpaid for weeks.
--
-- Symptom that surfaced it — FAMILY UFO's INV202608100001 (2026-08-10, Unpaid,
-- 17 lines). Eleven of those lines were never on DN-2026-012/014, e.g. one
-- Aristov Anima Millesimato Brut Rosé. The bottle was excluded from
-- b2b_in_transit (customer is consignment) and absent from
-- v_consignment_balance (never delivered on a note) — so it fell through both
-- and kept showing as sitting on our own shelf:
--   on_hand=5  b2b_in_transit=0  on_consignment=0  in_store=5   ← wrong
--   on_hand=5  b2b_in_transit=1  on_consignment=0  in_store=4   ← right
--
-- Same hole, bigger, at Golden Brewery: 12 SKUs invoiced beyond what any
-- delivery note covers (Kapuka Sauvignon Blanc 17 vs 8, Tamagne Terroir 11
-- vs 0).
--
-- Fix, in two halves that MUST land together or the bottle gets counted twice:
--
--   1. v_consignment_balance stops waiting for payment. A bottle leaves the
--      consignment pool when we invoice it, not when the money arrives —
--      that is the moment the customer told us it was sold. Any non-Cancelled
--      invoice now consumes the pool.
--
--   2. v_b2b_in_transit stops excluding consignment customers. Because of (1)
--      the bottle is no longer in on_consignment, so counting the unpaid
--      invoice line as in-transit is not a double count — it is the only
--      count. Once the invoice is Paid it drops out of transit too, matching
--      the Loyverse write-off.
--
-- Walk one bottle through the states (on_hand still includes it until we
-- write it off in Loyverse at payment):
--
--   delivered on a note, not invoiced   consign 1  transit 0   in_store −1
--   invoiced, Unpaid                    consign 0  transit 1   in_store −1
--   invoiced, Paid                      consign 0  transit 0   in_store −0
--   invoiced, never on a note           consign 0  transit 1   in_store −1
--
-- Over-invoicing (more billed than delivered) stays clamped at zero by the
-- existing greatest(...) — it shows up as transit, not as a negative shelf.
--
-- Apply manually in the Supabase SQL Editor (same as every other migration).

-- 1) A bottle leaves the consignment pool when invoiced, not when paid.
create or replace view inventory.v_consignment_balance as
with deliveries as (
  select cl.id as location_id, dnl.sku_id, sum(dnl.qty) as qty
  from inventory.consignment_location cl
  join inventory.delivery_note      dn  on dn.location_id = cl.id
  join inventory.delivery_note_line dnl on dnl.note_id = dn.id
  where dn.status in ('draft','issued','delivered')
  group by cl.id, dnl.sku_id
), sold as (
  select cl.id as location_id, fil.sku_id, sum(fil.qty) as qty
  from inventory.consignment_location           cl
  join inventory.flowaccount_invoice            fi  on fi.customer_id = cl.customer_id
  join inventory.flowaccount_invoice_line       fil on fil.invoice_id = fi.id
  where fi.status <> 'Cancelled' and fil.sku_id is not null
  group by cl.id, fil.sku_id
)
select
  d.location_id,
  d.sku_id,
  greatest(coalesce(d.qty,0) - coalesce(s.qty,0), 0) as qty
from deliveries d
left join sold s on s.location_id = d.location_id and s.sku_id = d.sku_id
where (coalesce(d.qty,0) - coalesce(s.qty,0)) > 0;

-- 2) Consignment customers' unpaid invoices are in transit like anyone else's.
create or replace view inventory.v_b2b_in_transit as
select
  l.sku_id,
  i.customer_id,
  i.customer_name,
  i.number          as invoice_number,
  i.issued_at,
  i.due_at,
  i.status,
  l.qty,
  l.amount
from inventory.flowaccount_invoice_line l
join inventory.flowaccount_invoice      i  on i.id = l.invoice_id
where i.status not in ('Paid','Cancelled')
  and l.sku_id is not null;
