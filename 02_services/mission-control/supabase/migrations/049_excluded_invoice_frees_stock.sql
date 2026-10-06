-- 049_excluded_invoice_frees_stock.sql
-- Инвойс, помеченный excluded, должен отпускать бутылки — сейчас он их держит.
--
-- Миграция 009 завела flowaccount_invoice.excluded для записей, которые в
-- FlowAccount кривые или аннулированы, а править/удалять их там не хотят
-- (sync всё равно вернёт). Но флаг читала ровно одна таблица — Outstanding
-- Invoices. Складские вьюхи его не видели, поэтому аннулированный инвойс
-- продолжал держать свои бутылки в B2B in transit, занижая IN STORE.
--
-- Живой случай: INV202510010001 (Golden Brewery, 01.10.2025) висит Unpaid 370
-- дней и держит 3 бутылки Chateau Tamagne TERROIR — ON HAND 21, а в зале
-- показывается 17, хотя бутылки стоят на полке. Таких инвойсов три:
--   INV202510010001  Golden Brewery  01.10.25  ฿2 572.60   4 бут.
--   INV202510280001  Golden Brewery  28.10.25  ฿1 861.80   3 бут.
--   INV202601120013  Titov           12.01.26  ฿6 420.00   6 бут.
-- Все обнулены — товар по факту в магазине.
--
-- excluded означает «этой записи нет»: она не висит в дебиторке, не держит
-- товар в транзите и не списывает бутылки с консигнационной полки.
--
-- Apply manually in the Supabase SQL Editor (same as every other migration).

-- 1) Транзит: аннулированный инвойс не держит товар.
create or replace view inventory.v_b2b_in_transit as
select
  l.sku_id,
  i.customer_id,
  i.customer_name,
  i.number          as invoice_number,
  i.issued_at,
  i.due_at,
  i.status,
  l.qty,
  l.amount
from inventory.flowaccount_invoice_line l
join inventory.flowaccount_invoice      i  on i.id = l.invoice_id
where i.status not in ('Paid','Cancelled')
  and i.excluded is not true
  and l.sku_id is not null;

-- 2) Консигнационный баланс: тем же счётом нельзя списать бутылку с полки.
--    Остальное — миграция 048.
create or replace view inventory.v_consignment_balance as
with first_dn as (
  select cl.id as location_id, min(dn.issued_at) as zero_date
  from inventory.consignment_location cl
  join inventory.delivery_note      dn  on dn.location_id = cl.id
  where dn.status in ('draft','issued','delivered')
  group by cl.id
), deliveries as (
  select cl.id as location_id, dnl.sku_id, sum(dnl.qty) as qty
  from inventory.consignment_location cl
  join inventory.delivery_note      dn  on dn.location_id = cl.id
  join inventory.delivery_note_line dnl on dnl.note_id = dn.id
  where dn.status in ('draft','issued','delivered')
  group by cl.id, dnl.sku_id
), sold as (
  select cl.id as location_id, fil.sku_id, sum(fil.qty) as qty
  from inventory.consignment_location     cl
  join first_dn                           fd  on fd.location_id = cl.id
  join inventory.flowaccount_invoice      fi  on fi.customer_id = cl.customer_id
  join inventory.flowaccount_invoice_line fil on fil.invoice_id = fi.id
  where fi.status <> 'Cancelled'
    and fi.excluded is not true                -- аннулирован: записи как будто нет
    and fi.consignment_exempt is not true      -- продажа поверх полки (048)
    and fi.issued_at >= fd.zero_date           -- старше полки (048)
    and fil.sku_id is not null
  group by cl.id, fil.sku_id
)
select
  d.location_id,
  d.sku_id,
  greatest(coalesce(d.qty,0) - coalesce(s.qty,0), 0) as qty
from deliveries d
left join sold s on s.location_id = d.location_id and s.sku_id = d.sku_id
where (coalesce(d.qty,0) - coalesce(s.qty,0)) > 0;

-- 3) Сами три обнулённых инвойса. Идемпотентно; дальше флаг ставится из
--    портала (вкладка Tax Invoices, кнопка excluded), а не правкой файла.
update inventory.flowaccount_invoice
   set excluded = true
 where number in ('INV202510010001', 'INV202510280001', 'INV202601120013');
