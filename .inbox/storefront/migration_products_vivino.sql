-- Add Vivino enrichment columns to `products`.
-- Place at: supabase/migrations/<timestamp>_products_vivino_columns.sql
-- in the storefront repo (phuket-sip-reserve), then `supabase db push`.

alter table products
  add column if not exists vivino_rating              numeric(3,1),
  add column if not exists vivino_reviews_count       integer,
  add column if not exists vivino_image_url           text,
  add column if not exists vivino_url                 text,
  add column if not exists vivino_country             text,
  add column if not exists vivino_region              text,
  add column if not exists vivino_grape               text,
  add column if not exists vivino_wine_type           text,
  add column if not exists vivino_alcohol             numeric(4,2),
  add column if not exists vivino_body                text,
  add column if not exists vivino_year                integer,
  add column if not exists vivino_flavors             text[],
  add column if not exists vivino_food_pairings       text[],
  add column if not exists vivino_description         text,
  add column if not exists vivino_confidence          numeric(3,2),
  add column if not exists vivino_enriched_at         timestamptz,
  add column if not exists vivino_lookup_attempted_at timestamptz;

-- Index helps the edge function's "find products that need enrichment" query.
create index if not exists products_vivino_pending_idx
  on products (vivino_lookup_attempted_at nulls first)
  where vivino_enriched_at is null;
