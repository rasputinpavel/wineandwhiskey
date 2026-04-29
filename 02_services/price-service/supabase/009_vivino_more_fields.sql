-- Vivino enrichment: extra fields harvested from the actor.
-- Run in Supabase SQL Editor.

alter table wine_items
  add column if not exists vivino_images           jsonb,        -- string[] — all image URLs from Vivino
  add column if not exists vivino_alcohol          numeric(4,2), -- ABV %, e.g. 13.50
  add column if not exists vivino_body             text,         -- 'light' | 'medium' | 'full' (or actor verbatim)
  add column if not exists vivino_flavors          jsonb,        -- string[] — taste descriptors
  add column if not exists vivino_food_pairings    jsonb,        -- string[] — suggested pairings
  add column if not exists vivino_region_hierarchy jsonb,        -- { country, region, subregion, appellation }
  add column if not exists vivino_style            text,         -- e.g. "Argentinian Malbec"
  add column if not exists vivino_year             int;          -- vintage from Vivino (separate from local year)

-- Index ABV for filter queries; jsonb fields are filtered server-side, no index needed yet.
create index if not exists wine_items_alcohol_idx on wine_items(vivino_alcohol);
create index if not exists wine_items_body_idx    on wine_items(vivino_body);
