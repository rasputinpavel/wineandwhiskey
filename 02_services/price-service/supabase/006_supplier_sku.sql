alter table wine_items
  add column if not exists supplier_sku text;

create index if not exists wine_items_supplier_sku_idx on wine_items(supplier_sku);

-- Per-price-list uniqueness on supplier SKU. Two price lists can have the same SKU
-- (re-upload, fresh issue), but within one list a SKU must not duplicate.
create unique index if not exists wine_items_pricelist_sku_uniq
  on wine_items(price_list_id, supplier_sku) where supplier_sku is not null;
