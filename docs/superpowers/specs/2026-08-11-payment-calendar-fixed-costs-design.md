# Payment Calendar — full OUT (fixed costs + big one-offs)

**Date:** 2026-08-11
**Area:** `02_services/mission-control` → `/m/payment-calendar`
**Related:** [[project_fixed_costs_mandatory]] (this is its Phase 3 "Calendar"), builds on
`2026-06-10-payment-calendar-receivables-design.md` and
`2026-06-11-mandatory-expenses-fixed-costs-design.md`.

## Problem

The Payment Calendar OUT side today shows **only supplier payments** (кредиторка — PO
from `public.purchase_orders`). The recurring mandatory obligations (Rent, Salary, Taxes,
Utilities, Accounting, Salary Advance) and the one-off "Big" payments (Som deposit, Alcohol
licence, Visa+work permit) do not appear anywhere in the calendar — they only flow through
the Google Expenses sheet at bucket level. So the calendar is **not** a complete "what do I
owe and when" picture, and there is **no place to tick a fixed cost off as paid** — the user
currently marks fixed costs paid nowhere.

## Goal

1. Show **all** OUT obligations on one dated timeline: supplier PO + fixed obligations + big one-offs.
2. Let the user **mark a fixed obligation / big payment as paid directly in the calendar** — making
   the calendar the single monthly checklist for "have I paid this yet".

Non-goals: touch the IN (invoices) side, Rolling, the Expenses sheet, or PO logic. Addition is
purely additive — the "Обязательные" bucket is absent from the calendar today, so there is no
double-count with the existing PO (кредиторка) rows.

## Data sources (all already exist)

| Kind | Source table | Date | Amount | Paid signal |
|------|-------------|------|--------|-------------|
| `po` (existing) | `public.purchase_orders` | `order_date` + supplier terms | `total_thb` | `paid_at` |
| `fixed` (new) | `inventory.fixed_cost` (active, `due_day` set) via `generateObligations()` | month + `due_day` | flat `amount_thb`, or `percent_revenue` × month revenue | `inventory.mandatory_actual.paid` (per `fixed_cost_id` + `period`) |
| `big` (new) | `inventory.rolling_big_payment` (has `due_date`) | `due_date` | `amount` | `status = 'paid'` |

**Revenue for %-rows** (Taxes 3.5%, Salary Bonuses 1%): computed exactly like Rolling —
`avgRetailPerDay × daysInMonth(period)`, where `avgRetailPerDay` = trailing-7-day B2C (SALE −
REFUND) / 7. The calendar page will start reading the shared cached receipt history
(`getReceiptHistory` from `lib/receipts-cache.ts`) — the same cache four other pages already
use, so cost is negligible. Closed (past) months, if ever shown, use actual month revenue; but
per the horizon rules below the calendar only ever generates current-or-future obligations, so
in practice revenue is always the run-rate estimate.

## View behaviour

The calendar has two modes: **Open** (outstanding, no month param) and **Monthly** (a month clicked).

### Monthly view
For the selected month `YYYY-MM`:
- **fixed:** every active obligation of that month (`generateObligations(month, …)`), dated on its
  `due_day`. Amount and paid status resolved via `mandatory_actual` overrides for that period
  (`applyOverrides`). If `amount_thb` override is set, use it; else planned. Paid rows show green,
  like paid POs; unpaid rows colour by date (overdue / today / future).
- **big:** every `rolling_big_payment` whose `due_date` falls in the month (paid ones green).

### Open view
Recurring obligations would repeat forever, and past unpaid months are noise (they're already
captured in the Expenses bucket actuals and are not marked paid per-instance). So:
- **fixed:** the **next upcoming occurrence** of each active obligation, from today through the
  **end of next month** (horizon = current + next month, matching the +2 month strip). An
  obligation whose `due_day` already passed this month rolls to next month's occurrence
  (e.g. Salary due_day 3 on 2026-08-11 → 2026-09-03). No past-month rows → no fake overdue.
  Paid status: if the *current* month's instance is marked paid in `mandatory_actual`, skip the
  current-month occurrence and show next month's instead.
- **big:** `rolling_big_payment` with `status != 'paid'`; overdue (`due_date < today`) pulled to
  today so it stays visible (same "overdue → today" rule Rolling uses). Horizon cap: due_date ≤
  end of next month.

Both kinds count into the OUT KPI ("К оплате (OUT)") and the running NET, exactly like POs.

## Components & changes

### `lib/payment-calendar-out.ts` (new — pure helpers, unit-testable)
- `buildFixedRows(fixedCosts, overrides, revenueOf, opts): CalRow[]` — given active `fixed_cost`
  rows, `mandatory_actual` overrides, a `revenueOfMonth(period)` fn, and `{ mode: 'open'|'month',
  month, today }`, returns dated OUT rows with `kind:'fixed'`. Encapsulates the horizon/next-occurrence
  logic so it can be tested without the page.
- `buildBigRows(bigPayments, opts): CalRow[]` — same shape for `kind:'big'`.
- Reuses `generateObligations` / `applyOverrides` from `lib/mandatory.ts`; does not duplicate the
  obligation maths.

### `Timeline.tsx` (`components/modules/payment-calendar/`)
- Extend `CalRow` with a discriminator and per-kind payload:
  ```ts
  kind: 'po' | 'fixed' | 'big'
  fixed?: { fixedCostId: string; period: string; paid: boolean }   // kind === 'fixed'
  big?:   { id: string; paid: boolean }                            // kind === 'big'
  ```
  (`po?` stays for `kind === 'po'`.)
- **Type badge** in the Doc/Counterparty cell: `Поставщик` (po) / `Постоянное` (fixed) /
  `Разовое` (big), so rent is visually distinct from a supplier payment.
- **Status cell** branches on `kind`:
  - `po` → existing `PaidAtCell` + `DocsUrlCell` (unchanged).
  - `fixed` → new `MarkPaidCell` → `POST /api/m/mandatory-actual` `{ fixed_cost_id, period, paid:true,
    paid_at: today }` (existing endpoint). Un-mark supported (paid:false).
  - `big` → new `MarkPaidCell` → `PATCH /api/m/rolling/payment` `{ id, status:'paid' }` (existing endpoint).
- `handlePaid` Open-view flash-and-exit animation reused as-is (keyed by `r.key`).

### `MarkPaidCell.tsx` (new client component)
A small "оплачено" button + optimistic call to the given endpoint; on success calls
`onSaved(value)` so the Timeline runs its existing flash/refresh. One component, parameterised by
`{ endpoint, payloadPaid, payloadUnpaid, paid }` — no per-kind duplication.

### `payment-calendar/page.tsx`
- Fetch `fixed_cost`, `mandatory_actual` (for the relevant period(s)), `rolling_big_payment`, and the
  cached receipt history (for `avgRetailPerDay`).
- Build `revenueOf(period)` from the run-rate.
- Assemble OUT rows = existing PO rows + `buildFixedRows(...)` + `buildBigRows(...)`, then the
  existing sort + running-NET pass (unchanged). KPIs pick them up automatically since they're OUT rows.
- Tolerate a missing `rolling_big_payment` table (migration 026) the way Rolling does — soft banner,
  don't crash.

## No new migration
`fixed_cost` (029), `mandatory_actual` (029), `rolling_big_payment` (026) already exist and are
applied. Both write APIs (`/api/m/mandatory-actual`, `/api/m/rolling/payment`) already exist. This is
read-assembly + UI wiring only.

## Testing
- Unit-test `buildFixedRows` / `buildBigRows`: next-occurrence roll-over (due_day passed → next month),
  horizon cap, paid-current-month → shows next month in Open, %-revenue amount, override amount wins.
- Manual: monthly view shows all fixed rows on correct days; marking Rent paid greens it and drops it
  from "К оплате"; Open view shows current+next month only, no past overdue; NET includes the new OUT.

## Rollout
Single branch `feat/payment-calendar-fixed-costs`, build + typecheck, then merge to `main`
(Railway auto-deploys). No manual migration step.
