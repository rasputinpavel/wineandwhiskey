-- v_b2b_in_transit was double-counting consignment customers' bottles.
--
-- For a regular B2B customer, an unpaid invoice line means a bottle has
-- physically left our store but isn't yet written off (in transit). For a
-- consignment customer, the bottle was already moved out via a delivery
-- note and is being tracked through v_consignment_balance — so the unpaid
-- invoice is a billing event for stock already counted, not transit.
--
-- Symptom: a consignment customer's unpaid invoice put the bottle into
-- BOTH on_consignment AND b2b_in_transit, and v_sku_breakdown subtracted
-- it twice from in_store. Example pre-fix on Ant Moore Sauv Blanc:
--   on_hand=7  b2b_in_transit=3  on_consignment=3  in_store=1   ← wrong
-- Post-fix:
--   on_hand=7  b2b_in_transit=0  on_consignment=3  in_store=4   ← right
--
-- Fix: exclude lines whose invoice belongs to is_consignment=true customer.
--
-- Run in Supabase SQL editor.

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
left join inventory.b2b_customer        c  on c.id = i.customer_id
where i.status not in ('Paid','Cancelled')
  and l.sku_id is not null
  and coalesce(c.is_consignment, false) = false;
