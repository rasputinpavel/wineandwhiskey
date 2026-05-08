-- Move consignment balance from a stored table to a derived view, so the
-- only thing we maintain by hand is delivery notes — sales side is a
-- mirror of FlowAccount invoices and never needs manual entry.
--
-- Run in Supabase SQL editor.

-- 1) New view: per (location, sku) qty = delivered − sold-and-paid.
--    We sum delivery_note_line.qty for any non-cancelled status, then
--    subtract paid invoice lines for the location's customer (which is
--    by convention is_consignment = true).
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
  where fi.status = 'Paid' and fil.sku_id is not null
  group by cl.id, fil.sku_id
)
select
  d.location_id,
  d.sku_id,
  greatest(coalesce(d.qty,0) - coalesce(s.qty,0), 0) as qty
from deliveries d
left join sold s on s.location_id = d.location_id and s.sku_id = d.sku_id
where (coalesce(d.qty,0) - coalesce(s.qty,0)) > 0;

-- 2) Update the main breakdown to read from the new view (column shape
--    is identical, so CREATE OR REPLACE works without dropping callers).
create or replace view inventory.v_sku_breakdown as
with stock as (
  select sku_id, sum(qty) as qty from inventory.loyverse_stock group by sku_id
), transit as (
  select sku_id, sum(qty) as qty from inventory.v_b2b_in_transit group by sku_id
), consign as (
  select sku_id, sum(qty) as qty from inventory.v_consignment_balance group by sku_id
)
select
  s.id                                      as sku_id,
  s.loyverse_product_code,
  s.name,
  s.category,
  coalesce(stock.qty,   0)                  as on_hand,
  coalesce(transit.qty, 0)                  as b2b_in_transit,
  coalesce(consign.qty, 0)                  as on_consignment,
  greatest(coalesce(stock.qty,0)
         - coalesce(transit.qty,0)
         - coalesce(consign.qty,0), 0)      as in_store
from inventory.sku s
left join stock   on stock.sku_id   = s.id
left join transit on transit.sku_id = s.id
left join consign on consign.sku_id = s.id;

-- 3) The old stored table is no longer the source of truth — drop it.
drop table if exists inventory.consignment_balance;
