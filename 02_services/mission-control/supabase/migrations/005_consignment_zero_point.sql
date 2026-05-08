-- The first delivery note for a consignment location is the "zero point"
-- — its lines are the physical inventory on the shelf at that moment.
-- Any FlowAccount invoice issued BEFORE that date settled deliveries we
-- never recorded, so it shouldn't subtract from the current balance.
--
-- This re-defines v_consignment_balance to:
--   - count delivery_note_lines as before
--   - subtract paid invoice lines only when invoice.issued_at >=
--     min(delivery_note.issued_at) for that location
--
-- Run in Supabase SQL editor.

create or replace view inventory.v_consignment_balance as
with first_dn as (
  select cl.id as location_id, min(dn.issued_at) as zero_date
  from inventory.consignment_location cl
  join inventory.delivery_note      dn  on dn.location_id = cl.id
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
  from inventory.consignment_location           cl
  join first_dn                                 fd  on fd.location_id = cl.id
  join inventory.flowaccount_invoice            fi  on fi.customer_id = cl.customer_id
  join inventory.flowaccount_invoice_line       fil on fil.invoice_id = fi.id
  where fi.status = 'Paid'
    and fi.issued_at >= fd.zero_date
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
