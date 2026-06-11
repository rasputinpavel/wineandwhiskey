-- Dated mandatory expenses — turn the undated monthly fixed-cost template into
-- dated obligations (rent on the 15th, salary on the 3rd, taxes ~10th) so Rolling
-- can place them on their real dates instead of smearing the monthly sum evenly,
-- and so we can track plan vs actual per month.
--
--   due_day        — day-of-month the obligation falls due (NULL → legacy smear)
--   match_category — Expenses-sheet category label(s) that reconcile to this row
--                    (comma-separated aliases; NULL → match on the category name)
--
-- mandatory_actual holds MANUAL overrides only — a row exists just when the owner
-- corrects the auto-matched fact (or marks something the Expenses sheet missed).
-- Absent → fact is derived live from the Expenses sheet.
--
-- Run in the Supabase SQL Editor.

alter table inventory.fixed_cost
  add column if not exists due_day smallint
    check (due_day is null or (due_day >= 1 and due_day <= 31)),
  add column if not exists match_category text;

create table if not exists inventory.mandatory_actual (
  fixed_cost_id  uuid not null references inventory.fixed_cost(id) on delete cascade,
  period         text not null,                       -- 'YYYY-MM'
  paid           boolean not null default false,      -- mark paid even if the sheet missed it
  amount_thb     numeric check (amount_thb is null or amount_thb >= 0), -- null → use sheet sum
  paid_at        date,
  note           text,
  updated_at     timestamptz not null default now(),
  primary key (fixed_cost_id, period)
);
