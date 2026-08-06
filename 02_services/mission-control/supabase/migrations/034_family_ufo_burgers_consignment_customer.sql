-- Register FAMILY UFO BURGERS CO.,LTD as a consignment customer.
--
-- Burger bar & restaurant in Patong we supply on consignment (W&W = Consignor,
-- FAMILY UFO BURGERS = Consignee). Same direction as FlyO (migration 031) — the
-- mirror of Harvest/Cigar Empire, which are suppliers who consign TO us.
--
-- b2b_customer rows are normally auto-created by the FlowAccount sync on first
-- invoice (sync_inventory_flow.ts::ensureB2bCustomer). No invoices yet, so we
-- seed the row now with is_consignment=true and its consignment_location,
-- mirroring what /api/m/customers PATCH does when a customer is flipped to
-- consignment (auto-provision consignment_location so the Deliveries tab works).
--
-- IMPORTANT: flowaccount_name is UNIQUE and the sync matches on it
-- (case-insensitive). It MUST match exactly how this customer appears in
-- FlowAccount, or the first synced invoice creates a duplicate customer row.
-- Seeded here with the legal name from the tax record; if FlowAccount stores it
-- differently, UPDATE b2b_customer SET flowaccount_name = '<real>' BEFORE the
-- first invoice syncs.
--
-- Reference (goes on the partner card, not on this table — b2b_customer has no
-- tax_id/address columns; those live in FlowAccount):
--   Tax ID  0835566012216
--   Address 210/1 Rat Uthit 200 Pee Road, Patong, Kathu, Phuket 83150
--
-- Run in Supabase SQL editor. Idempotent.

insert into inventory.b2b_customer (flowaccount_name, payment_terms_days, is_consignment, notes)
values (
  'FAMILY UFO BURGERS CO.,LTD',
  7,
  true,
  'Burger bar & restaurant, Patong, Phuket. Consignment (W&W = Consignor). Tax ID 0835566012216. Agreement: 07_contacts/partners/family-ufo-burgers/.'
)
on conflict (flowaccount_name) do update
  set is_consignment = true,
      updated_at     = now();

-- Auto-provision the consignment_location so the Deliveries tab works immediately.
insert into inventory.consignment_location (customer_id, name)
select c.id, c.flowaccount_name
from inventory.b2b_customer c
where c.flowaccount_name = 'FAMILY UFO BURGERS CO.,LTD'
on conflict (customer_id) do nothing;
