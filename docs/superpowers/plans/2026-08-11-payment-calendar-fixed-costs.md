# Payment Calendar — full OUT (fixed costs + big one-offs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add recurring mandatory obligations (`fixed_cost`) and one-off big payments (`rolling_big_payment`) to the Payment Calendar OUT timeline, with an inline "mark paid" control, so the calendar is a complete "what do I owe / have I paid it" view.

**Architecture:** A new pure helper module `lib/payment-calendar-out.ts` turns `fixed_cost` + `mandatory_actual` overrides and `rolling_big_payment` rows into `CalRow[]` (dated OUT rows), handling the Open-view next-occurrence/horizon logic. The server page assembles these alongside the existing PO rows and runs the unchanged sort + NET pass. The client `Timeline` gains two optional row payloads (`fixed`, `big`) and a reusable `MarkPaidCell` that POSTs/PATCHes the two existing write endpoints. No migration, no new API.

**Tech Stack:** Next.js (App Router, server components), TypeScript, Supabase JS (PostgREST), Vitest.

**Key design note (deviation from spec, simplification):** rows are discriminated by **which optional payload is present** (`po?` / `fixed?` / `big?` / `inv?`) rather than a separate `kind` field. This avoids putting a meaningless discriminator on IN (invoice) rows — the Timeline already branches on `dir === 'out'` first, then picks the paid control by payload.

---

## File Structure

- **Create** `lib/payment-calendar-out.ts` — pure builders `buildFixedRows`, `buildBigRows`, and shared `outStatus`. No I/O; unit-tested.
- **Create** `lib/payment-calendar-out.test.ts` — Vitest unit tests for the builders.
- **Create** `components/modules/payment-calendar/MarkPaidCell.tsx` — client "mark paid" button, parameterised by endpoint/payload.
- **Modify** `components/modules/payment-calendar/Timeline.tsx` — extend `CalRow` with `fixed?` / `big?`; add type badge; branch the OUT status cell by payload.
- **Modify** `app/(portal)/m/payment-calendar/page.tsx` — fetch fixed costs / overrides / big payments / receipts; build revenue run-rate; assemble the new OUT rows; tag existing rows.

No files touch IN (invoices), Rolling, the Expenses sheet, or PO logic beyond adding the row discriminator.

---

## Task 1: Pure builders — `outStatus` + `buildBigRows`

**Files:**
- Create: `02_services/mission-control/lib/payment-calendar-out.ts`
- Test: `02_services/mission-control/lib/payment-calendar-out.test.ts`

Start with big payments (simplest: one row per payment, no recurrence) plus the shared status helper.

- [ ] **Step 1: Write the failing test**

```ts
// lib/payment-calendar-out.test.ts
import { describe, it, expect } from 'vitest'
import { outStatus, buildBigRows } from './payment-calendar-out'
import type { RollingBigPayment } from './supabase'

const big = (over: Partial<RollingBigPayment>): RollingBigPayment => ({
  id: 'b1', name: 'Som deposit', amount: 15000, due_date: '2026-08-20',
  status: 'planned', note: null, created_at: '2026-08-01T00:00:00Z', ...over,
})

describe('outStatus', () => {
  it('past → overdue, same day → today, future → future', () => {
    expect(outStatus('2026-08-10', '2026-08-11')).toBe('overdue')
    expect(outStatus('2026-08-11', '2026-08-11')).toBe('today')
    expect(outStatus('2026-08-12', '2026-08-11')).toBe('future')
  })
})

describe('buildBigRows', () => {
  it('month view: shows big payments due in that month, paid ones marked paid', () => {
    const rows = buildBigRows(
      [big({ id: 'b1', due_date: '2026-08-20' }), big({ id: 'b2', due_date: '2026-09-01' }),
       big({ id: 'b3', due_date: '2026-08-05', status: 'paid' })],
      { view: 'month', month: '2026-08', today: '2026-08-11' },
    )
    expect(rows.map(r => r.big!.id).sort()).toEqual(['b1', 'b3'])
    expect(rows.find(r => r.big!.id === 'b3')!.status).toBe('paid')
    expect(rows.find(r => r.big!.id === 'b1')!.amount).toBe(15000)
    expect(rows.every(r => r.dir === 'out')).toBe(true)
  })

  it('open view: unpaid only, overdue pulled to today, capped at end of next month', () => {
    const rows = buildBigRows(
      [big({ id: 'overdue', due_date: '2026-08-03' }),      // overdue → today
       big({ id: 'soon', due_date: '2026-09-10' }),          // within next month
       big({ id: 'far', due_date: '2026-10-05' }),           // beyond horizon
       big({ id: 'done', due_date: '2026-08-15', status: 'paid' })], // paid → hidden
      { view: 'open', today: '2026-08-11' },
    )
    const byId = Object.fromEntries(rows.map(r => [r.big!.id, r]))
    expect(Object.keys(byId).sort()).toEqual(['overdue', 'soon'])
    expect(byId.overdue.date).toBe('2026-08-11')     // pulled to today
    expect(byId.overdue.status).toBe('today')
  })

  it('open view: skips big payments with no due_date', () => {
    const rows = buildBigRows([big({ id: 'nd', due_date: null })], { view: 'open', today: '2026-08-11' })
    expect(rows).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd 02_services/mission-control && npx vitest run lib/payment-calendar-out.test.ts`
Expected: FAIL — `Failed to resolve import './payment-calendar-out'` / functions not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/payment-calendar-out.ts
import type { RollingBigPayment } from './supabase'
import type { CalRow, Status } from '@/components/modules/payment-calendar/Timeline'

// ── Date helpers ('YYYY-MM' / 'YYYY-MM-DD', UTC-anchored) ────────────────────
function daysInMonth(period: string): number {
  const [y, m] = period.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
function addMonth(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
function endOfMonth(period: string): string {
  return `${period}-${String(daysInMonth(period)).padStart(2, '0')}`
}
const maxDate = (a: string, b: string) => (a > b ? a : b)

// Status of an OUT obligation by its date vs today (never 'paid' — caller decides that).
export function outStatus(date: string, today: string): Exclude<Status, 'paid'> {
  if (date < today) return 'overdue'
  if (date === today) return 'today'
  return 'future'
}

export type CalMode =
  | { view: 'open'; today: string }
  | { view: 'month'; month: string; today: string }

// Horizon end for the Open view: end of next month (current + next month).
function openHorizonEnd(today: string): string {
  return endOfMonth(addMonth(today.slice(0, 7), 1))
}

export function buildBigRows(bigPayments: RollingBigPayment[], mode: CalMode): CalRow[] {
  const out: CalRow[] = []
  for (const b of bigPayments) {
    if (!b.due_date) continue
    const paid = b.status === 'paid'
    if (mode.view === 'month') {
      if (b.due_date.slice(0, 7) !== mode.month) continue
      out.push(bigRow(b, b.due_date, paid ? 'paid' : outStatus(b.due_date, mode.today)))
    } else {
      if (paid) continue                                    // open shows outstanding only
      const date = maxDate(b.due_date, mode.today)          // overdue → today
      if (date > openHorizonEnd(mode.today)) continue       // beyond current+next month
      out.push(bigRow(b, date, outStatus(date, mode.today)))
    }
  }
  return out
}

function bigRow(b: RollingBigPayment, date: string, status: Status): CalRow {
  return {
    key: `big-${b.id}`, date, dir: 'out', who: b.name, label: b.name,
    href: null, amount: Number(b.amount ?? 0), status, net: 0,
    big: { id: b.id, paid: b.status === 'paid' },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd 02_services/mission-control && npx vitest run lib/payment-calendar-out.test.ts`
Expected: PASS (the `buildFixedRows` import does not exist yet — that test is added in Task 2, so only the `outStatus`/`buildBigRows` describes run here). If TypeScript complains about the `big` property on `CalRow`, temporarily add `big?: { id: string; paid: boolean }` to `CalRow` in `Timeline.tsx` now (Task 3 formalises it).

- [ ] **Step 5: Commit**

```bash
git add lib/payment-calendar-out.ts lib/payment-calendar-out.test.ts
git commit -m "feat(payment-calendar): buildBigRows + outStatus pure helpers"
```

---

## Task 2: Pure builder — `buildFixedRows`

**Files:**
- Modify: `02_services/mission-control/lib/payment-calendar-out.ts`
- Test: `02_services/mission-control/lib/payment-calendar-out.test.ts`

Recurring mandatory obligations. Month view = every obligation of the month; Open view = the next
upcoming occurrence of each obligation within current+next month, skipping a current month already
marked paid.

- [ ] **Step 1: Write the failing test** (append to the test file)

```ts
import { buildFixedRows } from './payment-calendar-out'
import type { FixedCost, MandatoryActual } from './supabase'

const fc = (over: Partial<FixedCost>): FixedCost => ({
  id: 'fc', category: 'Rent', amount_thb: 28000, active: true, notes: null,
  sort_order: 100, created_at: '', updated_at: '', percent_revenue: null,
  due_day: 15, match_category: null, ...over,
})
// Flat revenue run-rate: ฿220,000/month → Taxes 3.5% = ฿7,700.
const revenueOf = () => 220000

describe('buildFixedRows', () => {
  it('month view: one dated row per active obligation, %-rows use revenue', () => {
    const rows = buildFixedRows(
      [fc({ id: 'rent', category: 'Rent', amount_thb: 28000, due_day: 15 }),
       fc({ id: 'tax', category: 'Taxes', amount_thb: null, percent_revenue: 3.5, due_day: 11 }),
       fc({ id: 'off', active: false })],
      [], revenueOf, { view: 'month', month: '2026-08', today: '2026-08-11' },
    )
    const byId = Object.fromEntries(rows.map(r => [r.fixed!.fixedCostId, r]))
    expect(Object.keys(byId).sort()).toEqual(['rent', 'tax'])
    expect(byId.rent.date).toBe('2026-08-15')
    expect(byId.rent.amount).toBe(28000)
    expect(byId.tax.date).toBe('2026-08-11')
    expect(byId.tax.amount).toBeCloseTo(7700, 2)
    expect(byId.tax.status).toBe('today')      // due 11th, today 11th
  })

  it('month view: override amount wins and paid flag greens the row', () => {
    const ov: MandatoryActual = {
      fixed_cost_id: 'rent', period: '2026-08', paid: true,
      amount_thb: 30000, paid_at: '2026-08-14', note: null, updated_at: '',
    }
    const rows = buildFixedRows([fc({ id: 'rent', due_day: 15 })], [ov], revenueOf,
      { view: 'month', month: '2026-08', today: '2026-08-20' })
    expect(rows[0].amount).toBe(30000)
    expect(rows[0].status).toBe('paid')
    expect(rows[0].date).toBe('2026-08-14')     // paid → dated on paid_at
    expect(rows[0].fixed!.paid).toBe(true)
  })

  it('open view: due_day still ahead this month → current month occurrence', () => {
    const rows = buildFixedRows([fc({ id: 'rent', due_day: 15 })], [], revenueOf,
      { view: 'open', today: '2026-08-11' })
    expect(rows[0].date).toBe('2026-08-15')
  })

  it('open view: due_day already passed → rolls to next month', () => {
    const rows = buildFixedRows([fc({ id: 'sal', category: 'Salary', due_day: 3 })], [], revenueOf,
      { view: 'open', today: '2026-08-11' })
    expect(rows[0].date).toBe('2026-09-03')
  })

  it('open view: current month marked paid → shows next month occurrence', () => {
    const ov: MandatoryActual = {
      fixed_cost_id: 'rent', period: '2026-08', paid: true,
      amount_thb: null, paid_at: '2026-08-10', note: null, updated_at: '',
    }
    const rows = buildFixedRows([fc({ id: 'rent', due_day: 15 })], [ov], revenueOf,
      { view: 'open', today: '2026-08-11' })
    expect(rows[0].date).toBe('2026-09-15')
    expect(rows[0].status).toBe('future')
    expect(rows[0].fixed!.period).toBe('2026-09')
  })

  it('open view: obligations with no due_day are skipped', () => {
    const rows = buildFixedRows([fc({ id: 'x', due_day: null })], [], revenueOf,
      { view: 'open', today: '2026-08-11' })
    expect(rows).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd 02_services/mission-control && npx vitest run lib/payment-calendar-out.test.ts`
Expected: FAIL — `buildFixedRows is not a function`.

- [ ] **Step 3: Write minimal implementation** (append to `payment-calendar-out.ts`)

```ts
import type { FixedCost, MandatoryActual } from './supabase'

function clampDay(period: string, day: number): string {
  const d = Math.min(Math.max(day, 1), daysInMonth(period))
  return `${period}-${String(d).padStart(2, '0')}`
}

// Planned amount for an obligation in `period`: flat amount, or percent × revenue.
function plannedAmount(fc: FixedCost, period: string, revenueOf: (p: string) => number): number {
  return fc.percent_revenue != null
    ? (Number(fc.percent_revenue) / 100) * revenueOf(period)
    : Number(fc.amount_thb ?? 0)
}

export function buildFixedRows(
  fixedCosts: FixedCost[],
  overrides: MandatoryActual[],
  revenueOf: (period: string) => number,
  mode: CalMode,
): CalRow[] {
  const active = fixedCosts.filter(f => f.active && f.due_day != null)
  const ovByKey = new Map(overrides.map(o => [`${o.fixed_cost_id}::${o.period}`, o]))
  const out: CalRow[] = []

  for (const fc of active) {
    const day = fc.due_day as number
    if (mode.view === 'month') {
      const period = mode.month
      out.push(fixedRow(fc, period, day, ovByKey.get(`${fc.id}::${period}`), revenueOf, mode.today))
    } else {
      const cur = mode.today.slice(0, 7)
      const curDate = clampDay(cur, day)
      const curOv = ovByKey.get(`${fc.id}::${cur}`)
      // Current month occurrence still upcoming AND not paid → use it; else roll to next month.
      const useCurrent = curDate >= mode.today && !curOv?.paid
      const period = useCurrent ? cur : addMonth(cur, 1)
      out.push(fixedRow(fc, period, day, ovByKey.get(`${fc.id}::${period}`), revenueOf, mode.today))
    }
  }
  return out
}

function fixedRow(
  fc: FixedCost, period: string, day: number,
  ov: MandatoryActual | undefined,
  revenueOf: (p: string) => number, today: string,
): CalRow {
  const planned = plannedAmount(fc, period, revenueOf)
  const amount = ov && ov.amount_thb != null ? Number(ov.amount_thb) : planned
  const paid = !!ov?.paid
  const date = paid && ov?.paid_at ? ov.paid_at.slice(0, 10) : clampDay(period, day)
  const status: Status = paid ? 'paid' : outStatus(date, today)
  return {
    key: `fixed-${fc.id}-${period}`, date, dir: 'out', who: fc.category, label: fc.category,
    href: null, amount, status, net: 0,
    fixed: { fixedCostId: fc.id, period, paid },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd 02_services/mission-control && npx vitest run lib/payment-calendar-out.test.ts`
Expected: PASS (all `outStatus` / `buildBigRows` / `buildFixedRows` describes green).

- [ ] **Step 5: Commit**

```bash
git add lib/payment-calendar-out.ts lib/payment-calendar-out.test.ts
git commit -m "feat(payment-calendar): buildFixedRows with open-view next-occurrence logic"
```

---

## Task 3: Extend `CalRow` + type badge in Timeline

**Files:**
- Modify: `02_services/mission-control/components/modules/payment-calendar/Timeline.tsx`

- [ ] **Step 1: Add the optional payloads to `CalRow`**

In the `CalRow` type (around line 13-24), add after the `inv?` line:

```ts
  fixed?: { fixedCostId: string; period: string; paid: boolean }  // OUT: mandatory obligation
  big?:   { id: string; paid: boolean }                           // OUT: one-off big payment
```

- [ ] **Step 2: Add a type badge helper**

Add near the bottom of the file (beside `whenLabel`):

```tsx
function TypeBadge({ r }: { r: CalRow }) {
  const meta = r.dir === 'in' ? null
    : r.fixed ? { t: 'Постоянное', cls: 'bg-amber-gold/10 text-deep-black border-amber-gold/40' }
    : r.big   ? { t: 'Разовое',    cls: 'bg-wine-red/10 text-wine-red border-wine-red/40' }
    :           { t: 'Поставщик',  cls: 'bg-graphite/10 text-graphite border-graphite/30' }
  if (!meta) return null
  return <span className={`ml-2 inline-block px-1.5 py-0.5 text-[10px] rounded-sm border ${meta.cls}`}>{meta.t}</span>
}
```

Render it in the Counterparty cell — change `<td className="py-2 px-4 whitespace-nowrap">{r.who}</td>` to:

```tsx
<td className="py-2 px-4 whitespace-nowrap">{r.who}<TypeBadge r={r} /></td>
```

- [ ] **Step 3: Typecheck**

Run: `cd 02_services/mission-control && npx tsc --noEmit`
Expected: PASS (no errors from Timeline; page.tsx may still error because its rows don't set the new fields — that is fine, Task 5 fixes the page).

- [ ] **Step 4: Commit**

```bash
git add components/modules/payment-calendar/Timeline.tsx
git commit -m "feat(payment-calendar): CalRow fixed/big payloads + type badge"
```

---

## Task 4: `MarkPaidCell` + wire the OUT status cell

**Files:**
- Create: `02_services/mission-control/components/modules/payment-calendar/MarkPaidCell.tsx`
- Modify: `02_services/mission-control/components/modules/payment-calendar/Timeline.tsx`

- [ ] **Step 1: Create `MarkPaidCell`**

```tsx
// components/modules/payment-calendar/MarkPaidCell.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// A single "mark paid / un-mark" control for OUT rows that live outside purchase_orders
// (mandatory obligations, big one-offs). Parameterised by endpoint + payloads so the two
// kinds share one component. On success calls onSaved('paid'|null) so the Timeline runs
// its existing flash-and-exit (Open) or refresh (month) behaviour.
export function MarkPaidCell({ paid, endpoint, method, payloadPaid, payloadUnpaid, onSaved }: {
  paid: boolean
  endpoint: string
  method: 'POST' | 'PATCH'
  payloadPaid: Record<string, unknown>
  payloadUnpaid: Record<string, unknown>
  onSaved?: (value: string | null) => void
}) {
  const router = useRouter()
  const [isPaid, setPaid] = useState(paid)
  const [saving, setSaving] = useState(false)

  async function toggle(next: boolean) {
    setSaving(true)
    try {
      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next ? payloadPaid : payloadUnpaid),
      })
      if (res.ok) {
        setPaid(next)
        if (onSaved) onSaved(next ? 'paid' : null)
        else router.refresh()
      }
    } finally { setSaving(false) }
  }

  if (isPaid) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block px-2 py-0.5 text-[11px] rounded-sm border bg-emerald-600/10 text-emerald-700 border-emerald-600/40">оплачено</span>
        <button onClick={() => toggle(false)} disabled={saving}
                className="text-[11px] text-graphite hover:text-wine-red disabled:opacity-50" title="снять отметку">✕</button>
      </span>
    )
  }
  return (
    <button onClick={() => toggle(true)} disabled={saving}
            className="text-[11px] px-2 py-0.5 border border-pale-stone rounded-sm text-graphite hover:border-wine-red hover:text-wine-red disabled:opacity-50">
      {saving ? '…' : 'оплачено?'}
    </button>
  )
}
```

- [ ] **Step 2: Branch the OUT status cell by payload**

In `Timeline.tsx`, import at top:

```tsx
import { MarkPaidCell } from './MarkPaidCell'
```

Add a Bangkok-today helper near the other file-scope helpers:

```tsx
function bangkokToday(): string {
  const d = new Date(Date.now() + 7 * 3600_000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}
```

Replace the OUT branch of the status cell (currently `r.dir === 'out' ? <PaidAtCell…/> …`) with:

```tsx
{r.dir === 'out'
  ? r.fixed
    ? <MarkPaidCell
        paid={r.fixed.paid} endpoint="/api/m/mandatory-actual" method="POST"
        payloadPaid={{ fixed_cost_id: r.fixed.fixedCostId, period: r.fixed.period, paid: true, paid_at: bangkokToday() }}
        payloadUnpaid={{ fixed_cost_id: r.fixed.fixedCostId, period: r.fixed.period, paid: false, paid_at: null }}
        onSaved={v => handlePaid(r.key, v)} />
    : r.big
    ? <MarkPaidCell
        paid={r.big.paid} endpoint="/api/m/rolling/payment" method="PATCH"
        payloadPaid={{ id: r.big.id, status: 'paid' }}
        payloadUnpaid={{ id: r.big.id, status: 'planned' }}
        onSaved={v => handlePaid(r.key, v)} />
    : <div className="flex items-center gap-2">
        <PaidAtCell poId={r.po!.id} initial={r.po!.paid_at} onSaved={v => handlePaid(r.key, v)} />
        <DocsUrlCell poId={r.po!.id} initial={r.po!.docs_url} />
      </div>
  : <InvoiceStatus status={r.inv!.status} overdue={r.status === 'overdue'} detailUrl={r.inv!.detailUrl} />}
```

- [ ] **Step 3: Typecheck**

Run: `cd 02_services/mission-control && npx tsc --noEmit`
Expected: PASS for Timeline/MarkPaidCell (page.tsx still errors until Task 5).

- [ ] **Step 4: Commit**

```bash
git add components/modules/payment-calendar/MarkPaidCell.tsx components/modules/payment-calendar/Timeline.tsx
git commit -m "feat(payment-calendar): inline mark-paid for fixed/big OUT rows"
```

---

## Task 5: Assemble the new rows in the page

**Files:**
- Modify: `02_services/mission-control/app/(portal)/m/payment-calendar/page.tsx`

- [ ] **Step 1: Add imports**

At the top of the file add:

```tsx
import { sbInventory, sbPublic, type PurchaseOrder, type Supplier, type FlowInvoice, type FixedCost, type MandatoryActual, type RollingBigPayment } from '@/lib/supabase'
import { buildFixedRows, buildBigRows, type CalMode } from '@/lib/payment-calendar-out'
import { getReceiptHistory } from '@/lib/receipts-cache'
import { daysInMonth } from '@/lib/mandatory'
```

(Merge the `@/lib/supabase` import with the existing one — do not duplicate the line.)

- [ ] **Step 2: Fetch fixed costs, overrides, big payments, receipts**

After the existing supplier fetch block (`const { data: supRows } = …`), add:

```tsx
  // ── OUT: постоянные расходы (fixed_cost) + Big-разовые ──────────────────
  const curYM = today.slice(0, 7)
  const nextYM = (() => { const [y, m] = curYM.split('-').map(Number); const d = new Date(Date.UTC(y, m, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` })()
  const ovPeriods = month ? [month] : [curYM, nextYM]

  const [{ data: fcData }, { data: ovData }, { data: bigData }] = await Promise.all([
    sbInventory.from('fixed_cost').select('*'),
    sbInventory.from('mandatory_actual').select('*').in('period', ovPeriods),
    sbInventory.from('rolling_big_payment').select('*'),   // tolerate absence below
  ])
  const fixedCosts = (fcData ?? []) as FixedCost[]
  const overrides = (ovData ?? []) as MandatoryActual[]
  const bigPayments = (bigData ?? []) as RollingBigPayment[]

  // Revenue run-rate for %-obligations (Taxes 3.5%, Bonuses 1%): trailing-7d B2C avg × month length.
  let avgRetailPerDay = 0
  try {
    const receipts = await getReceiptHistory()
    const start = (() => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 6); return d.toISOString().slice(0, 10) })()
    let sum = 0
    for (const r of receipts) {
      const d = r.receipt_date.slice(0, 10)
      if (d < start || d > today || r.is_b2b) continue
      sum += (r.receipt_type === 'REFUND' ? -1 : 1) * Number(r.total)
    }
    avgRetailPerDay = Math.max(0, sum / 7)
  } catch { avgRetailPerDay = 0 }
  const revenueOf = (period: string) => avgRetailPerDay * daysInMonth(period)

  const calMode: CalMode = month ? { view: 'month', month, today } : { view: 'open', today }
  const outFixed = buildFixedRows(fixedCosts, overrides, revenueOf, calMode)
  const outBig = buildBigRows(bigPayments, calMode)
```

Note: `getReceiptHistory` / `rolling_big_payment` failures degrade gracefully (empty amount / no rows) — no crash, matching the Rolling page's tolerance.

- [ ] **Step 3: Add the rows to the timeline assembly**

The existing PO/invoice rows must be discriminated as PO. Where `outOpen`/`outPaid` push PO rows, they already carry `po:` so the Timeline treats them as PO — no change needed there. Update the `rows` assembly (the `if (month) { … } else { … }` block) to include the new rows:

Month branch — change to:

```tsx
    rows = [
      ...outOpen.filter(r => inMonth(r.date)),
      ...outPaid,
      ...outFixed,
      ...outBig,
      ...inOpen.filter(r => inMonth(r.date)),
    ]
```

Open branch — change to:

```tsx
    rows = [...outOpen, ...outFixed, ...outBig, ...inOpen]
```

The existing sort + running-NET loop and the KPI blocks consume `rows` unchanged, so the new OUT
rows fold into "К оплате (OUT)" and NET automatically.

- [ ] **Step 4: Typecheck + tests + build**

Run: `cd 02_services/mission-control && npx tsc --noEmit && npx vitest run lib/payment-calendar-out.test.ts && npm run build`
Expected: tsc clean, tests PASS, `next build` succeeds.

- [ ] **Step 5: Commit**

```bash
git add "app/(portal)/m/payment-calendar/page.tsx"
git commit -m "feat(payment-calendar): assemble fixed + big OUT rows into the timeline"
```

---

## Task 6: Manual verification + merge

**Files:** none (verification only)

- [ ] **Step 1: Run the dev server and check both views**

Run: `cd 02_services/mission-control && npm run dev` then open `http://localhost:3003/m/payment-calendar`.
Verify:
- **Open view:** Rent/Utilities/Salary Advance appear on Aug 15; Accounting + Taxes on Aug 11; Salary rolls to Sep 3; Som deposit (Big) appears pulled to today. No past-month rows. Each new row shows a `Постоянное`/`Разовое` badge. "К оплате (OUT)" and NET include them.
- **Month view (Авг 2026):** all seven obligations show on their due days; Taxes ≈ ฿7.7k.
- **Mark paid:** click "оплачено?" on Rent → row greens, shows "оплачено", and in Open view flashes then leaves the list; "К оплате" drops by ฿28k. Re-open the page → still paid (persisted to `mandatory_actual`). Click ✕ to un-mark → returns.
- **Big mark paid:** mark Som deposit paid → `rolling_big_payment.status` becomes 'paid', row leaves Open.

- [ ] **Step 2: Confirm no regression on PO / invoice rows**

Existing supplier PO rows still show `PaidAtCell` + docs; invoice IN rows unchanged (no badge, `InvoiceStatus` intact).

- [ ] **Step 3: Merge to main**

```bash
git checkout main
git merge --no-ff feat/payment-calendar-fixed-costs -m "feat(payment-calendar): full OUT — fixed costs + big one-offs with inline mark-paid"
git push origin main
```

Railway auto-deploys from `main`. No manual migration.

---

## Self-Review Notes

- **Spec coverage:** fixed rows (Task 2), big rows (Task 1), %-revenue run-rate (Task 5 Step 2), Open horizon = current+next month (Task 2 + `openHorizonEnd`), monthly view (Tasks 1-2), inline mark-paid via existing APIs (Task 4), type badge (Task 3), NET/KPI inclusion (Task 5 Step 3), no migration (confirmed). All covered.
- **Deviation:** discriminate by payload presence instead of a `kind` field (documented at top) — simpler, no meaningless discriminator on IN rows.
- **Type consistency:** `CalMode` shape identical across `buildFixedRows`/`buildBigRows`/page; `fixed`/`big` payload property names match between `payment-calendar-out.ts`, `Timeline.tsx`, and `MarkPaidCell` wiring; `mandatory_actual` POST payload (`fixed_cost_id`, `period`, `paid`, `paid_at`) matches the existing route; `rolling_big_payment` PATCH payload (`id`, `status`) matches its route.
