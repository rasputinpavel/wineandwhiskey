-- Run this in Supabase SQL Editor

-- Suppliers
create table if not exists suppliers (
  id         uuid default gen_random_uuid() primary key,
  name       text not null,
  slug       text unique not null,
  created_at timestamptz default now()
);

-- Price lists (one per PDF upload)
create table if not exists price_lists (
  id            uuid default gen_random_uuid() primary key,
  supplier_id   uuid references suppliers(id) on delete set null,
  supplier_name text,
  date          date,
  pdf_url       text,
  status        text not null default 'pending'
                  check (status in ('pending', 'processing', 'done', 'error')),
  item_count    int not null default 0,
  error_message text,
  uploaded_at   timestamptz default now()
);

-- Wine / spirits items extracted from price lists
create table if not exists wine_items (
  id            uuid default gen_random_uuid() primary key,
  price_list_id uuid references price_lists(id) on delete cascade,
  supplier_id   uuid references suppliers(id) on delete set null,
  supplier_name text,
  name          text not null,
  country       text,
  region        text,
  grape_variety text,
  price         numeric,
  year          int,
  volume        text,
  description   text,
  image_url     text,
  created_at    timestamptz default now()
);

-- Indexes for common filter queries
create index if not exists wine_items_name_idx       on wine_items using gin(to_tsvector('simple', name));
create index if not exists wine_items_supplier_idx   on wine_items(supplier_name);
create index if not exists wine_items_country_idx    on wine_items(country);
create index if not exists wine_items_grape_idx      on wine_items(grape_variety);
create index if not exists wine_items_price_list_idx on wine_items(price_list_id);

-- Storage bucket (run separately or via Supabase dashboard)
-- insert into storage.buckets (id, name, public) values ('price-pdfs', 'price-pdfs', true)
-- on conflict do nothing;
