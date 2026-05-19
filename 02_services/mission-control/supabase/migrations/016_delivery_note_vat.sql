-- Delivery notes record physical movement of goods on consignment. The
-- prices entered on the form are net (without VAT) — operators tick a
-- "Add 7% VAT" checkbox to add Thai VAT to the displayed totals.
--
-- Persist that choice so the printed DN can reproduce the same breakdown
-- (subtotal / VAT / total).

alter table inventory.delivery_note
  add column if not exists with_vat boolean not null default true;

comment on column inventory.delivery_note.with_vat is
  '7% Thai VAT applied to net line totals when rendering subtotal/VAT/total breakdown.';
