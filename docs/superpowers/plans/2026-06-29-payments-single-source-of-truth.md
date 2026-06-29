# Payments — Single Source of Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Payment Calendar the only place to mark payments, turn the supplier card's PO view into a read-only reflection of calendar logic, and remove the redundant global Purchase Orders tab.

**Architecture:** Pure UI/navigation change in the Next.js portal. No DB/schema/scraper changes — all surfaces already read `public.purchase_orders` + `paid_at`. We edit two pages and one nav component, and delete one page.

**Tech Stack:** Next.js (app router, server components), TypeScript, Tailwind, Supabase JS. No test framework — verification is `npm run build` (typecheck), `npm run lint`, and a manual visual check on `next dev`.

> All paths below are relative to `02_services/mission-control/`.

---

### Task 1: Supplier card — read-only Paid + Docs, calendar-aligned due dates

**Files:**
- Modify: `app/(portal)/m/suppliers/[id]/page.tsx`

Replace the editable `PaidAtCell` / `DocsUrlCell` in the per-supplier PO table
with read-only displays, and add calendar-style due-date + row highlighting
(`computeDueDate` + `daysBetween`, same helpers the calendar uses). Keep
`CashflowOverrideCell` editable. Add a one-line hint that payments are marked in
the Payment Calendar.

- [ ] **Step 1: Update imports**

In `app/(portal)/m/suppliers/[id]/page.tsx`, the current import block (lines 1-9) imports `PaidAtCell` and `DocsUrlCell`. Change the relevant lines so the file imports `CashflowOverrideCell` only (drop the two read-only-replaced cells) and pulls in `daysBetween` + `todayBkk`:

Remove these two lines:
```tsx
import { PaidAtCell } from '@/components/modules/purchases/PaidAtCell'
import { DocsUrlCell } from '@/components/modules/purchases/DocsUrlCell'
```

Change:
```tsx
import { computeDueDate } from '@/lib/kpi'
```
to:
```tsx
import { computeDueDate, daysBetween, todayBkk } from '@/lib/kpi'
```

- [ ] **Step 2: Compute `today` once in the component**

After the `openSum` aggregate line (currently line 71: `const openSum  = grand - paidSum`), add:
```tsx
  const today = todayBkk()
```

- [ ] **Step 3: Add the payments-marked-elsewhere hint**

Immediately after the closing `</nav>` of the sub-tabs block (currently line 117), insert:
```tsx
      <p className="text-graphite/80 text-xs mb-4">
        Оплаты отмечаются в{' '}
        <Link href="/m/payment-calendar" className="text-wine-red hover:underline">Payment Calendar</Link>
        {' '}— здесь статус показан только для справки.
      </p>
```
(`Link` is already imported at the top of the file.)

- [ ] **Step 4: Replace the table row body with the read-only version**

Replace the entire `{pos.map(p => { ... })}` block (currently lines 150-177) with:
```tsx
            {pos.map(p => {
              const dimmed = !includedInCashflow(p)
              const payable = s.type !== 'consignment' && includedInCashflow(p) && !!p.order_date
              const due = !p.paid_at && payable ? computeDueDate(p.order_date!, s.payment_terms_days ?? 0) : null
              const dDue = due ? daysBetween(due, today) : null
              const rowTone = p.paid_at != null
                ? 'bg-emerald-600/[0.07] border-l-2 border-l-emerald-600/50'
                : dDue != null && dDue < 0  ? 'bg-wine-red/[0.05] border-l-2 border-l-wine-red/60'
                : dDue != null && dDue === 0 ? 'bg-amber-gold/[0.10] border-l-2 border-l-amber-gold'
                : ''
              return (
                <tr key={p.id} className={`border-b border-pale-stone/40 last:border-0 hover:bg-cream/40 ${rowTone} ${dimmed ? 'opacity-70' : ''}`}>
                  <td className="py-2 px-4 font-mono">
                    {p.url
                      ? <a href={p.url} target="_blank" rel="noreferrer" className="text-wine-red hover:underline">{p.po_number}</a>
                      : p.po_number}
                  </td>
                  <td className="py-2 px-4 text-graphite text-xs">{fmtDate(p.order_date)}</td>
                  <td className="py-2 px-4 text-right tabular-nums">{p.total_thb ? `฿${fmt(p.total_thb)}` : '—'}</td>
                  <td className="py-2 px-4 text-graphite text-xs">{p.status ?? '—'}</td>
                  <td className="py-2 px-4"><CashflowOverrideCell poId={p.id} initial={p.cashflow_override} /></td>
                  <td className="py-2 px-4 whitespace-nowrap text-xs">
                    {p.paid_at != null
                      ? <span className="text-emerald-700">{fmtDate(p.paid_at)}<span className="text-graphite/70"> · оплачено</span></span>
                      : due
                        ? <span>{fmtDate(due)}{' '}
                            <span className={dDue! < 0 ? 'text-wine-red' : dDue === 0 ? 'text-deep-black' : 'text-graphite/70'}>
                              {dDue! < 0 ? `· просрочено ${-dDue!} дн` : dDue === 0 ? '· сегодня' : `· через ${dDue} дн`}
                            </span>
                          </span>
                        : <span className="text-graphite/50">—</span>}
                  </td>
                  <td className="py-2 px-4">
                    {p.docs_url
                      ? <a href={p.docs_url} target="_blank" rel="noreferrer" className="text-wine-red hover:underline text-xs">docs ↗</a>
                      : <span className="text-graphite/50">—</span>}
                  </td>
                </tr>
              )
            })}
```
The 7-column header (PO / Date / Total / Status / Cashflow / Paid / Docs) and the empty-state `colSpan={7}` row below are unchanged.

- [ ] **Step 5: Typecheck + lint**

Run: `cd 02_services/mission-control && npm run build`
Expected: build succeeds; no TypeScript error about unused `PaidAtCell`/`DocsUrlCell` imports (they were removed) and no missing-import error for `daysBetween`/`todayBkk`.

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add app/(portal)/m/suppliers/[id]/page.tsx
git commit -m "feat(suppliers): supplier card PO view is read-only, mirrors calendar due dates

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Remove the global Purchase Orders tab from Suppliers nav

**Files:**
- Modify: `components/modules/suppliers/SuppliersNav.tsx`

- [ ] **Step 1: Replace the component**

Replace the full contents of `components/modules/suppliers/SuppliersNav.tsx` with:
```tsx
'use client'

import { usePathname } from 'next/navigation'
import { NavTabs, type NavTab } from '@/components/shell/NavTabs'

const TABS: NavTab[] = [
  { href: '/m/suppliers', label: 'List' },
]

export function SuppliersNav() {
  const pathname = usePathname() || ''
  // "List" stays active on the index and on any supplier drill-down (/m/suppliers/<id>...).
  const isActive = () => pathname === '/m/suppliers' || pathname.startsWith('/m/suppliers/')
  return <NavTabs tabs={TABS} isActive={isActive} />
}
```

- [ ] **Step 2: Typecheck**

Run: `cd 02_services/mission-control && npm run build`
Expected: build succeeds. (Build will still pass even though the deleted page is removed in Task 3 — the route file is independent; do Task 3 before merging so no orphan page remains.)

- [ ] **Step 3: Commit**

```bash
git add components/modules/suppliers/SuppliersNav.tsx
git commit -m "feat(suppliers): drop redundant Purchase Orders nav tab

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Delete the standalone Purchase Orders page

**Files:**
- Delete: `app/(portal)/m/suppliers/purchase-orders/page.tsx` (and its now-empty directory)

- [ ] **Step 1: Verify no inbound links remain**

Run: `cd 02_services/mission-control && grep -rn "suppliers/purchase-orders" app components lib`
Expected: only matches inside `app/(portal)/m/suppliers/purchase-orders/page.tsx` itself (self-links). If anything else appears, stop and fix that reference first. (The nav tab was already removed in Task 2.)

- [ ] **Step 2: Delete the page**

Run: `git rm app/(portal)/m/suppliers/purchase-orders/page.tsx`
Then remove the leftover empty directory if present: `rmdir app/(portal)/m/suppliers/purchase-orders 2>/dev/null || true`

- [ ] **Step 3: Typecheck + lint + dead-link sweep**

Run: `npm run build`
Expected: build succeeds, route `/m/suppliers/purchase-orders` no longer generated.

Run: `grep -rn "suppliers/purchase-orders" app components lib`
Expected: no matches.

- [ ] **Step 4: Manual visual check**

Run: `npm run dev` (port 3003) and verify:
- `/m/suppliers` shows only the "List" tab (no "Purchase Orders" tab).
- Open a supplier (e.g. VINESTOVINO) → PO table shows due-date/overdue/paid coloring; Paid and Docs are plain text/links (not editable); Cashflow dropdown still editable; the "Payment Calendar" hint link works.
- `/m/payment-calendar` still marks payments as before.
- Navigating to `/m/suppliers/purchase-orders` directly returns 404.

- [ ] **Step 5: Commit**

```bash
git add -A app/(portal)/m/suppliers
git commit -m "feat(suppliers): remove standalone Purchase Orders page

POs now live only inside each supplier card (read-only reflection) and in the
Payment Calendar (single source of truth for payments).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** §1 Payment Calendar unchanged → no task needed (verified in Task 3 Step 4). §2 supplier card read-only + calendar logic → Task 1. §3 remove global tab → Tasks 2+3. "What moves where" table → cashflow-override stays editable (Task 1 keeps `CashflowOverrideCell`); docs editing in calendar (already present, unchanged). All covered.
- **Placeholder scan:** none — every code step shows full code.
- **Type consistency:** uses existing exports `computeDueDate`, `daysBetween`, `todayBkk` from `lib/kpi` (verified present); `PurchaseOrder`/`Supplier` types and `fmt`/`fmtDate`/`includedInCashflow` already defined in the supplier page.
- **No tests:** portal has no test harness; verification is `npm run build` + `npm run lint` + manual visual — stated honestly per task instead of fabricated unit tests.
