-- Structured wine attributes on inventory.sku for the Wine Matrix service.
-- All nullable so non-wine SKUs (whisky, vodka, beer) stay clean.
-- `wine_attrs_source` distinguishes auto-match seeds (overwritable by the
-- next sync run) from manual overrides set via the SKU edit UI.

alter table inventory.sku
  add column if not exists wine_color text
    check (wine_color is null or wine_color in ('red','white','rose','sparkling','orange')),
  add column if not exists grape_variety text,
  add column if not exists wine_country text,
  add column if not exists wine_attrs_source text
    check (wine_attrs_source is null or wine_attrs_source in ('auto','manual')),
  add column if not exists wine_attrs_updated_at timestamptz;

create index if not exists sku_wine_color_idx     on inventory.sku(wine_color);
create index if not exists sku_wine_country_idx   on inventory.sku(wine_country);
create index if not exists sku_grape_variety_idx  on inventory.sku(grape_variety);

-- Re-add wine attrs to the breakdown view so Wine Matrix can read stock + attrs
-- in a single query.

create or replace view inventory.v_sku_breakdown as
with stock as (
  select sku_id, sum(qty) as qty from inventory.loyverse_stock group by sku_id
), transit as (
  select sku_id, sum(qty) as qty from inventory.v_b2b_in_transit group by sku_id
), consign as (
  select sku_id, sum(qty) as qty from inventory.v_consignment_balance group by sku_id
)
select
  s.id                                       as sku_id,
  s.loyverse_product_code,
  s.name,
  s.category,
  coalesce(stock.qty,   0)                   as on_hand,
  coalesce(transit.qty, 0)                   as b2b_in_transit,
  coalesce(consign.qty, 0)                   as on_consignment,
  greatest(coalesce(stock.qty,0)
         - coalesce(transit.qty,0)
         - coalesce(consign.qty,0), 0)       as in_store,
  s.wine_color,
  s.grape_variety,
  s.wine_country,
  s.default_price
from inventory.sku s
left join stock   on stock.sku_id   = s.id
left join transit on transit.sku_id = s.id
left join consign on consign.sku_id = s.id;
