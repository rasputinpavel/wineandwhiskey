-- Per-supplier monthly billing cycle start day.
--
-- Most suppliers settle on the calendar month (cycle starts on day 1). Harvest
-- (consignment) settles 5th-to-5th: the invoice issued on the 5th of month Y
-- covers sales in [5th of Y-1, 5th of Y). Storing the start day per supplier
-- lets the Harvest Monthly Report (and any cycle-aware logic) compute the right
-- window instead of hard-coding it.
--
-- Capped at 28 so the cycle boundary exists in every month.

alter table inventory.supplier
  add column if not exists monthly_cycle_start_day smallint not null default 1
    check (monthly_cycle_start_day between 1 and 28);

-- Harvest Creation bills 5th-to-5th.
update inventory.supplier
  set monthly_cycle_start_day = 5
  where lower(name) like '%harvest%';
