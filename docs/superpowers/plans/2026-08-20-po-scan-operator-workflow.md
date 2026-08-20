# PO Scan Operator Workflow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/m/purchase-orders` into the operator's review desk — each scan carries a `status` (draft → needs_corrections → approved) and a `loyverse_po` link/number field for the PO created by hand in Loyverse.

**Architecture:** Two new columns on `public.po_scans` (migration 038, applied manually). Status validation lives in a tiny pure helper (`lib/po/status.ts`, unit-tested with vitest). The existing `PATCH /api/m/purchase-orders` route gains `status` (enum-validated) and `loyverse_po` (text). Two self-contained client cells — `StatusCell` (badge + dropdown) and `LoyversePoCell` (inline text, link-aware) — follow the existing `NoteCell` pattern and patch independently of the ✎ full-row editor. The page adds a sortable Status column, a Loyverse PO column, a status filter, and a "Drafts" quick preset.

**Tech Stack:** Next.js (App Router, server components), React client cells, Supabase (PostgREST via `sbPublic`), Tailwind, vitest.

**Spec:** `docs/superpowers/specs/2026-08-20-po-scan-operator-workflow-design.md`

---

## File Structure

- **Create** `02_services/mission-control/supabase/migrations/038_po_scan_status.sql` — adds `status` + `loyverse_po`, backfills existing rows to `approved`. Applied manually in Supabase.
- **Create** `02_services/mission-control/lib/po/status.ts` — `PO_STATUSES`, `PoStatus` type, `isPoStatus()`. Single source of truth for the enum.
- **Create** `02_services/mission-control/lib/po/status.test.ts` — vitest unit tests for `isPoStatus`.
- **Create** `02_services/mission-control/components/modules/po/StatusCell.tsx` — badge + dropdown, PATCHes on change.
- **Create** `02_services/mission-control/components/modules/po/LoyversePoCell.tsx` — inline text editor, renders `http…` as a link.
- **Modify** `02_services/mission-control/lib/supabase.ts` — add `status` + `loyverse_po` to `PoScan`.
- **Modify** `02_services/mission-control/app/api/m/purchase-orders/route.ts` — accept `status` (validated) + `loyverse_po`.
- **Modify** `02_services/mission-control/components/modules/po/PoRow.tsx` — render both new cells in read + edit rows.
- **Modify** `02_services/mission-control/app/(portal)/m/purchase-orders/page.tsx` — Status column (sortable) + Loyverse PO column + status filter + Drafts preset + colSpan.

All commands below run from `02_services/mission-control/` unless noted.

---

## Task 1: Migration 038 (data model)

**Files:**
- Create: `02_services/mission-control/supabase/migrations/038_po_scan_status.sql`

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/038_po_scan_status.sql`:

```sql
-- 038_po_scan_status.sql
-- Operator review workflow for PO scans (see docs/superpowers/specs/
-- 2026-08-20-po-scan-operator-workflow-design.md).
--
--   status       draft → needs_corrections → approved (operator-driven).
--                Bot inserts omit status → DB default 'draft' (review queue).
--   loyverse_po  link OR number of the PO created by hand in Loyverse.
--
-- The Loyverse public REST API does not expose Purchase Orders, so the operator
-- creates the PO in Loyverse and records the link/number here — no automation.

-- Add columns first WITHOUT a status default so existing rows land as NULL and
-- can be backfilled, then attach the default for future bot inserts.
alter table public.po_scans add column if not exists status text;
alter table public.po_scans add column if not exists loyverse_po text;

-- Existing rows predate the review workflow; they are already processed. Marking
-- them 'approved' keeps the operator's draft queue clean (only new scans appear).
update public.po_scans set status = 'approved' where status is null;

alter table public.po_scans alter column status set default 'draft';
alter table public.po_scans alter column status set not null;

alter table public.po_scans drop constraint if exists po_scans_status_chk;
alter table public.po_scans
  add constraint po_scans_status_chk
  check (status in ('draft', 'needs_corrections', 'approved'));

create index if not exists po_scans_status_idx on public.po_scans (status);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/038_po_scan_status.sql
git commit -m "feat(po-scans): migration 038 — status + loyverse_po columns"
```

- [ ] **Step 3: Hand off for manual apply**

This project applies migrations by hand (service key = PostgREST, not DDL). Tell the user: "Apply `038_po_scan_status.sql` in the Supabase SQL Editor before the portal changes go live." Do NOT block later code tasks on it — they compile and deploy independently; only the running page needs the columns.

---

## Task 2: Status enum helper (pure, TDD)

**Files:**
- Create: `02_services/mission-control/lib/po/status.ts`
- Test: `02_services/mission-control/lib/po/status.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/po/status.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { PO_STATUSES, isPoStatus } from './status'

describe('isPoStatus', () => {
  it('accepts every valid status', () => {
    for (const s of PO_STATUSES) expect(isPoStatus(s)).toBe(true)
  })

  it('exposes exactly the three workflow statuses', () => {
    expect(PO_STATUSES).toEqual(['draft', 'needs_corrections', 'approved'])
  })

  it('rejects unknown / malformed values', () => {
    expect(isPoStatus('done')).toBe(false)
    expect(isPoStatus('Draft')).toBe(false)
    expect(isPoStatus('')).toBe(false)
    expect(isPoStatus(null)).toBe(false)
    expect(isPoStatus(undefined)).toBe(false)
    expect(isPoStatus(3)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- lib/po/status.test.ts`
Expected: FAIL — cannot resolve `./status`.

- [ ] **Step 3: Implement the helper**

Create `lib/po/status.ts`:

```ts
// Single source of truth for the PO-scan review workflow statuses.
// draft: bot default, unreviewed. needs_corrections: waiting on a corrected
// invoice from the supplier. approved: reviewed, PO created in Loyverse.
export const PO_STATUSES = ['draft', 'needs_corrections', 'approved'] as const

export type PoStatus = (typeof PO_STATUSES)[number]

export function isPoStatus(v: unknown): v is PoStatus {
  return typeof v === 'string' && (PO_STATUSES as readonly string[]).includes(v)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- lib/po/status.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/po/status.ts lib/po/status.test.ts
git commit -m "feat(po-scans): PoStatus enum helper + tests"
```

---

## Task 3: Extend the PoScan type

**Files:**
- Modify: `02_services/mission-control/lib/supabase.ts` (the `PoScan` type, ~lines 76-88)

- [ ] **Step 1: Add the two fields**

In `lib/supabase.ts`, inside `export type PoScan = { … }`, add `status` and `loyverse_po`. The result:

```ts
export type PoScan = {
  id: string
  supplier: string | null
  supplier_raw: string | null
  doc_number: string | null
  order_date: string | null       // 'YYYY-MM-DD'
  received_date: string | null    // 'YYYY-MM-DD'
  amount_total: number | null
  scan_path: string               // object path in the `po-scans` bucket
  note: string | null
  status: import('./po/status').PoStatus  // review workflow (migration 038)
  loyverse_po: string | null      // link/№ of the PO created in Loyverse
  uploaded_by: string | null
  created_at: string
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/supabase.ts
git commit -m "feat(po-scans): add status + loyverse_po to PoScan type"
```

---

## Task 4: Extend the PATCH route

**Files:**
- Modify: `02_services/mission-control/app/api/m/purchase-orders/route.ts`

- [ ] **Step 1: Add the import and the `loyverse_po` text field**

At the top of `route.ts`, add the helper import under the existing imports:

```ts
import { isPoStatus } from '@/lib/po/status'
```

Change the `TEXT_FIELDS` line to include `loyverse_po`:

```ts
const TEXT_FIELDS = ['supplier', 'doc_number', 'note', 'loyverse_po'] as const
```

- [ ] **Step 2: Add status validation**

Insert this block after the `amount_total` block (after line ~49, before the `if (Object.keys(patch).length === 0)` check):

```ts
  if ('status' in body) {
    if (!isPoStatus(body.status)) {
      return NextResponse.json({ error: 'status must be draft, needs_corrections, or approved' }, { status: 400 })
    }
    patch.status = body.status
  }
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: build succeeds (no type errors in the route). Note: `loyverse_po` empty string → `null` is already handled by the shared `TEXT_FIELDS` loop.

- [ ] **Step 4: Commit**

```bash
git add app/api/m/purchase-orders/route.ts
git commit -m "feat(po-scans): PATCH accepts status (enum-validated) + loyverse_po"
```

---

## Task 5: StatusCell component

**Files:**
- Create: `02_services/mission-control/components/modules/po/StatusCell.tsx`

- [ ] **Step 1: Create the component**

Create `components/modules/po/StatusCell.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PO_STATUSES, type PoStatus } from '@/lib/po/status'

const LABELS: Record<PoStatus, string> = {
  draft: 'Draft',
  needs_corrections: 'Need corrections',
  approved: 'Approved',
}

const BADGE: Record<PoStatus, string> = {
  draft: 'bg-neutral-100 text-neutral-600',
  needs_corrections: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
}

// Status badge + inline dropdown for a PO scan. Changing the dropdown PATCHes
// immediately (optimistic, rolls back on error) — no full-row edit needed, same
// independent-cell pattern as NoteCell.
export function StatusCell({ scanId, initial }: { scanId: string; initial: PoStatus }) {
  const router = useRouter()
  const [value, setValue] = useState<PoStatus>(initial)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function change(next: PoStatus) {
    const prev = value
    setValue(next); setSaving(true); setErr(null)
    try {
      const res = await fetch('/api/m/purchase-orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: scanId, status: next }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error || `HTTP ${res.status}`)
      }
      router.refresh()
    } catch (e: any) {
      setValue(prev)
      setErr(e?.message ?? 'save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${BADGE[value]}`}>
        {LABELS[value]}
      </span>
      <select
        value={value}
        disabled={saving}
        onChange={(e) => change(e.target.value as PoStatus)}
        aria-label="Change status"
        className="rounded border border-neutral-300 bg-white px-1 py-0.5 text-xs focus:border-blue-500 focus:outline-none disabled:opacity-50"
      >
        {PO_STATUSES.map((s) => (
          <option key={s} value={s}>{LABELS[s]}</option>
        ))}
      </select>
      {err && <span className="ml-1 text-xs text-red-600">{err}</span>}
    </span>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/modules/po/StatusCell.tsx
git commit -m "feat(po-scans): StatusCell badge + inline dropdown"
```

---

## Task 6: LoyversePoCell component

**Files:**
- Create: `02_services/mission-control/components/modules/po/LoyversePoCell.tsx`

- [ ] **Step 1: Create the component**

Create `components/modules/po/LoyversePoCell.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Inline editor for the link/number of the PO created in Loyverse from this scan.
// An http(s) value renders as a link; anything else as plain text. Click ✎ to
// edit, Enter/✓ to save, Escape/✕ to cancel. Same pattern as NoteCell.
export function LoyversePoCell({ scanId, initial }: { scanId: string; initial: string | null }) {
  const router = useRouter()
  const [value, setValue] = useState(initial ?? '')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    const loyverse_po = value.trim() === '' ? null : value.trim()
    setSaving(true); setErr(null)
    try {
      const res = await fetch('/api/m/purchase-orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: scanId, loyverse_po }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error || `HTTP ${res.status}`)
      }
      setEditing(false)
      router.refresh()
    } catch (e: any) {
      setErr(e?.message ?? 'save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    const isLink = !!initial && /^https?:\/\//i.test(initial)
    return (
      <span className="inline-flex items-center gap-1">
        {isLink ? (
          <a href={initial!} target="_blank" rel="noreferrer" className="text-blue-600 underline">PO ↗</a>
        ) : (
          <span className={initial ? 'text-neutral-700' : 'text-neutral-400 italic'}>{initial || 'add…'}</span>
        )}
        <button
          onClick={() => setEditing(true)}
          title="Edit Loyverse PO"
          className="text-neutral-400 hover:text-blue-600"
        >
          ✎
        </button>
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="text"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') { setEditing(false); setValue(initial ?? ''); setErr(null) }
        }}
        placeholder="Loyverse PO link or №…"
        disabled={saving}
        className="w-48 rounded border border-neutral-300 px-1.5 py-0.5 text-sm focus:border-blue-500 focus:outline-none"
      />
      <button
        onClick={save}
        disabled={saving}
        className="rounded bg-neutral-900 px-1.5 py-0.5 text-xs text-white disabled:opacity-50"
      >
        {saving ? '…' : '✓'}
      </button>
      <button
        onClick={() => { setEditing(false); setValue(initial ?? ''); setErr(null) }}
        disabled={saving}
        className="text-xs text-neutral-500 hover:text-blue-600"
      >
        ✕
      </button>
      {err && <span className="ml-1 text-xs text-red-600">{err}</span>}
    </span>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/modules/po/LoyversePoCell.tsx
git commit -m "feat(po-scans): LoyversePoCell inline link/number editor"
```

---

## Task 7: Wire both cells into PoRow

**Files:**
- Modify: `02_services/mission-control/components/modules/po/PoRow.tsx`

The row must render, in this exact column order (matching the page header built in Task 8): **Status, Supplier, №, Order date, Total, Scan, Note, Loyverse PO, ✎**. Status and Loyverse PO are live in both read and edit modes (independent cells, like Note).

- [ ] **Step 1: Add imports**

Under the existing `import { NoteCell } from './NoteCell'` (line 6), add:

```tsx
import { StatusCell } from './StatusCell'
import { LoyversePoCell } from './LoyversePoCell'
```

- [ ] **Step 2: Update the read-only row**

Replace the read-only `<tr>` block (currently lines 81-99, the `if (!editing)` return) with:

```tsx
    return (
      <tr className="border-b border-neutral-100">
        <td className="py-2 pr-4"><StatusCell scanId={row.id} initial={row.status} /></td>
        <td className="py-2 pr-4 font-medium">{row.supplier ?? '—'}</td>
        <td className="py-2 pr-4">{row.doc_number ?? '—'}</td>
        <td className="py-2 pr-4">{fmtD(row.order_date)}</td>
        <td className="py-2 pr-4 text-right">{fmtAmount(row.amount_total)}</td>
        <td className="py-2 pr-4">{scanCell}</td>
        <td className="py-2 pr-4"><NoteCell scanId={row.id} initial={row.note} /></td>
        <td className="py-2 pr-4"><LoyversePoCell scanId={row.id} initial={row.loyverse_po} /></td>
        <td className="py-2 pr-4">
          <button
            onClick={() => setEditing(true)}
            title="Edit row"
            className="text-neutral-400 hover:text-blue-600"
          >
            ✎
          </button>
        </td>
      </tr>
    )
```

- [ ] **Step 3: Update the edit row**

In the editing `<tr>` (currently lines 102-130), add a Status `<td>` as the FIRST cell (right after `<tr …>`), and a Loyverse PO `<td>` immediately after the existing Note `<td>` (`<td className="py-2 pr-4"><NoteCell … /></td>`, line 117). The Status cell:

```tsx
      <td className="py-2 pr-4"><StatusCell scanId={row.id} initial={row.status} /></td>
```

The Loyverse PO cell (insert directly below the Note `<td>`):

```tsx
      <td className="py-2 pr-4"><LoyversePoCell scanId={row.id} initial={row.loyverse_po} /></td>
```

The editing row now has 9 `<td>`s: Status, supplier input, doc input, date input, amount input, scan, Note, Loyverse PO, save/cancel actions.

- [ ] **Step 4: Verify it compiles**

Run: `npm run build`
Expected: build succeeds. If it complains that `row.status` / `row.loyverse_po` don't exist, Task 3 was skipped — do it first.

- [ ] **Step 5: Commit**

```bash
git add components/modules/po/PoRow.tsx
git commit -m "feat(po-scans): render StatusCell + LoyversePoCell in PoRow"
```

---

## Task 8: Page — Status column, Loyverse PO column, status filter, Drafts preset

**Files:**
- Modify: `02_services/mission-control/app/(portal)/m/purchase-orders/page.tsx`

- [ ] **Step 1: Add the import**

Under the existing imports at the top, add:

```tsx
import { isPoStatus } from '@/lib/po/status'
```

- [ ] **Step 2: Add `status` to SearchParams and make Status sortable**

Change the `SearchParams` type (line 9) to:

```tsx
type SearchParams = { q?: string; month?: string; sort?: string; dir?: string; status?: string }
```

Add a `status` entry as the FIRST key of `SORTS` (line 18-23 object):

```tsx
const SORTS: Record<string, (r: PoScan) => string | number | null> = {
  status: (r) => r.status,
  supplier: (r) => r.supplier?.toLowerCase() ?? null,
  doc_number: (r) => r.doc_number ?? null,
  order_date: (r) => r.order_date ?? null,
  amount_total: (r) => r.amount_total,
}
```

Add Status as the FIRST entry of `COLUMNS` (line 25-30):

```tsx
const COLUMNS: { key: string; label: string; align?: 'right' }[] = [
  { key: 'status', label: 'Status' },
  { key: 'supplier', label: 'Supplier' },
  { key: 'doc_number', label: '№' },
  { key: 'order_date', label: 'Order date' },
  { key: 'amount_total', label: 'Total', align: 'right' },
]
```

- [ ] **Step 3: Parse + apply the status filter**

After the `const sortOk = sort in SORTS` line (line 67), add:

```tsx
  const statusRaw = (sp.status ?? '').trim()
  const statusOk = isPoStatus(statusRaw)
```

After the month filter block that ends at line 87 (`query = query.gte(...).lt(...)` inside `if (monthOk)`), add:

```tsx
  if (statusOk) query = query.eq('status', statusRaw)
```

- [ ] **Step 4: Preserve status in sort links and Reset**

In `sortHref` (lines 123-130), after `if (monthOk) p.set('month', month)` add:

```tsx
    if (statusOk) p.set('status', statusRaw)
```

Change the Reset visibility condition (line 167) from `(q || monthOk || sortOk)` to:

```tsx
        {(q || monthOk || sortOk || statusOk) && (
```

- [ ] **Step 5: Add the status filter control + Drafts preset to the form**

Inside the `<form method="get" …>` (lines 144-172), add a Status `<select>` right after the Month `<label>` block (after line 163, before the Apply button):

```tsx
        <label className="flex flex-col text-xs text-neutral-500">
          Status
          <select
            name="status"
            defaultValue={statusOk ? statusRaw : ''}
            className="mt-1 rounded border border-neutral-300 px-2 py-1 text-sm"
          >
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="needs_corrections">Need corrections</option>
            <option value="approved">Approved</option>
          </select>
        </label>
```

Then add a "Drafts" quick preset link right after the Apply `<button>` (after line 166):

```tsx
        <a
          href="/m/purchase-orders?status=draft"
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:border-blue-500"
        >
          Drafts
        </a>
```

- [ ] **Step 6: Add the Loyverse PO header and fix colSpans**

In `<thead>`, after the `<th className="py-2 pr-4">Note</th>` (line 193), add:

```tsx
              <th className="py-2 pr-4">Loyverse PO</th>
```

The table now has 9 columns (5 sortable from COLUMNS + Scan + Note + Loyverse PO + the blank ✎ header). Update BOTH `colSpan={7}` occurrences to `colSpan={9}`:
- the empty-state cell (line 200)
- the month-group header cell (line 212)

- [ ] **Step 7: Verify it compiles and the tests pass**

Run: `npm run build`
Expected: build succeeds.

Run: `npm run test -- lib/po/status.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add "app/(portal)/m/purchase-orders/page.tsx"
git commit -m "feat(po-scans): Status column + Loyverse PO column + status filter + Drafts preset"
```

---

## Task 9: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full build + tests**

Run: `npm run build && npm run test`
Expected: build succeeds; all vitest tests pass (including `lib/po/status.test.ts`).

- [ ] **Step 2: Manual smoke checklist** (after migration 038 is applied in Supabase, on `npm run dev`, port 3003, `/m/purchase-orders`)

  - A newly bot-inserted scan shows a grey **Draft** badge; historical rows show green **Approved**.
  - Changing the Status dropdown to "Need corrections" turns the badge amber and persists across refresh; "Approved" turns it green.
  - The **Loyverse PO** cell: typing a number saves and shows the number; typing an `https://…` URL renders a clickable "PO ↗" link.
  - The **Status** filter (`All / Draft / Need corrections / Approved`) narrows the list and composes with Search + Month; **Reset** clears it.
  - The **Drafts** button jumps straight to the draft-only queue.
  - Clicking the **Status** column header sorts by status; the ✎ full-row editor still saves supplier/№/date/total without disturbing Status or Loyverse PO.
  - Empty state and month-group separators span the full table width (no misaligned columns).

- [ ] **Step 3: Confirm migration handoff**

Verify the user has applied `038_po_scan_status.sql` in Supabase (the page throws a `SchemaError` on the missing column until then). If not yet applied, remind them — it is the one manual step.

---

## Self-review notes

- **Spec coverage:** status column + backfill (Task 1), no-bot-change (documented in Task 1 SQL comment; nothing to build), status badge/switcher (Tasks 5, 7), Loyverse PO field with link rendering (Tasks 6, 7), status filter + Drafts preset (Task 8), API whitelist extension with enum validation (Tasks 2, 4), type + registry (Task 3; registry `status:'building'→'live'` flip is optional/cosmetic and intentionally omitted). All covered.
- **Type consistency:** `PoStatus` / `PO_STATUSES` / `isPoStatus` from `lib/po/status.ts` are used identically in the type (Task 3), route (Task 4), StatusCell (Task 5), and page SORTS/filter (Task 8). `loyverse_po` is the column name throughout (DB, type, route TEXT_FIELDS, both cells, page).
- **Column-count invariant:** header = 9 columns (Task 8); PoRow = 9 `<td>`s in read and edit (Task 7); colSpans = 9 (Task 8). Order matches: Status, Supplier, №, Order date, Total, Scan, Note, Loyverse PO, ✎.
