alter table wine_items
  add column if not exists vivino_rating      numeric(3,1),
  add column if not exists vivino_reviews_count integer,
  add column if not exists vivino_url         text,
  add column if not exists vivino_image_url   text,
  add column if not exists vivino_enriched_at timestamptz;
