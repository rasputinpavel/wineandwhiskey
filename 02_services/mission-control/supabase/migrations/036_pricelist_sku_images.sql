-- 036_pricelist_sku_images.sql
-- Per-SKU photo for the price-list builder. Two independent sources:
--   image_slug — a bottle shot picked from the existing library
--                (public/brand/products/<slug>.png), rendered from disk.
--   image_url  — an uploaded, background-removed photo in Supabase Storage
--                (bucket `product-images`), rendered by URL.
-- image_url wins when both are set. Applied by hand in the Supabase SQL Editor.
--
-- MANUAL STEP: create a public Storage bucket named `product-images`
--   (Supabase → Storage → New bucket → public) for the uploader to write to.

alter table marketing.sku_enrichment
  add column if not exists image_slug text,
  add column if not exists image_url  text;
