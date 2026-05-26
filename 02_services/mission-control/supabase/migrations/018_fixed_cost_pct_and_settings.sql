-- Two upgrades to Finance Pulse cost handling:
--
-- 1. fixed_cost rows can now be either a flat THB/month amount (legacy)
--    OR a percent of revenue. When percent_revenue is non-NULL, the row
--    is treated as pct-of-revenue and amount_thb is ignored.
--
-- 2. The 15% safety buffer that pulse used to hard-code is now stored
--    in pulse_settings.fixed_buffer_pct so the owner can tune it from
--    the Settings page.

alter table inventory.fixed_cost
  alter column amount_thb drop not null,
  add column if not exists percent_revenue numeric
    check (percent_revenue is null or (percent_revenue >= 0 and percent_revenue <= 100));

create table if not exists inventory.pulse_settings (
  id                smallint primary key default 1 check (id = 1),
  fixed_buffer_pct  numeric not null default 15 check (fixed_buffer_pct >= 0),
  updated_at        timestamptz not null default now()
);

insert into inventory.pulse_settings (id) values (1) on conflict (id) do nothing;
