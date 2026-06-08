-- Income / Cash module — three money wallets and a manual ledger of inflows,
-- outflows and transfers between them. Backs the portal /m/income page (the
-- native replacement for the Google Sheet "Income" tab).
--
-- Design:
--   • Wallets: 'account' (company bank), 'cash' (register), 'personal' (owner).
--     Each carries an opening balance at the START of opening_date — everything
--     dated on/after opening_date (movements + expenses) is added forward.
--   • money_movement holds ONLY what the user enters by hand: inflows (money in),
--     transfers between wallets (e.g. cash → account), and the occasional manual
--     outflow (owner withdrawal). Business EXPENSES are NOT stored here — they're
--     read live from the Google Sheet "Expenses" (written by the ops bot) and
--     attributed to a wallet, so we never double-enter them.
--
-- Run in the Supabase SQL Editor.

create table if not exists inventory.money_wallet (
  id              text primary key,              -- 'account' | 'cash' | 'personal'
  name            text not null,
  opening_balance numeric not null default 0,
  opening_date    date    not null,              -- balance is "as of" this date
  sort_order      int     not null default 100,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists inventory.money_movement (
  id             uuid primary key default gen_random_uuid(),
  occurred_on    date not null,
  kind           text not null check (kind in ('inflow','outflow','transfer')),
  amount         numeric not null check (amount > 0),
  -- inflow / outflow target wallet:
  wallet_id      text references inventory.money_wallet(id),
  -- transfer endpoints:
  from_wallet_id text references inventory.money_wallet(id),
  to_wallet_id   text references inventory.money_wallet(id),
  note           text,
  created_at     timestamptz not null default now(),
  -- Shape guard: inflow/outflow need wallet_id; transfer needs from≠to.
  check (
    (kind in ('inflow','outflow') and wallet_id is not null
       and from_wallet_id is null and to_wallet_id is null)
    or
    (kind = 'transfer' and from_wallet_id is not null and to_wallet_id is not null
       and from_wallet_id <> to_wallet_id and wallet_id is null)
  )
);

create index if not exists money_movement_date_idx on inventory.money_movement(occurred_on);

-- Seed the three wallets. Opening balances are placeholders from the Income
-- sheet's last known cumulative values (account / cash / personal) — verify and
-- adjust them on the /m/income page.
insert into inventory.money_wallet (id, name, opening_balance, opening_date, sort_order) values
  ('account',  'Company account', 35197, '2026-06-01', 1),
  ('cash',     'Cash register',   15211, '2026-06-01', 2),
  ('personal', 'Personal',        13199, '2026-06-01', 3)
on conflict (id) do nothing;
