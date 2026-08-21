-- 039_stock_writeoffs.sql
-- Bottles taken from stock "себе" that must be written off via a Loyverse Stock
-- Adjustment. The Chip & Dale Telegram bot records each as 'pending' and reminds
-- daily; a human does the actual adjustment in Loyverse and then closes the row
-- (status 'done') from the bot (/writeoffs) or the portal (/m/writeoffs).
--
-- The Loyverse public API does not expose adjustment history, so the human is
-- the source of truth. The bot NEVER writes to Loyverse.
--
-- Apply manually in the Supabase SQL Editor (same as all other migrations).

create table if not exists public.stock_writeoffs (
  id          uuid primary key default gen_random_uuid(),
  variant_id  text,                 -- Loyverse variant_id (for future reconciliation)
  item_name   text not null,        -- as in the Loyverse catalog at capture time
  qty         integer not null default 1,
  taken_date  date not null default (now() at time zone 'Asia/Bangkok')::date,
  taken_by    text,                 -- Telegram name of whoever logged it
  status      text not null default 'pending',  -- 'pending' | 'done'
  closed_at   timestamptz,
  closed_by   text,                 -- who pressed "Списано"
  created_at  timestamptz not null default now()
);

create index if not exists stock_writeoffs_status_idx
  on public.stock_writeoffs (status, taken_date);
