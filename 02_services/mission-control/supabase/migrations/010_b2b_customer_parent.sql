-- Группировка branch'ей под head office.
--
-- В FlowAccount каждая точка сети заведена отдельным customer'ом
-- (Karon Paragon, Karon Paragon Branch 00001, ... Fine Cusine, Fine Cusine 00009,
-- Fine Cusine (Kata) и т.д.). Для аналитики хочется видеть «группу» (общая
-- задолженность, обороты YTD) и одновременно сохранить пер-branch детализацию
-- инвойсов.
--
-- Решение: nullable FK b2b_customer.parent_id → b2b_customer.id.
--   • parent_id = null      → standalone клиент ИЛИ head office группы
--   • parent_id = some.id   → branch, его head office = some.id
--
-- Hierarchy ограничена одним уровнем (parent сам не может быть branch'ем).
-- Это enforce-ится в API/UI — БД не запрещает, но через UI выбрать parent'ом
-- branch не получится.

alter table inventory.b2b_customer
  add column if not exists parent_id uuid references inventory.b2b_customer(id) on delete set null;

create index if not exists b2b_customer_parent_idx
  on inventory.b2b_customer(parent_id)
  where parent_id is not null;
