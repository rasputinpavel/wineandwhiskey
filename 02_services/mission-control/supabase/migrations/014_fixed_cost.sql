-- Monthly fixed costs (rent, payroll, utilities, fees…) — used by the Finance
-- Pulse dashboard to compute the daily break-even revenue:
--
--   daily break-even revenue ≈ SUM(active monthly fixed costs) / 30 / GM%
--
-- Source of truth lives in Google Sheets "Обязательные", but we mirror it here
-- so the portal can compute the metric without screen-scraping Sheets and so
-- non-technical users can edit values from the /m/pulse/settings page.
--
-- Run in Supabase SQL Editor.

create table if not exists inventory.fixed_cost (
  id          uuid primary key default gen_random_uuid(),
  category    text not null,                       -- 'Rent', 'Payroll', 'Utilities', …
  amount_thb  numeric not null check (amount_thb >= 0),
  active      boolean not null default true,       -- inactive rows are kept for history but excluded from totals
  notes       text,
  sort_order  int not null default 100,            -- ascending order in the UI
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists fixed_cost_active_idx
  on inventory.fixed_cost(active) where active is true;

-- Seed a single row capturing Pavel's stated baseline. Edit / split by
-- category through the portal. ON CONFLICT clause is a no-op safeguard
-- against re-running the migration: there's no unique constraint on
-- category, so a manual second-run would create a duplicate row.
insert into inventory.fixed_cost (category, amount_thb, notes, sort_order)
  select 'All operating costs', 90000,
         'Initial estimate — break down by category in the portal', 100
  where not exists (select 1 from inventory.fixed_cost);
