# Bot payment alerts from Mission Control

**Date:** 2026-06-15
**Status:** Approved design, pending implementation

## Problem

The "Чип и Дейл" bot morning briefing ("Доброе утро, команда!") ends with two blocks:

- 💰 **Нам должны (Дебиторка)** — receivables
- 🧾 **Мы должны (Кредиторка)** — payables

These are read from a manually-maintained Google Sheet (`01_agents/bot/src/sheets.ts`, tabs `Дебиторка` / `Кредиторка`). "Paid" is detected only by an exact literal `"paid"` cell anywhere in the row, so debts already paid and marked in Mission Control still surface as overdue. This is wrong and confusing for staff.

Mission Control already tracks the same concepts in Supabase with structured fields and drives the **Payment Calendar** page off them. The bot should read the same source so the two never disagree.

## Decisions (agreed with user)

1. **Source:** a new API endpoint in Mission Control (not direct Supabase from the bot) — keeps the selection logic in one place, next to the Payment Calendar.
2. **Google Sheet:** fully replaced as the source for these two alert blocks. The sheet-reading code for `Дебиторка`/`Кредиторка` is removed.
3. **3-day window:** kept — only items overdue or due within 3 days are shown (current behavior).
4. **Titov:** stays filtered out of reminders (`SKIP_NAMES` carve-out), applied to the new API results.

## Architecture

```
Bot (briefing.ts → getPaymentAlerts)
   │  HTTPS GET, Authorization: Bearer <PAYABLES_ALERT_SECRET>
   ▼
Mission Control: GET /api/public/payables-alerts
   │
   ├─ purchase_orders (paid_at IS NULL, poEligible)      → payables
   └─ flowaccount_invoice (status NOT IN Paid/Cancelled) → receivables
```

### 1. New route — `02_services/mission-control/app/api/public/payables-alerts/route.ts`

Mirrors `app/(portal)/m/payment-calendar/page.tsx` exactly.

- `export const dynamic = 'force-dynamic'`.
- **Auth (Pattern B, copied from `app/api/public/revalidate/route.ts`):**
  - `const secret = process.env.PAYABLES_ALERT_SECRET`
  - `503` if unset; read `Authorization: Bearer <token>` (fallback `x-revalidate-secret`-style header optional); `401` on mismatch.
  - Under `/api/public/` so `middleware.ts` skips the portal cookie check.
- **Supabase:** import `sbInventory`, `sbPublic` from `@/lib/supabase`; helpers `computeDueDate`, `todayBkk`, `daysBetween` from `@/lib/kpi`.

**Payables (кредиторка / OUT):**
- Query `sbPublic.from('purchase_orders').select(...).is('paid_at', null)`.
- Supplier terms/type from `sbInventory.from('supplier').select('name,type,payment_terms_days')`, keyed by `name.trim().toLowerCase()`.
- Eligibility (`poEligible`, identical to calendar): `status === 'closed'` AND supplier type !== `'consignment'` AND `cashflow_override !== 'exclude'` AND has `order_date`.
- Due date = `computeDueDate(order_date, supplierTerms)` (= `order_date + payment_terms_days`).
- Emit `{ name: supplier, date, amount: total_thb, daysUntil: daysBetween(date, todayBkk()) }`.

**Receivables (дебиторка / IN):**
- Query `sbInventory.from('flowaccount_invoice').select(...).not('status','in','(Paid,Cancelled)').eq('excluded', false).limit(500)`.
- Customer terms from `inventory.b2b_customer` (`id, payment_terms_days`).
- Due date = `due_at` if present, else `issued_at + customer terms` (`computeDueDate`); invoices with no resolvable date are omitted.
- Emit `{ name: customer_name, date, amount: total, daysUntil }`.

**Response shape:**
```json
{
  "today": "2026-06-15",
  "receivables": [{ "name": "...", "date": "2026-05-15", "amount": 1234, "daysUntil": -31 }],
  "payables":    [{ "name": "...", "date": "2026-05-15", "amount": 5678, "daysUntil": -31 }]
}
```
The route returns ALL eligible open items; the 3-day window and Titov skip are applied by the bot (keeps those policy knobs where they live today).

### 2. Bot changes — `01_agents/bot/src/sheets.ts`

- Rewrite `getPaymentAlerts(withinDays)` to `fetch(`${MISSION_CONTROL_URL}/api/public/payables-alerts`, { headers: { Authorization: \`Bearer ${PAYABLES_ALERT_SECRET}\` } })` instead of calling the Google Sheets API.
- Map the JSON into the **same return shape** `briefing.ts` already consumes, so `formatPaymentAlerts()` and the message layout are unchanged.
- Keep the existing filters, applied to API results:
  - `withinDays` (3): keep only items with `daysUntil <= withinDays`.
  - `SKIP_NAMES` (`titov` / `титов`): drop matching receivables.
  - The "просрочено на N дн." label is derived from `daysUntil` exactly as today.
- Remove the now-unused Google Sheets code paths for these two tabs (`gToken`, `readSheet`, sheet ID/range constants) **only if** nothing else in the bot uses them; otherwise leave shared helpers and remove just the `Дебиторка`/`Кредиторка` fetch logic. (Verify during implementation.)
- New env vars: `MISSION_CONTROL_URL`, `PAYABLES_ALERT_SECRET`. If either is missing, return `[]` (same graceful-degrade behavior as today's missing-Google-creds path).

### 3. Config / deploy (manual, by user)

- `PAYABLES_ALERT_SECRET` — generate one value, set on **both** mission-control and the bot (Railway).
- `MISSION_CONTROL_URL` — set on the bot = `https://mission-control-production-e1ab.up.railway.app`.
- Both services deploy on push to `main`.

## Error handling

- Route: `503` if secret unset, `401` on bad token, `500` on Supabase error (with logged message); never leaks the secret.
- Bot: network/HTTP error or missing env → log and return `[]`, so the briefing still sends without the alert block (matches current fail-soft behavior).

## Testing

- Route: unit/manual check that (a) unauthenticated → 401, (b) a known paid PO does NOT appear in `payables`, (c) a known unpaid closed PO DOES appear with correct due date, (d) consignment supplier excluded, (e) a `Paid` invoice excluded from `receivables`.
- Bot: with a stubbed endpoint response, `formatPaymentAlerts` produces the same text format as before; Titov filtered; only ≤3-day / overdue items shown.
- End-to-end sanity: bot's payables list matches the Payment Calendar's OUT column for the same day.

## Out of scope

- Other sheet-backed bot features.
- Amount/label formatting changes in the message.
- The Payment Calendar page itself (read-only reference).
- Refactoring `statusFor` out of the page (route computes `daysUntil` directly via `daysBetween`).
