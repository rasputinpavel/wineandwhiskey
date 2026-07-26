-- 035_marketing_pricelist.sql
-- Price List Builder (Marketing → Price Lists).
-- MANUAL STEP: after applying, add schema `marketing` to Supabase
--   Settings → API → Exposed schemas, or PostgREST returns 404.
-- Applied by hand in the Supabase SQL Editor (service key is PostgREST, not DDL).

create schema if not exists marketing;

-- Region/producer/volume are NOT in inventory.v_sku_breakdown but appear on the
-- price-list card. Keyed by Loyverse product code so a value entered once
-- prefills every future list that includes the same product.
create table if not exists marketing.sku_enrichment (
  loyverse_product_code text primary key,
  region                text,
  producer              text,
  volume                text,
  updated_at            timestamptz not null default now()
);

-- Saved price lists (drafts + finished). `items` is the ordered array of line
-- objects; `settings` holds header contact text, VAT note, grouping options,
-- tier thresholds, plaque overrides.
create table if not exists marketing.price_lists (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  grouping   text not null default 'manual',
  items      jsonb not null default '[]'::jsonb,
  settings   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Service-role-only access (mirrors portal.users). RLS on, no policies.
alter table marketing.sku_enrichment enable row level security;
alter table marketing.price_lists   enable row level security;
