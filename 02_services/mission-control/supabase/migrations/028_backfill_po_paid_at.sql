-- One-time retrospective fill of purchase_orders.paid_at for historical POs
-- that should already have been paid. This makes the PO list read like the
-- creditors (кредиторка) register — every settled PO carries its payment date.
-- Going forward paid_at is marked by hand (click "+ paid" / pick a date).
--
-- Pay date uses the SAME formula the cashflow already assumes in Pulse/Rolling:
--   paid_at := order_date + supplier.payment_terms_days   (0 days if unknown)
-- so the register matches the numbers already booked in P&L — nothing shifts.
--
-- Scope (only touch what is genuinely already due):
--   • status = closed
--   • paid_at is null
--   • supplier is NOT consignment (those are booked from the Harvest invoice)
--   • cashflow_override <> 'exclude' (mis-entered junk records stay untouched)
--   • computed pay date is on or before today (Bangkok) — future POs untouched
--
-- Run in the Supabase SQL Editor. Idempotent: re-running only fills POs whose
-- paid_at is still null, so it is safe to run again later for the next batch.

-- ── Optional dry run — preview what WILL be filled (run this first) ──────────
-- with terms as (
--   select lower(trim(name)) as key, payment_terms_days, type
--   from inventory.supplier
-- )
-- select po.po_number, po.supplier, po.order_date,
--        coalesce(t.payment_terms_days, 0)                                 as terms_days,
--        (po.order_date + (coalesce(t.payment_terms_days, 0) || ' days')::interval)::date as pay_date,
--        po.total_thb
-- from public.purchase_orders po
-- left join terms t on t.key = lower(trim(po.supplier))
-- where lower(coalesce(po.status, '')) = 'closed'
--   and po.paid_at is null
--   and po.order_date is not null
--   and coalesce(t.type, 'regular') <> 'consignment'
--   and coalesce(po.cashflow_override, 'auto') <> 'exclude'
--   and (po.order_date + (coalesce(t.payment_terms_days, 0) || ' days')::interval)::date
--         <= (now() at time zone 'Asia/Bangkok')::date
-- order by po.order_date;

-- ── Backfill ────────────────────────────────────────────────────────────────
with terms as (
  select lower(trim(name)) as key, payment_terms_days, type
  from inventory.supplier
),
targets as (
  select po.id,
         (po.order_date + (coalesce(t.payment_terms_days, 0) || ' days')::interval)::date as pay_date,
         coalesce(t.type, 'regular')          as sup_type,
         coalesce(po.cashflow_override, 'auto') as override
  from public.purchase_orders po
  left join terms t on t.key = lower(trim(po.supplier))
  where lower(coalesce(po.status, '')) = 'closed'
    and po.paid_at is null
    and po.order_date is not null
)
update public.purchase_orders po
set paid_at = tg.pay_date
from targets tg
where po.id = tg.id
  and tg.sup_type <> 'consignment'
  and tg.override <> 'exclude'
  and tg.pay_date <= (now() at time zone 'Asia/Bangkok')::date;
