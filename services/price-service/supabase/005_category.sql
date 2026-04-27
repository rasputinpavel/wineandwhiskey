alter table wine_items
  add column if not exists category  text check (category in ('wine', 'spirits', 'beer', 'other')),
  add column if not exists wine_type text check (wine_type in ('red', 'white', 'rose', 'sparkling'));

create index if not exists wine_items_category_idx  on wine_items(category);
create index if not exists wine_items_wine_type_idx on wine_items(wine_type);
