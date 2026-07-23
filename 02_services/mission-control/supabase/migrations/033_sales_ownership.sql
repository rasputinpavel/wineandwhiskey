-- Sales lead ownership + duplicate detection.
--
-- 1) portal.users.sales_name — links a portal login to the free-text `assignee`
--    shown on the leads they own. The sales list uses it for the "my leads"
--    default filter; a lead's assignee is set to this value.
-- 2) sales.lead.name_norm — normalized name (lower + collapse whitespace + trim)
--    for duplicate detection on manual lead creation. GENERATED + STORED so it
--    stays in sync and is indexable. The app's normalizeName() in
--    lib/sales/dedup.ts must produce the IDENTICAL string.
--
-- Manual-apply migration (service key is PostgREST, not DDL). portal + sales
-- are already exposed schemas; no settings change needed.

alter table portal.users add column if not exists sales_name text;

alter table sales.lead add column if not exists name_norm text
  generated always as (lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))) stored;

create index if not exists lead_name_norm_idx on sales.lead (name_norm);
create index if not exists lead_assignee_idx  on sales.lead (assignee);
