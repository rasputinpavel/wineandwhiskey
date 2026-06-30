# Cigar Empire — retail-minus consignment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second consignment settlement mode (`retail_minus`) so Cigar Empire's cigars settle as `list_price × (1 − discount) × 1.07` per sold unit, alongside Harvest's existing `cost_plus` mode, and seed the supplier.

**Architecture:** A per-supplier `settlement_mode` selects the math. The per-unit pre-VAT cost is computed by one pure helper (`lib/consignment-math.ts`), consumed by the settlement engine (`lib/consignment-settlement.ts`); the existing global ×1.07 VAT step is untouched. For `retail_minus`, the base price is the supplier's list/shelf price stored in the existing `consignment_price.price_retail` column. The price editor becomes mode-aware. Harvest's `cost_plus` path is byte-for-byte unchanged.

**Tech Stack:** Next.js (App Router, server components) + TypeScript, Supabase (PostgREST, `inventory` schema), Tailwind. New: vitest for the pure money-math unit test.

**Spec:** `docs/superpowers/specs/2026-06-30-cigar-empire-retail-minus-consignment-design.md`

**Working directory for all paths below:** `02_services/mission-control/`

---

## File Structure

- **Create** `lib/consignment-math.ts` — pure per-unit cost helper (no I/O), the testable home of the mode math.
- **Create** `lib/consignment-math.test.ts` — vitest unit tests for the helper.
- **Create** `vitest.config.ts` — minimal vitest config (node env, `lib/**/*.test.ts`).
- **Create** `supabase/migrations/030_consignment_retail_minus.sql` — schema columns + seed Cigar Empire (user applies manually).
- **Create** `../../07_contacts/partners/cigar-empire/profile.md` — partner profile.
- **Modify** `package.json` — add `test` script + `vitest` devDependency.
- **Modify** `lib/supabase.ts` — extend `Supplier` and `ConsignmentPrice` types.
- **Modify** `lib/consignment-settlement.ts` — read mode/discount/price_retail, compute per-unit cost via the helper.
- **Modify** `app/api/m/consignment-prices/route.ts` — POST allows a row with only `price_retail` (no HC).
- **Modify** `app/(portal)/m/suppliers/[id]/consignment/page.tsx` — mode-aware columns/labels + derived payable.
- **Modify** `components/modules/suppliers/ConsignmentPriceCells.tsx` — mode-aware `NewPriceRow`.

---

## Task 1: Pure money-math helper (TDD)

**Files:**
- Create: `lib/consignment-math.ts`
- Create: `lib/consignment-math.test.ts`
- Create: `vitest.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Add vitest devDependency and test script**

In `package.json`, add `"test": "vitest run"` to the `scripts` object (place it after `"lint"`), and add `"vitest": "^2.1.8"` to `devDependencies`. Resulting `scripts` section:

```json
  "scripts": {
    "sync-brand-assets": "node scripts/sync-brand-assets.mjs",
    "predev": "npm run sync-brand-assets",
    "prebuild": "npm run sync-brand-assets",
    "dev": "next dev --port 3003",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run"
  },
```

- [ ] **Step 2: Install (monorepo root)**

This repo uses npm workspaces, so install from the repo root:

Run: `cd /Users/pavelrasputin/Desktop/Wine_Whiskey && npm install`
Expected: completes; `vitest` resolves for the mission-control workspace.

- [ ] **Step 3: Create the vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['lib/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 4: Write the failing test**

Create `lib/consignment-math.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { consignmentLineCost } from './consignment-math'

describe('consignmentLineCost', () => {
  it('cost_plus returns the HC unchanged', () => {
    expect(consignmentLineCost({ mode: 'cost_plus', basePrice: 100, discountPct: 0 })).toBe(100)
  })

  it('cost_plus ignores any discount', () => {
    expect(consignmentLineCost({ mode: 'cost_plus', basePrice: 100, discountPct: 30 })).toBe(100)
  })

  it('retail_minus applies the discount to the list price (pre-VAT)', () => {
    // Lauk Daun: list 690, 30% off → 483 pre-VAT.
    expect(consignmentLineCost({ mode: 'retail_minus', basePrice: 690, discountPct: 30 })).toBeCloseTo(483, 6)
  })

  it('retail_minus with zero discount returns the list price', () => {
    expect(consignmentLineCost({ mode: 'retail_minus', basePrice: 690, discountPct: 0 })).toBe(690)
  })

  it('matches the Cigar Empire delivery note once the caller adds 7% VAT (516.81 incl VAT)', () => {
    const pre = consignmentLineCost({ mode: 'retail_minus', basePrice: 690, discountPct: 30 })!
    expect(pre * 1.07).toBeCloseTo(516.81, 2)
  })

  it('returns null when the base price is unset', () => {
    expect(consignmentLineCost({ mode: 'cost_plus', basePrice: null, discountPct: 0 })).toBeNull()
    expect(consignmentLineCost({ mode: 'retail_minus', basePrice: null, discountPct: 30 })).toBeNull()
  })
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `cd /Users/pavelrasputin/Desktop/Wine_Whiskey/02_services/mission-control && npm test`
Expected: FAIL — cannot resolve `./consignment-math` (module not created yet).

- [ ] **Step 6: Write the helper**

Create `lib/consignment-math.ts`:

```ts
// Pure per-unit consignment cost math — no I/O, unit-tested in consignment-math.test.ts.
//
// Two settlement modes:
//   cost_plus    (Harvest)      → we pay the wholesale cost HC per unit.
//   retail_minus (Cigar Empire) → the supplier price list IS the VAT-inclusive shelf
//                                  price P; we pay P less a discount. The 7% VAT
//                                  (×1.07) is applied by the caller at the settlement
//                                  total, so this returns the PRE-VAT per-unit cost.
//
// Returns the per-unit pre-VAT cost, or null when the base price is unset (SKU not
// priced yet → shows "n/a" in the report).

export type SettlementMode = 'cost_plus' | 'retail_minus'

export function consignmentLineCost(args: {
  mode: SettlementMode
  basePrice: number | null   // cost_plus: HC; retail_minus: list/shelf price P
  discountPct: number        // retail_minus discount, e.g. 30; ignored for cost_plus
}): number | null {
  const { mode, basePrice, discountPct } = args
  if (basePrice == null) return null
  if (mode === 'retail_minus') return basePrice * (1 - discountPct / 100)
  return basePrice
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd /Users/pavelrasputin/Desktop/Wine_Whiskey/02_services/mission-control && npm test`
Expected: PASS — 6 tests green.

- [ ] **Step 8: Commit**

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey
git add 02_services/mission-control/package.json 02_services/mission-control/package-lock.json package-lock.json 02_services/mission-control/vitest.config.ts 02_services/mission-control/lib/consignment-math.ts 02_services/mission-control/lib/consignment-math.test.ts
git commit -m "feat(consignment): pure per-unit cost helper + vitest (cost_plus | retail_minus)"
```

(If `package-lock.json` only changed at one level, add whichever exists; `git add -A` of those paths is fine.)

---

## Task 2: Migration 030 — schema + seed Cigar Empire

**Files:**
- Create: `supabase/migrations/030_consignment_retail_minus.sql`

> Migrations are applied manually by the user in the Supabase SQL Editor (no DB connection string in this environment). This task only writes the file.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/030_consignment_retail_minus.sql`:

```sql
-- 030_consignment_retail_minus.sql
-- Second consignment settlement mode + seed Cigar Empire (cigars).
--
--   cost_plus    (default, = Harvest): pay HC per sold unit, +7% VAT.
--   retail_minus (Cigar Empire):       supplier price list is the VAT-inclusive
--                                       shelf price P; pay P × (1 − discount) × 1.07.

alter table inventory.supplier
  add column if not exists settlement_mode text not null default 'cost_plus',
  add column if not exists consignment_discount_pct numeric not null default 0;

alter table inventory.supplier
  drop constraint if exists supplier_settlement_mode_chk;
alter table inventory.supplier
  add constraint supplier_settlement_mode_chk
  check (settlement_mode in ('cost_plus', 'retail_minus'));

-- Optional per-SKU discount override (null = use the supplier default).
alter table inventory.consignment_price
  add column if not exists discount_pct numeric null;

-- Seed Cigar Empire. Consignment suppliers are not auto-registered from POs, so
-- insert explicitly. The name must match the Loyverse supplier for future
-- settlement-PO matching.
insert into inventory.supplier
  (name, type, settlement_mode, consignment_discount_pct, monthly_cycle_start_day, notes)
values
  ('Cigar Empire Company Limited', 'consignment', 'retail_minus', 30, 5,
   'Cigars on consignment. Net price list = VAT-inclusive shelf price; pay P×0.70×1.07 per sold unit. 5th-to-5th cycle. Ibrahim Tuncel +66 92 865 3180, access@cigar-empire.com')
on conflict (name) do update
  set type                     = excluded.type,
      settlement_mode          = excluded.settlement_mode,
      consignment_discount_pct = excluded.consignment_discount_pct,
      monthly_cycle_start_day  = excluded.monthly_cycle_start_day;
```

- [ ] **Step 2: Commit**

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey
git add 02_services/mission-control/supabase/migrations/030_consignment_retail_minus.sql
git commit -m "feat(consignment): migration 030 — settlement_mode + seed Cigar Empire"
```

---

## Task 3: Extend Supabase types

**Files:**
- Modify: `lib/supabase.ts` (Supplier type ~lines 69-78; ConsignmentPrice type ~lines 230-239)

- [ ] **Step 1: Extend the `Supplier` type**

In `lib/supabase.ts`, change the `Supplier` type to add the two new fields:

```ts
export type Supplier = {
  id: string
  name: string
  type: SupplierType
  payment_terms_days: number
  monthly_cycle_start_day: number   // 1 = calendar month; e.g. Harvest = 5 (5th-to-5th)
  settlement_mode: 'cost_plus' | 'retail_minus'   // cost_plus = HC + VAT (Harvest); retail_minus = list price less discount, + VAT (Cigar Empire)
  consignment_discount_pct: number  // retail_minus discount %, e.g. 30; 0 for cost_plus
  notes: string | null
  created_at: string
  updated_at: string
}
```

- [ ] **Step 2: Extend the `ConsignmentPrice` type**

In `lib/supabase.ts`, change the `ConsignmentPrice` type to add the optional override:

```ts
export type ConsignmentPrice = {
  id: string
  supplier_id: string
  sku_id: string
  price_hc: number
  price_retail: number | null
  discount_pct: number | null   // retail_minus per-SKU override; null = supplier default
  notes: string | null
  created_at: string
  updated_at: string
}
```

- [ ] **Step 3: Typecheck**

Run: `cd /Users/pavelrasputin/Desktop/Wine_Whiskey/02_services/mission-control && npx tsc --noEmit`
Expected: PASS (no new errors). If pre-existing errors appear unrelated to these files, note them but proceed.

- [ ] **Step 4: Commit**

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey
git add 02_services/mission-control/lib/supabase.ts
git commit -m "feat(consignment): add settlement_mode/discount + per-SKU discount to types"
```

---

## Task 4: Wire the helper into the settlement engine

**Files:**
- Modify: `lib/consignment-settlement.ts`

- [ ] **Step 1: Update the file header comment**

Change the top comment block (lines 1-10) to describe both modes. Replace the first paragraph:

```ts
// Consignment settlement math — the SINGLE home for it.
//
// A consignment supplier is paid for the units SOLD in a billing cycle.
// Two modes (per supplier.settlement_mode), both +7% VAT, tastings free:
//   cost_plus    (Harvest)      Amount = sold × HC
//   retail_minus (Cigar Empire) Amount = sold × listPrice × (1 − discount)
// The per-unit math lives in lib/consignment-math.ts. The cycle window comes from
// lib/billing-cycle.ts (Harvest = 5th-to-5th). This function is the one source of
// truth, consumed by BOTH the supplier monthly report page and the Pulse break-even
// forecast, so the two can never drift.
```

- [ ] **Step 2: Add the helper import**

Below the existing imports (after line 13 `import { cyclePeriodRange } from '@/lib/billing-cycle'`), add:

```ts
import { consignmentLineCost } from '@/lib/consignment-math'
```

- [ ] **Step 3: Fetch mode/discount on the supplier query**

Change the supplier select (line 56) to fetch the new columns:

```ts
    sbInventory.from('supplier').select('id, name, type, monthly_cycle_start_day, settlement_mode, consignment_discount_pct').eq('id', supplierId).maybeSingle(),
```

- [ ] **Step 4: Fetch price_retail + discount on the prices query**

Change the prices select (line 57) to fetch the extra columns:

```ts
    sbInventory.from('consignment_price').select('sku_id, price_hc, price_retail, discount_pct, sku:sku(id, name, loyverse_product_code, category)').eq('supplier_id', supplierId).limit(2000),
```

- [ ] **Step 5: Widen the supplier shape + derive mode/discount**

Change the `s` cast (line 62) and the lines just after it (the `cycleStartDay` block) to also read mode and discount:

```ts
  const s = supRes.data as { id: string; name: string; type: string | null; monthly_cycle_start_day?: number; settlement_mode?: string; consignment_discount_pct?: number }
  // Billing-cycle start day (1 = calendar month; Harvest = 5 → 5th-to-5th).
  const cycleStartDay = Number(s.monthly_cycle_start_day ?? 1)
  const mode: 'cost_plus' | 'retail_minus' = s.settlement_mode === 'retail_minus' ? 'retail_minus' : 'cost_plus'
  const supplierDiscountPct = Number(s.consignment_discount_pct ?? 0)
  const { startIso, endExclIso, startDate, endExclDate, label } = cyclePeriodRange(period, cycleStartDay)
```

- [ ] **Step 6: Widen the PriceRow type**

Change the `PriceRow` type (line 67):

```ts
  type PriceRow = { sku_id: string; price_hc: number | null; price_retail: number | null; discount_pct: number | null; sku: SkuInfo | null }
```

- [ ] **Step 7: Carry the base prices on ReportSku**

Replace the `ReportSku` type and the two loops that build `reportSkus` (lines 92-95):

```ts
  // Unified SKU list: priced (with prices) first, then unpriced cell SKUs.
  type ReportSku = { sku_id: string; info: SkuInfo; priceHc: number | null; priceRetail: number | null; skuDiscount: number | null }
  const reportSkus: ReportSku[] = []
  for (const p of priceRows) if (p.sku) reportSkus.push({
    sku_id: p.sku_id, info: p.sku,
    priceHc: p.price_hc == null ? null : Number(p.price_hc),
    priceRetail: p.price_retail == null ? null : Number(p.price_retail),
    skuDiscount: p.discount_pct == null ? null : Number(p.discount_pct),
  })
  for (const sid of extraIds) { const info = extraInfo.get(sid); if (info) reportSkus.push({ sku_id: sid, info, priceHc: null, priceRetail: null, skuDiscount: null }) }
```

- [ ] **Step 8: Compute the per-unit cost via the helper**

In the row builder, replace the two lines (currently lines 180-181):

```ts
      const hc = rs.hc                                     // null = not priced yet (n/a)
      const amount = hc == null ? null : sold * hc         // tastings are free → excluded
```

with:

```ts
      // Per-unit PRE-VAT cost: cost_plus → HC; retail_minus → list × (1 − discount).
      // VAT (×1.07) is applied once on the subtotal below. `hc` carries this unit
      // cost for display; null = not priced yet (n/a).
      const basePrice = mode === 'retail_minus' ? rs.priceRetail : rs.priceHc
      const effDiscount = mode === 'retail_minus' ? (rs.skuDiscount ?? supplierDiscountPct) : 0
      const hc = consignmentLineCost({ mode, basePrice, discountPct: effDiscount })
      const amount = hc == null ? null : sold * hc         // tastings are free → excluded
```

- [ ] **Step 9: Typecheck**

Run: `cd /Users/pavelrasputin/Desktop/Wine_Whiskey/02_services/mission-control && npx tsc --noEmit`
Expected: PASS. (`rs.hc` no longer exists — confirm no remaining references to it report errors.)

- [ ] **Step 10: Re-run the math unit test (still green)**

Run: `cd /Users/pavelrasputin/Desktop/Wine_Whiskey/02_services/mission-control && npm test`
Expected: PASS — helper untouched, 6 tests green.

- [ ] **Step 11: Commit**

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey
git add 02_services/mission-control/lib/consignment-settlement.ts
git commit -m "feat(consignment): settlement engine branches cost_plus | retail_minus"
```

---

## Task 5: Allow a price row with only a list price (API)

**Files:**
- Modify: `app/api/m/consignment-prices/route.ts` (POST handler)

- [ ] **Step 1: Make price_hc optional, require hc-or-retail**

In the `POST` handler, replace the `price_hc` validation block and the `row` assembly:

```ts
  if (typeof price_hc !== 'number' || !Number.isFinite(price_hc) || price_hc < 0)
    return NextResponse.json({ error: 'price_hc (non-negative number) required' }, { status: 400 })

  const row: Record<string, unknown> = { supplier_id, sku_id, price_hc }
  if (price_retail !== undefined) row.price_retail = price_retail === null ? null : Number(price_retail)
  if (notes !== undefined)        row.notes        = notes === null ? null : String(notes)
```

with:

```ts
  const hasHc = price_hc !== undefined && price_hc !== null
  if (hasHc && (typeof price_hc !== 'number' || !Number.isFinite(price_hc) || price_hc < 0))
    return NextResponse.json({ error: 'price_hc must be a non-negative number' }, { status: 400 })
  const hasRetail = price_retail !== undefined && price_retail !== null
  if (hasRetail && (typeof price_retail !== 'number' || !Number.isFinite(price_retail) || price_retail < 0))
    return NextResponse.json({ error: 'price_retail must be a non-negative number' }, { status: 400 })
  if (!hasHc && !hasRetail)
    return NextResponse.json({ error: 'price_hc or price_retail required' }, { status: 400 })

  const row: Record<string, unknown> = { supplier_id, sku_id }
  if (hasHc)     row.price_hc     = price_hc
  if (hasRetail) row.price_retail = Number(price_retail)
  if (notes !== undefined) row.notes = notes === null ? null : String(notes)
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/pavelrasputin/Desktop/Wine_Whiskey/02_services/mission-control && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey
git add 02_services/mission-control/app/api/m/consignment-prices/route.ts
git commit -m "feat(consignment): POST price row accepts list-price-only (retail_minus)"
```

---

## Task 6: Mode-aware price editor

**Files:**
- Modify: `app/(portal)/m/suppliers/[id]/consignment/page.tsx`
- Modify: `components/modules/suppliers/ConsignmentPriceCells.tsx`

- [ ] **Step 1: Rewrite the consignment page (mode-aware)**

Replace the entire contents of `app/(portal)/m/suppliers/[id]/consignment/page.tsx` with:

```tsx
import Link from 'next/link'
import { sbInventory, type Supplier, type ConsignmentPrice, type Sku } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { PriceCell, DeletePriceCell, NewPriceRow } from '@/components/modules/suppliers/ConsignmentPriceCells'
import { consignmentLineCost } from '@/lib/consignment-math'

export const dynamic = 'force-dynamic'

export default async function SupplierConsignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [supRes, pricesRes] = await Promise.all([
    sbInventory.from('supplier').select('id, name, type, payment_terms_days, settlement_mode, consignment_discount_pct').eq('id', id).maybeSingle(),
    sbInventory.from('consignment_price').select('id, supplier_id, sku_id, price_hc, price_retail, discount_pct, notes, created_at, updated_at').eq('supplier_id', id).limit(2000),
  ])
  if (supRes.error) return <SchemaError error={supRes.error.message} />
  if (!supRes.data)   return <div className="text-graphite">Supplier not found.</div>
  if (pricesRes.error) return <SchemaError error={pricesRes.error.message} />

  const s = supRes.data as Supplier
  const prices = (pricesRes.data ?? []) as ConsignmentPrice[]
  const retailMinus = s.settlement_mode === 'retail_minus'
  const supplierDisc = Number(s.consignment_discount_pct ?? 0)

  const skuIds = [...new Set(prices.map(p => p.sku_id))]
  const skusRes = skuIds.length
    ? await sbInventory.from('sku').select('id, loyverse_product_code, name, category').in('id', skuIds)
    : { data: [] as Sku[], error: null }
  if (skusRes.error)   return <SchemaError error={skusRes.error.message} />

  const skus   = (skusRes.data ?? []) as Sku[]
  const skuById = new Map(skus.map(k => [k.id, k]))

  const enriched = prices.map(p => {
    const sku = skuById.get(p.sku_id)
    const disc = p.discount_pct ?? supplierDisc
    const listPrice = p.price_retail != null ? Number(p.price_retail) : null
    const payable = retailMinus
      ? (() => { const u = consignmentLineCost({ mode: 'retail_minus', basePrice: listPrice, discountPct: disc }); return u == null ? null : u * 1.07 })()
      : null
    return {
      ...p,
      sku_name:     sku?.name ?? '(unknown SKU)',
      sku_code:     sku?.loyverse_product_code ?? null,
      sku_category: sku?.category ?? null,
      payable,
    }
  }).sort((a, b) => a.sku_name.localeCompare(b.sku_name))

  return (
    <>
      <div className="mb-4">
        <Link href={`/m/suppliers/${id}`} className="text-xs text-graphite hover:text-wine-red">← Back to {s.name}</Link>
        <h2 className="font-heading text-2xl text-deep-black mt-3">{s.name} · Consignment prices</h2>
        {retailMinus ? (
          <p className="text-graphite text-sm mt-1 max-w-3xl">
            Per-SKU list price — the VAT-inclusive shelf price the customer pays. We settle each sold
            unit at list × (1 − {supplierDisc}%) + 7% VAT. <strong>Payable/unit</strong> is that
            amount (matches the supplier&apos;s delivery note). Edit list prices inline; ✕ removes a SKU.
          </p>
        ) : (
          <p className="text-graphite text-sm mt-1 max-w-3xl">
            Per-SKU prices the supplier charges us on consignment. Used by Finance Pulse to compute the
            running monthly debt: sum of sold units (Loyverse receipts in the SKU&apos;s category) × HC
            price + 7% VAT. Edit values inline; click ✕ to remove a SKU from the list.
          </p>
        )}
      </div>

      <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="text-graphite border-b border-pale-stone bg-cream/40">
            <tr>
              <th className="py-2 px-4 text-left font-normal">SKU</th>
              <th className="py-2 px-4 text-left font-normal">Code</th>
              <th className="py-2 px-4 text-left font-normal">Category</th>
              {retailMinus ? (
                <>
                  <th className="py-2 px-4 text-right font-normal">List price (฿)</th>
                  <th className="py-2 px-4 text-right font-normal">Payable/unit (฿)</th>
                </>
              ) : (
                <>
                  <th className="py-2 px-4 text-right font-normal">HC price (฿)</th>
                  <th className="py-2 px-4 text-right font-normal">Retail (฿)</th>
                </>
              )}
              <th className="py-2 px-4 text-right font-normal w-12"></th>
            </tr>
          </thead>
          <tbody>
            {enriched.map(p => (
              <tr key={p.id} className="border-b border-pale-stone/40 last:border-0 hover:bg-cream/40">
                <td className="py-2 px-4 truncate max-w-[20rem]" title={p.sku_name}>{p.sku_name}</td>
                <td className="py-2 px-4 font-mono text-xs text-graphite">{p.sku_code ?? '—'}</td>
                <td className="py-2 px-4 text-graphite text-xs">{p.sku_category ?? '—'}</td>
                {retailMinus ? (
                  <>
                    <td className="py-2 px-4 text-right">
                      <PriceCell id={p.id} initial={p.price_retail != null ? Number(p.price_retail) : null} field="price_retail" />
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums text-graphite">
                      {p.payable == null ? '—' : `฿${p.payable.toLocaleString('en-US', { maximumFractionDigits: 2 })}`}
                    </td>
                  </>
                ) : (
                  <>
                    <td className="py-2 px-4 text-right"><PriceCell id={p.id} initial={Number(p.price_hc)} field="price_hc" /></td>
                    <td className="py-2 px-4 text-right">
                      <PriceCell id={p.id} initial={p.price_retail != null ? Number(p.price_retail) : null} field="price_retail" />
                    </td>
                  </>
                )}
                <td className="py-2 px-4 text-right"><DeletePriceCell id={p.id} name={p.sku_name} /></td>
              </tr>
            ))}
            {enriched.length === 0 && (
              <tr><td colSpan={6} className="py-6 text-center text-graphite text-sm">
                No prices yet. Add the first one below.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <NewPriceRow supplierId={id} retailMinus={retailMinus} discountPct={supplierDisc} />
    </>
  )
}
```

- [ ] **Step 2: Make `NewPriceRow` mode-aware**

In `components/modules/suppliers/ConsignmentPriceCells.tsx`, replace the entire `NewPriceRow` function (lines 87-156) with:

```tsx
export function NewPriceRow({ supplierId, retailMinus = false, discountPct = 0 }: {
  supplierId: string
  retailMinus?: boolean
  discountPct?: number
}) {
  const router = useRouter()
  const [skuId, setSkuId] = useState('')
  const [skuName, setSkuName] = useState('')
  const [pickerKey, setPickerKey] = useState(0)
  const [priceHc, setPriceHc] = useState('')
  const [priceRetail, setPriceRetail] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function add() {
    if (!skuId) { setErr('pick SKU'); return }
    const payload: Record<string, unknown> = { supplier_id: supplierId, sku_id: skuId }
    if (retailMinus) {
      const r = Number(priceRetail)
      if (!Number.isFinite(r) || r < 0) { setErr('list price ≥ 0'); return }
      payload.price_retail = r
    } else {
      const hc = Number(priceHc)
      if (!Number.isFinite(hc) || hc < 0) { setErr('HC price ≥ 0'); return }
      payload.price_hc = hc
      const r = Number(priceRetail)
      if (priceRetail !== '' && Number.isFinite(r) && r >= 0) payload.price_retail = r
    }
    setSaving(true); setErr(null)
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error || `HTTP ${res.status}`)
      }
      setSkuId(''); setSkuName(''); setPriceHc(''); setPriceRetail('')
      setPickerKey(k => k + 1) // remount picker to clear its query input
      router.refresh()
    } catch (e: any) { setErr(e?.message ?? 'add failed') }
    finally { setSaving(false) }
  }

  const payablePreview = retailMinus && priceRetail !== '' && Number.isFinite(Number(priceRetail))
    ? Number(priceRetail) * (1 - discountPct / 100) * 1.07
    : null

  return (
    <div className="flex items-center gap-2 mt-4 p-3 bg-cream/40 border border-pale-stone rounded-sm flex-wrap">
      <div className="flex-1 min-w-[16rem]">
        <SkuPickerInline
          key={pickerKey}
          onPick={sku => { setSkuId(sku.id); setSkuName(sku.name); setErr(null) }}
        />
        {skuName && <p className="mt-1 text-[11px] text-graphite">Selected: <span className="text-deep-black">{skuName}</span></p>}
      </div>
      {!retailMinus && (
        <input
          type="number" min={0} step={1} placeholder="HC price"
          value={priceHc} onChange={e => setPriceHc(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add() }}
          className="w-24 px-2 py-1 text-xs border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red text-right tabular-nums"
          disabled={saving}
        />
      )}
      <input
        type="number" min={0} step={1} placeholder={retailMinus ? 'List price' : 'Retail (opt)'}
        value={priceRetail} onChange={e => setPriceRetail(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') add() }}
        className="w-24 px-2 py-1 text-xs border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red text-right tabular-nums"
        disabled={saving}
      />
      {payablePreview != null && (
        <span className="text-[11px] text-graphite tabular-nums">→ pay ฿{payablePreview.toLocaleString('en-US', { maximumFractionDigits: 2 })}/u</span>
      )}
      <button
        onClick={add} disabled={saving}
        className="text-xs px-3 py-1 bg-wine-red text-warm-white rounded-sm hover:bg-burgundy-deep disabled:opacity-50"
      >
        {saving ? 'Adding…' : '+ Add'}
      </button>
      {err && <span className="text-[10px] text-wine-red">{err}</span>}
    </div>
  )
}
```

- [ ] **Step 3: Typecheck + build**

Run: `cd /Users/pavelrasputin/Desktop/Wine_Whiskey/02_services/mission-control && npx tsc --noEmit && npm run build`
Expected: typecheck PASS; `next build` completes without errors in the consignment route.

- [ ] **Step 4: Commit**

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey
git add 02_services/mission-control/app/\(portal\)/m/suppliers/\[id\]/consignment/page.tsx 02_services/mission-control/components/modules/suppliers/ConsignmentPriceCells.tsx
git commit -m "feat(consignment): mode-aware price editor (list price + payable/unit)"
```

---

## Task 7: Partner profile

**Files:**
- Create: `../../07_contacts/partners/cigar-empire/profile.md` (i.e. repo-root `07_contacts/partners/cigar-empire/profile.md`)

- [ ] **Step 1: Write the profile**

Create `07_contacts/partners/cigar-empire/profile.md` (from the repo root):

```markdown
# Cigar Empire Company Limited

**Type:** Supplier — cigars, **consignment**
**Settlement:** `retail_minus` — pay `list × (1 − 30%) × 1.07` per sold unit
**Billing cycle:** monthly, 5th-to-5th (same as Harvest)
**Tax No.:** 0835566046251 (Head Office)
**Address:** 33 Hongyok Uthit Road, Mueang, Talat Yai, Phuket 83000
**Contact:** Ibrahim Tuncel · +66 92 865 3180 · access@cigar-empire.com · cigar-empire.com

## How settlement works

Their price list gives one number per cigar, `P` — the **VAT-inclusive shelf price**
the customer pays. We pay them 30% off, with 7% VAT on the discounted base:

> per sold unit = `P × 0.70 × 1.07`

Example (Lauk Daun, P = 690): customer pays 690; we pay `690 × 0.70 × 1.07 = 516.81`;
our margin ≈ 25.1%. The nominal discount is 30%, but because VAT lands on the cost
side after the discount, the realised margin against the shelf price is ~25%.

We only pay for units **sold** in the cycle, not for stock on hand. The delivery note
total is the value of consignment stock handed over (the opening balance), not a bill.

## First delivery (opening balance)

Temporary Delivery Note **TDN-20260600009**, 29/06/2026 — 6 SKUs × 5 units:

| Cigar | Code | List price ฿ | Payable/unit ฿ |
|-------|------|-------------|----------------|
| Lauk Daun | BR-LDE | 690 | 516.81 |
| My Lockdown | BR-MYLO | 560 | 419.44 |
| Airlangga Grand Corona | BR-ALGC | 480 | 359.52 |
| Joker Robusto | DNT-JRO | 490 | 367.01 |
| Joker Connecticut | DNT-JCNT | 490 | 367.01 |
| Ernesto S4 | TM-ERS4 | 400 | 299.60 |

Stock value handed over: net 10,885 + VAT 761.95 = **11,646.95**.

## In the portal

Mission Control → Suppliers → Cigar Empire Company Limited:
- **Consignment prices** — enter each cigar's list price (`P`); Payable/unit shown.
- **Deliveries** — log stock arrivals (this first batch = opening balance).
- **Monthly report** — 5th-to-5th settlement, auto-priced at `P × 0.70 × 1.07`.
```

- [ ] **Step 2: Commit**

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey
git add 07_contacts/partners/cigar-empire/profile.md
git commit -m "docs(partners): Cigar Empire consignment profile"
```

---

## Task 8: Final verification + push

**Files:** none (verification only)

- [ ] **Step 1: Full test + typecheck + build**

Run: `cd /Users/pavelrasputin/Desktop/Wine_Whiskey/02_services/mission-control && npm test && npx tsc --noEmit && npm run build`
Expected: tests PASS (6), typecheck clean, build succeeds.

- [ ] **Step 2: Push**

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey
git push origin main
```

Expected: pushed; Railway auto-deploys mission-control.

- [ ] **Step 3: User-owned follow-ups (report to user, do NOT do these)**

Tell the user to:
1. Apply `030_consignment_retail_minus.sql` in the Supabase SQL Editor.
2. Create the supplier in Loyverse named exactly **`Cigar Empire Company Limited`**.
3. In the portal → Suppliers → Cigar Empire → Consignment prices, enter the 6 list prices (690, 560, 480, 490, 490, 400).
4. Log the opening balance (6 SKUs × 5) on the Deliveries tab (or as opening stock in the monthly report).
5. Open the Monthly report and confirm the per-unit payable and totals match the delivery note.

---

## Self-Review

**Spec coverage:**
- ✅ `settlement_mode` cost_plus | retail_minus — Tasks 2 (column), 4 (engine), 3 (types).
- ✅ `retail_minus` math `list × (1 − disc) × 1.07` — Task 1 (helper, pre-VAT), engine applies global VAT (unchanged) in Task 4.
- ✅ Per-supplier discount default + per-SKU override — Task 2 (`consignment_discount_pct`, `discount_pct`), Task 4 (`rs.skuDiscount ?? supplierDiscountPct`).
- ✅ Reuse `price_retail` as the list/shelf price — Tasks 4, 5, 6.
- ✅ Seed Cigar Empire (type, mode, 30%, cycle 5) — Task 2.
- ✅ Mode-aware price editor (List price + Payable/unit, no derived separate customer price) — Task 6.
- ✅ Report works unchanged via engine; tastings stay free — Task 4 leaves the report page and tastings logic untouched.
- ✅ Partner profile — Task 7.
- ✅ Harvest cost_plus unchanged — default mode is cost_plus; factor 1; engine and helper both verified by the cost_plus tests.
- ✅ Out-of-scope honored: no Harvest changes, no PDF parser, no Loyverse writes, no POS-revenue settlement.

**Placeholder scan:** No TBD/TODO/"handle edge cases" left. Every code step shows the full code to write.

**Type consistency:** `consignmentLineCost({ mode, basePrice, discountPct })` signature is identical across helper (Task 1), engine (Task 4), and page (Task 6). `SettlementMode = 'cost_plus' | 'retail_minus'` matches the `settlement_mode` column check (Task 2) and the `Supplier.settlement_mode` type (Task 3). `NewPriceRow` prop names (`retailMinus`, `discountPct`) match between the page (Task 6 Step 1) and the component (Task 6 Step 2).
