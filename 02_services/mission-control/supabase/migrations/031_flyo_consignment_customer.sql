-- Register FlyO as a consignment customer.
--
-- FlyO is a rooftop bar & restaurant we supply on consignment (W&W = Consignor,
-- FlyO = Consignee). Direction is the mirror of Harvest/Cigar Empire (those are
-- suppliers who consign to us).
--
-- b2b_customer rows are normally auto-created by the FlowAccount sync on first
-- invoice (sync_inventory_flow.ts::ensureB2bCustomer). FlyO has no invoices yet,
-- so we seed the row now with is_consignment=true and its consignment_location,
-- mirroring what /api/m/customers PATCH does when a customer is flipped to
-- consignment (auto-provision consignment_location so the Deliveries tab works).
--
-- IMPORTANT: flowaccount_name is UNIQUE and the sync matches on it
-- (case-insensitive). Keep it exactly as FlyO will appear in FlowAccount, or the
-- first synced invoice will create a duplicate customer row. If FlyO's FlowAccount
-- name turns out different, UPDATE b2b_customer SET flowaccount_name = '<real>' in
-- the portal / here BEFORE the first invoice syncs.
--
-- Run in Supabase SQL editor. Idempotent.

insert into inventory.b2b_customer (flowaccount_name, payment_terms_days, is_consignment, notes)
values ('FlyO', 7, true, 'Rooftop bar & restaurant, Phuket. Consignment (W&W = Consignor). Agreement: 07_contacts/partners/flyo/.')
on conflict (flowaccount_name) do update
  set is_consignment = true,
      updated_at     = now();

-- Auto-provision the consignment_location so the Deliveries tab works immediately.
insert into inventory.consignment_location (customer_id, name)
select c.id, c.flowaccount_name
from inventory.b2b_customer c
where c.flowaccount_name = 'FlyO'
on conflict (customer_id) do nothing;
