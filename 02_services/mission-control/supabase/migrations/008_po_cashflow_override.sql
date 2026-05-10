-- Per-PO ручные пометки в /m/purchases:
--   • cashflow_override — 3-state: 'auto' | 'include' | 'exclude'
--       'auto'    — следуем типу поставщика (consignment → выкл., regular → вкл.)
--       'include' — ВСЕГДА учитывать в cashflow (пример: PO2916 — Harvest всё-таки
--                   продал нам нормальным счетом, не консигнацией)
--       'exclude' — ВСЕГДА исключить (для криво заведённых записей)
--   • paid_at    — дата фактической оплаты (NULL = не оплачено)
--   • docs_url   — ссылка на папку Google Drive с tax invoice + receipt
--
-- Заменяет migration 007 (там была булева exclude_from_cashflow).
-- Миграция идемпотентна: если 007 уже применён — старая колонка дропается.

alter table public.purchase_orders
  drop column if exists exclude_from_cashflow;

drop index if exists public.purchase_orders_exclude_idx;

alter table public.purchase_orders
  add column if not exists cashflow_override text not null default 'auto';

alter table public.purchase_orders
  drop constraint if exists purchase_orders_cashflow_override_check;

alter table public.purchase_orders
  add constraint purchase_orders_cashflow_override_check
    check (cashflow_override in ('auto', 'include', 'exclude'));

alter table public.purchase_orders
  add column if not exists paid_at  date,
  add column if not exists docs_url text;

create index if not exists purchase_orders_cashflow_override_idx
  on public.purchase_orders(cashflow_override)
  where cashflow_override <> 'auto';

create index if not exists purchase_orders_paid_at_idx
  on public.purchase_orders(paid_at)
  where paid_at is not null;
