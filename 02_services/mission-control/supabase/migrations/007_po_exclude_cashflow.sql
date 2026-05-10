-- Per-PO override: исключить покупку из cashflow/P&L расчётов.
-- Используется когда PO заведён криво (не та категория, дублирующая запись и т.п.)
-- и его поправить в Loyverse сложно/нельзя. Один клик в /m/purchases — забыли.
--
-- Источник истины для P&L остаётся в purchase_orders (Loyverse-scraped),
-- этот флаг — точечный override на уровне отдельного PO.
--
-- Run in Supabase SQL editor.

alter table public.purchase_orders
  add column if not exists exclude_from_cashflow boolean not null default false;

create index if not exists purchase_orders_exclude_idx
  on public.purchase_orders(exclude_from_cashflow)
  where exclude_from_cashflow is true;
