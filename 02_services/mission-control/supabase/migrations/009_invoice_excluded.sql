-- Per-invoice override: исключить инвойс из Outstanding Invoices таблицы.
-- Используется для кривых записей в FlowAccount, которые нельзя/не хочется
-- править там (например тестовые инвойсы или дубликаты), но удалять их из
-- наших данных тоже нельзя (sync вернёт их обратно).
--
-- Аналог purchase_orders.cashflow_override, только проще — двух-состоянийный
-- boolean, без include/auto, потому что для инвойсов нет «правила по умолчанию
-- от типа клиента» — мы просто либо учитываем, либо нет.
--
-- Run in Supabase SQL editor.

alter table inventory.flowaccount_invoice
  add column if not exists excluded boolean not null default false;

create index if not exists fa_invoice_excluded_idx
  on inventory.flowaccount_invoice(excluded)
  where excluded is true;
