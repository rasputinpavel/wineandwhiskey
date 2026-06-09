-- Big one-off / annual payments for the Rolling cashflow forecast (alcohol
-- licence, visa + work permit, deposits…). Each lands in the week of its
-- due_date and is subtracted from that week's running balance — unless already
-- marked paid (then it's just history, not a future obligation).
--
-- Run in the Supabase SQL Editor.

create table if not exists inventory.rolling_big_payment (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  amount      numeric not null check (amount > 0),
  due_date    date,                          -- null = unscheduled (shown, not subtracted)
  status      text not null default 'planned' check (status in ('planned','paid')),
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists rolling_big_payment_due_idx on inventory.rolling_big_payment(due_date);

-- Seed the two known annual payments from the sheet. Set their dates in the portal.
insert into inventory.rolling_big_payment (name, amount, due_date, status) values
  ('Alcohol licence',      10000, null, 'planned'),
  ('Visa + work permit',   40000, null, 'planned')
on conflict do nothing;
