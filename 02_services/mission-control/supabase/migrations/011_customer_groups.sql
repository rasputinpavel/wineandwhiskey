-- Замена parent_id (migration 010) на полноценную сущность «группа».
--
-- В parent_id-подходе head office был и customer'ом, и заголовком группы
-- одновременно — непонятно, чьи суммы показывает строка head'а. Теперь
-- группа = отдельная таблица b2b_customer_group, а customer'ы линкуются
-- к группе через nullable group_id.
--
-- Преимущества:
--   • Группа имеет своё имя (не привязано к одному из branch'ей)
--   • Цифры на строке группы — однозначно aggregate по всем members
--   • Customer'ы внутри группы равноправные (нет «head»)
--   • Бранчи можно добавлять/удалять без переименований
--
-- Run в Supabase SQL editor.

-- 1. Снимаем parent_id (010) — заменяем подходом.
alter table inventory.b2b_customer
  drop column if exists parent_id;

drop index if exists inventory.b2b_customer_parent_idx;

-- 2. Группа — независимая сущность.
create table if not exists inventory.b2b_customer_group (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 3. Customer ссылается на группу (опционально).
alter table inventory.b2b_customer
  add column if not exists group_id uuid references inventory.b2b_customer_group(id) on delete set null;

create index if not exists b2b_customer_group_idx
  on inventory.b2b_customer(group_id)
  where group_id is not null;
