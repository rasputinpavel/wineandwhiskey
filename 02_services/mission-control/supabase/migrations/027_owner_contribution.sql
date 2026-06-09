-- Flag a money_movement inflow as an owner contribution (equity injection to
-- cover a cash gap) rather than business income. It still counts toward real
-- liquidity (the cash is in the account), but it is surfaced separately so it
-- never inflates business performance and we can see how much owner financing
-- has been needed.
--
-- Run in the Supabase SQL Editor.

alter table inventory.money_movement
  add column if not exists owner_contribution boolean not null default false;

-- Tag the existing "From owner" inflow.
update inventory.money_movement
  set owner_contribution = true
  where kind = 'inflow' and owner_contribution = false
    and (lower(coalesce(note, '')) like '%owner%' or lower(coalesce(note, '')) like '%владел%');
