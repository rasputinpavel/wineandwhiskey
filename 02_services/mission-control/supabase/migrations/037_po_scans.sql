-- 037_po_scans.sql
-- Purchase Order scan archive. Managers photograph the paper PO that arrives
-- with each supplier shipment; the Chip & Dale Telegram bot extracts the key
-- fields and stores the scan in the private `po-scans` Storage bucket. The
-- paper original still goes to bookkeeping — this is the store's own copy,
-- retrievable when a supplier later asks "which invoice was this against?".
--
-- DELIBERATELY SEPARATE from public.purchase_orders (that table is owned by the
-- cost scraper 03_automation/scrape_purchase_orders.ts). Do not merge the two.
--
-- The private Storage bucket `po-scans` must be created once in Supabase Studio.

create table if not exists public.po_scans (
  id            uuid primary key default gen_random_uuid(),
  supplier      text,                         -- normalized supplier name
  supplier_raw  text,                         -- as written on the document
  doc_number    text,                         -- Purchase No. / invoice number
  order_date    date,                         -- date printed on the document
  received_date date not null default (now() at time zone 'Asia/Bangkok')::date,
  amount_total  numeric(12,2),                -- total incl. VAT, THB
  scan_path     text not null,                -- object path in bucket `po-scans`
  note          text,
  uploaded_by   text,                         -- Telegram name of the manager
  created_at    timestamptz not null default now()
);

create index if not exists po_scans_supplier_idx   on public.po_scans (lower(supplier));
create index if not exists po_scans_doc_number_idx  on public.po_scans (doc_number);
create index if not exists po_scans_order_date_idx   on public.po_scans (order_date desc);
