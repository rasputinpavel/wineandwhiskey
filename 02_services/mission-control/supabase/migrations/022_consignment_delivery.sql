-- Consignment deliveries (stock arrivals booked outside Purchase Orders).
--
-- Harvest ships goods that we enter directly into Loyverse as stock
-- adjustments, not via a PO. We record each arrival here (sku, qty, date) so
-- the Monthly Report can reconcile stock:
--   Closing = Opening + Delivered − Sold − Tastings.
-- Deliveries do NOT affect the settlement amount (we still owe per unit sold);
-- they only explain mid-period stock increases. qty may be negative for a
-- correction / return.

create table if not exists inventory.consignment_delivery (
  id            uuid primary key default gen_random_uuid(),
  supplier_id   uuid not null references inventory.supplier(id) on delete cascade,
  sku_id        uuid not null references inventory.sku(id) on delete cascade,
  delivered_at  date not null,
  qty           integer not null check (qty <> 0),
  note          text,
  created_at    timestamptz not null default now()
);

create index if not exists consignment_delivery_supplier_date_idx
  on inventory.consignment_delivery(supplier_id, delivered_at);
