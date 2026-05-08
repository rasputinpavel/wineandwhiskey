-- Replace boolean is_consignment with a 3-value `type` column on supplier:
--   regular     — all products via tax invoice (instant obligation)
--   consignment — all products via delivery note (monthly true-up)
--   mix         — part regular, part consignment (true-up applies only
--                 to the consignment subset, tracked at delivery level
--                 in step B)
--
-- Run in Supabase SQL editor.

alter table inventory.supplier
  add column if not exists type text not null default 'regular';

alter table inventory.supplier
  drop constraint if exists supplier_type_check;
alter table inventory.supplier
  add  constraint supplier_type_check check (type in ('regular','consignment','mix'));

-- Carry over the old boolean values, then drop the column.
update inventory.supplier
   set type = 'consignment'
 where is_consignment is true and type = 'regular';

alter table inventory.supplier drop column if exists is_consignment;
