-- ─── 1. Expand wine_type to include orange ───────────────────────────────────
alter table wine_items
  drop constraint if exists wine_items_wine_type_check;

alter table wine_items
  add constraint wine_items_wine_type_check
  check (wine_type in ('red', 'white', 'rose', 'orange', 'sparkling'));

-- ─── 2. Add spirit_type (no CHECK; parser normalises in code) ─────────────────
-- Canonical values used by parsers: whisky, vodka, gin, rum, tequila, brandy,
-- cognac, grappa, liqueur, shochu, sake, vermouth, aperitif, bitters,
-- armagnac, calvados, mezcal, eau-de-vie, other.
alter table wine_items
  add column if not exists spirit_type text;

create index if not exists wine_items_spirit_type_idx on wine_items(spirit_type);

-- ─── 3. price_lists.kind — distinguishes regular / promo / wholesale / etc ────
alter table price_lists
  add column if not exists kind text not null default 'regular'
  check (kind in ('regular', 'promo', 'wholesale', 'closeout', 'vip'));

create index if not exists price_lists_kind_idx on price_lists(kind);

-- ─── 4. Refresh get_filter_options() to expose wine_types + spirit_types ──────
create or replace function get_filter_options()
returns json
language sql
stable
as $$
  select json_build_object(
    'suppliers', (
      select coalesce(json_agg(s order by s), '[]'::json)
      from (select distinct supplier_name as s from wine_items where supplier_name is not null and supplier_name != 'null') t
    ),
    'countries', (
      select coalesce(json_agg(c order by c), '[]'::json)
      from (select distinct country as c from wine_items where country is not null) t
    ),
    'grapes', (
      select coalesce(json_agg(g order by g), '[]'::json)
      from (
        select distinct trim(unnested) as g
        from wine_items, unnest(string_to_array(grape_variety, ',')) as unnested
        where grape_variety is not null and trim(unnested) != ''
      ) t
    ),
    'wine_types', (
      select coalesce(json_agg(w order by w), '[]'::json)
      from (select distinct wine_type as w from wine_items where wine_type is not null) t
    ),
    'spirit_types', (
      select coalesce(json_agg(sp order by sp), '[]'::json)
      from (select distinct spirit_type as sp from wine_items where spirit_type is not null) t
    ),
    'kinds', (
      select coalesce(json_agg(k order by k), '[]'::json)
      from (select distinct kind as k from price_lists where kind is not null) t
    )
  )
$$;
