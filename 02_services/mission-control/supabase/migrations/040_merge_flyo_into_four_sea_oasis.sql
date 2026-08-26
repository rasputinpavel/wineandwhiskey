-- Merge the duplicate FlyO / Four Sea Oasis Co., Ltd. customer into one row,
-- and give b2b_customer a place to keep the trading brand.
--
-- Why the duplicate appeared: migration 031 seeded the customer under the brand
-- name ("FlyO"), but FlowAccount invoices the legal entity ("Four Sea Oasis
-- Co., Ltd."). sync_inventory_flow.ts::ensureB2bCustomer matches on
-- flowaccount_name only (case-insensitive) and auto-creates a row for any name
-- it doesn't know — so the first invoice (INV202608250001, 25.08.2026) landed on
-- a second customer, while the consignment location and DN-2026-008 stayed on
-- the FlyO row. Migration 034 (FAMILY UFO BURGERS) got this right by seeding the
-- legal entity; do the same for every future consignment customer.
--
-- After this migration the canonical name everywhere (customers list, customer
-- card, delivery notes, FlowAccount matching) is the legal entity. brand_name is
-- the trading name, shown only as a small line under the legal name on printed
-- delivery notes.
--
-- Run in Supabase SQL editor. Idempotent.

-- 1. Trading brand, separate from the FlowAccount/legal name.
alter table inventory.b2b_customer
  add column if not exists brand_name text;

comment on column inventory.b2b_customer.brand_name is
  'Trading brand when it differs from the legal entity (e.g. FlyO for Four Sea Oasis Co., Ltd.). Display-only; matching always goes through flowaccount_name.';

-- 2. Fold the sync-created legal-entity row into the seeded brand row.
do $$
declare
  v_keep uuid;   -- seeded row: consignment flag, terms, location, delivery notes
  v_dup  uuid;   -- row auto-created by the FlowAccount sync: holds the invoices
  v_lv   text;
begin
  select id into v_keep from inventory.b2b_customer where flowaccount_name ilike 'FlyO';
  select id into v_dup  from inventory.b2b_customer where flowaccount_name ilike 'Four Sea Oasis Co., Ltd.';

  if v_keep is null then
    -- Already merged (or never seeded) — nothing to fold.
    return;
  end if;

  if v_dup is not null then
    -- Invoices and consignment_location are the only FKs onto b2b_customer.
    update inventory.flowaccount_invoice
       set customer_id = v_keep
     where customer_id = v_dup;

    -- Keep a Loyverse link if only the duplicate had one.
    select loyverse_customer_id into v_lv from inventory.b2b_customer where id = v_dup;
    if v_lv is not null then
      update inventory.b2b_customer
         set loyverse_customer_id = coalesce(loyverse_customer_id, v_lv)
       where id = v_keep;
    end if;

    delete from inventory.consignment_location where customer_id = v_dup;
    delete from inventory.b2b_customer          where id = v_dup;
  end if;

  update inventory.b2b_customer
     set flowaccount_name = 'Four Sea Oasis Co., Ltd.',
         brand_name       = 'FlyO',
         updated_at       = now()
   where id = v_keep;

  -- The consignment location is named after the customer everywhere else.
  update inventory.consignment_location
     set name = 'Four Sea Oasis Co., Ltd.'
   where customer_id = v_keep;
end $$;
