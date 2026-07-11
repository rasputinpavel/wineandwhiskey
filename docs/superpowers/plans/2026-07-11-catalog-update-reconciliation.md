# Catalog Update / Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a supplier's updated price-list PDF is re-uploaded, compute a diff against their current catalog, let a human review it, then apply — instead of inserting duplicate `wine_items`.

**Architecture:** Reconciliation lives in mission-control's `lib/price` (pure diff module `reconcile.ts` + API routes), reading/writing the price-service Supabase via the existing `supabase` client. A new `catalog_updates` table stores each run's diff (`jsonb`) as both the review payload and the permanent changelog. Matched items are updated in place (preserving row id + Vivino enrichment); missing items are flagged `discontinued`, not deleted.

**Tech Stack:** Next.js (App Router) API routes + React client, Supabase (PostgREST), Vitest, TypeScript.

**Spec:** `docs/superpowers/specs/2026-07-11-catalog-update-reconciliation-design.md`

---

## File Structure

**Create:**
- `02_services/price-service/supabase/010_catalog_updates.sql` — schema migration (applied manually in the price-service Supabase project `arbturzdpqvulsqwqpbd`).
- `02_services/mission-control/lib/price/reconcile.ts` — pure diff logic (normalization, match key, `computeDiff`). No I/O.
- `02_services/mission-control/lib/price/reconcile.test.ts` — Vitest unit tests.
- `02_services/mission-control/app/api/m/price/updates/[id]/route.ts` — GET one update (diff for review), DELETE = discard.
- `02_services/mission-control/app/api/m/price/updates/[id]/apply/route.ts` — POST apply with per-row decisions.
- `02_services/mission-control/app/(portal)/m/price/updates/[id]/page.tsx` — review screen (server) + `ReviewClient.tsx`.
- `02_services/mission-control/app/(portal)/m/price/updates/[id]/ReviewClient.tsx` — client component.

**Modify:**
- `02_services/mission-control/lib/price/supabase.ts` — extend `PriceList.status`, add fields to `WineItem`, add `CatalogUpdate` type.
- `02_services/mission-control/app/api/m/price/price-lists/route.ts` — after parse, if supplier already has active items, take the reconciliation branch.
- `02_services/mission-control/app/(portal)/m/price/price-lists/page.tsx` — show a "Review" badge/link for lists in `review` status.

**Test fixtures:**
- `02_services/mission-control/lib/price/__fixtures__/harvest-old.json`, `harvest-new.json` — golden fixture for the integration test.

All commands below assume CWD = `02_services/mission-control` unless a path says otherwise.

---

### Task 1: Database migration

**Files:**
- Create: `02_services/price-service/supabase/010_catalog_updates.sql`

- [ ] **Step 1: Write the migration SQL**

Create `02_services/price-service/supabase/010_catalog_updates.sql`:

```sql
-- Run this in the price-service Supabase SQL Editor (project arbturzdpqvulsqwqpbd).
-- Adds catalog reconciliation: wine_items lifecycle + a per-run diff record.

-- 1. wine_items lifecycle + reconciliation key
alter table wine_items
  add column if not exists status text not null default 'active'
    check (status in ('active','discontinued')),
  add column if not exists match_key text,
  add column if not exists discontinued_at timestamptz;

create index if not exists wine_items_supplier_matchkey_idx
  on wine_items(supplier_id, match_key) where status = 'active';

-- 2. price_lists gains a 'review' state (parsed, awaiting human diff approval)
alter table price_lists drop constraint if exists price_lists_status_check;
alter table price_lists add constraint price_lists_status_check
  check (status in ('pending','processing','review','done','error'));

-- 3. One row per reconciliation run: the diff, the review payload, the changelog
create table if not exists catalog_updates (
  id                 uuid default gen_random_uuid() primary key,
  supplier_id        uuid references suppliers(id) on delete set null,
  new_price_list_id  uuid references price_lists(id) on delete cascade,
  status             text not null default 'pending_review'
                       check (status in ('pending_review','applied','discarded')),
  diff               jsonb not null,
  created_at         timestamptz default now(),
  applied_at         timestamptz
);

-- Guard: at most one open review per supplier
create unique index if not exists catalog_updates_one_open_per_supplier
  on catalog_updates(supplier_id) where status = 'pending_review';
```

- [ ] **Step 2: Apply manually and verify**

Tell the user to paste the file into the price-service Supabase SQL Editor and run it. Verify with:

```sql
select column_name from information_schema.columns
where table_name = 'wine_items' and column_name in ('status','match_key','discontinued_at');
select 1 from information_schema.tables where table_name = 'catalog_updates';
```

Expected: 3 wine_items columns returned; `catalog_updates` exists.

- [ ] **Step 3: Commit**

```bash
git add 02_services/price-service/supabase/010_catalog_updates.sql
git commit -m "feat(price): migration 010 — catalog reconciliation schema"
```

---

### Task 2: Extend domain types

**Files:**
- Modify: `02_services/mission-control/lib/price/supabase.ts`

- [ ] **Step 1: Update `PriceList.status` and `WineItem`, add `CatalogUpdate`**

In `lib/price/supabase.ts`, change the `PriceList` status union:

```typescript
  status: 'pending' | 'processing' | 'review' | 'done' | 'error'
```

Add to the `WineItem` type (after `supplier_sku`):

```typescript
  status: 'active' | 'discontinued'
  match_key: string | null
  discontinued_at: string | null
```

Append a new type at the end of the file:

```typescript
export type CatalogUpdate = {
  id: string
  supplier_id: string | null
  new_price_list_id: string | null
  status: 'pending_review' | 'applied' | 'discarded'
  diff: import('./reconcile').CatalogDiff
  created_at: string
  applied_at: string | null
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from this file (there will be an unresolved `./reconcile` import — that resolves in Task 3; if tsc is run before Task 3 it will error on the import only).

- [ ] **Step 3: Commit**

```bash
git add lib/price/supabase.ts
git commit -m "feat(price): add reconciliation fields to WineItem/PriceList + CatalogUpdate type"
```

---

### Task 3: Normalization + match key (TDD)

**Files:**
- Create: `02_services/mission-control/lib/price/reconcile.ts`
- Create: `02_services/mission-control/lib/price/reconcile.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/price/reconcile.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { normalizeName, canonicalVolume, matchKey } from './reconcile'

describe('normalizeName', () => {
  it('lowercases, strips punctuation & diacritics, collapses spaces', () => {
    expect(normalizeName('Château  Tamagne, Réserve!')).toBe('chateau tamagne reserve')
  })
  it('drops 4-digit vintage year tokens', () => {
    expect(normalizeName('Cabernet Reserve 2016')).toBe('cabernet reserve')
    expect(normalizeName('Brut d’Or Riesling 2021')).toBe('brut dor riesling')
  })
})

describe('canonicalVolume', () => {
  it('canonicalizes ml / L notations to a bare number of ml', () => {
    expect(canonicalVolume('750ml')).toBe('750')
    expect(canonicalVolume('0.75 L')).toBe('750')
    expect(canonicalVolume('187 ml')).toBe('187')
  })
  it('returns "750" for null/empty (bottle default)', () => {
    expect(canonicalVolume(null)).toBe('750')
    expect(canonicalVolume('')).toBe('750')
  })
})

describe('matchKey', () => {
  it('joins normalized name and canonical volume, year-agnostic', () => {
    expect(matchKey('Cabernet Reserve 2016', '750ml')).toBe('cabernet reserve|750')
    expect(matchKey('Cabernet Reserve 2020', '0.75L')).toBe('cabernet reserve|750')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/price/reconcile.test.ts`
Expected: FAIL — cannot find module `./reconcile` / exports undefined.

- [ ] **Step 3: Write the implementation**

Create `lib/price/reconcile.ts`:

```typescript
// Pure catalog-reconciliation logic: compare a freshly parsed price list against
// a supplier's current active items and produce a reviewable diff. No I/O here.
import type { ExtractedItem } from './claude'
import type { WineItem } from './supabase'

export function normalizeName(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/\b\d{4}\b/g, ' ')                        // drop vintage year tokens
    .replace(/[^a-z0-9]+/g, ' ')                       // punctuation -> space
    .trim()
    .replace(/\s+/g, ' ')
}

export function canonicalVolume(volume: string | null | undefined): string {
  if (!volume) return '750'
  const v = volume.toLowerCase().replace(/\s+/g, '')
  const l = v.match(/^([\d.]+)l$/)                     // e.g. 0.75l
  if (l) return String(Math.round(parseFloat(l[1]) * 1000))
  const ml = v.match(/(\d+)ml/)                        // e.g. 750ml
  if (ml) return ml[1]
  const bare = v.match(/^(\d+)$/)
  return bare ? bare[1] : '750'
}

export function matchKey(name: string, volume: string | null | undefined): string {
  return `${normalizeName(name)}|${canonicalVolume(volume)}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/price/reconcile.test.ts`
Expected: PASS (all in the three describe blocks).

- [ ] **Step 5: Commit**

```bash
git add lib/price/reconcile.ts lib/price/reconcile.test.ts
git commit -m "feat(price): reconcile normalization + year-agnostic match key"
```

---

### Task 4: computeDiff (TDD — the core)

**Files:**
- Modify: `02_services/mission-control/lib/price/reconcile.ts`
- Modify: `02_services/mission-control/lib/price/reconcile.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `lib/price/reconcile.test.ts`:

```typescript
import { computeDiff } from './reconcile'
import type { WineItem } from './supabase'
import type { ExtractedItem } from './claude'

function active(partial: Partial<WineItem>): WineItem {
  return {
    id: partial.id ?? 'id-' + (partial.name ?? 'x'),
    price_list_id: 'pl-old', supplier_id: 's1', supplier_name: 'Harvest',
    name: partial.name ?? '', country: null, region: null, grape_variety: null,
    price: partial.price ?? null, year: partial.year ?? null,
    volume: partial.volume ?? '750ml', description: partial.description ?? null,
    image_url: null, vivino_rating: null, vivino_reviews_count: null, vivino_url: null,
    vivino_image_url: null, vivino_images: null, vivino_alcohol: null, vivino_body: null,
    vivino_flavors: null, vivino_food_pairings: null, vivino_region_hierarchy: null,
    vivino_style: null, vivino_year: null, vivino_enriched_at: null, winery: null,
    category: 'wine', wine_type: 'red', spirit_type: null, supplier_sku: null,
    status: partial.status ?? 'active', match_key: partial.match_key ?? null,
    discontinued_at: null, created_at: '2026-01-01',
  }
}
function parsed(partial: Partial<ExtractedItem>): ExtractedItem {
  return {
    name: partial.name ?? '', country: null, region: null, grape_variety: null,
    price: partial.price ?? null, year: partial.year ?? null,
    volume: partial.volume ?? '750ml', description: partial.description ?? null,
    category: 'wine', wine_type: 'red',
  }
}

describe('computeDiff', () => {
  it('flags an exact-match price change', () => {
    const existing = [active({ id: 'a', name: 'Cabernet Reserve', price: 300, volume: '750ml' })]
    const incoming = [parsed({ name: 'Cabernet Reserve 2020', price: 350, volume: '750ml' })]
    const d = computeDiff(existing, incoming)
    expect(d.changes).toHaveLength(1)
    expect(d.changes[0].kind).toBe('price_changed')
    expect(d.changes[0].existing_id).toBe('a')
    expect(d.changes[0].old_price).toBe(300)
    expect(d.changes[0].incoming.price).toBe(350)
  })

  it('flags a new item as added', () => {
    const d = computeDiff([], [parsed({ name: 'Nude Saperavi', price: 590 })])
    expect(d.changes.map(c => c.kind)).toEqual(['added'])
  })

  it('flags a missing item as discontinued', () => {
    const existing = [active({ id: 'a', name: 'Old Wine' })]
    const d = computeDiff(existing, [])
    expect(d.changes[0].kind).toBe('discontinued')
    expect(d.changes[0].existing_id).toBe('a')
  })

  it('reactivates a discontinued item that reappears', () => {
    const existing = [active({ id: 'a', name: 'Grape Dance', status: 'discontinued', price: 500 })]
    const incoming = [parsed({ name: 'Grape Dance', price: 550 })]
    const d = computeDiff(existing, incoming)
    expect(d.changes[0].kind).toBe('reactivated')
  })

  it('marks matched-but-identical as unchanged and attr-only as updated', () => {
    const existing = [
      active({ id: 'u', name: 'Same', price: 100, description: 'old note' }),
      active({ id: 'v', name: 'Identical', price: 200, description: 'x' }),
    ]
    const incoming = [
      parsed({ name: 'Same', price: 100, description: 'new note' }),
      parsed({ name: 'Identical', price: 200, description: 'x' }),
    ]
    const d = computeDiff(existing, incoming)
    const byId = Object.fromEntries(d.changes.map(c => [c.existing_id, c.kind]))
    expect(byId['u']).toBe('updated')
    expect(byId['v']).toBe('unchanged')
  })

  it('surfaces a fuzzy-only match as ambiguous, not added+discontinued', () => {
    const existing = [active({ id: 'a', name: 'Cabernet Sauvignon Reserve', price: 300 })]
    const incoming = [parsed({ name: 'Cabernet Sauvignon Reserve Collection', price: 320 })]
    const d = computeDiff(existing, incoming)
    expect(d.changes.map(c => c.kind)).toContain('ambiguous')
    expect(d.changes.some(c => c.kind === 'added')).toBe(false)
    expect(d.changes.some(c => c.kind === 'discontinued')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/price/reconcile.test.ts`
Expected: FAIL — `computeDiff` not exported.

- [ ] **Step 3: Write the implementation**

Append to `lib/price/reconcile.ts`:

```typescript
export type DiffKind =
  | 'added' | 'price_changed' | 'updated' | 'unchanged'
  | 'discontinued' | 'reactivated' | 'ambiguous'

export type DiffChange = {
  kind: DiffKind
  match_key: string
  existing_id: string | null        // null for 'added'
  existing_name: string | null
  old_price: number | null
  incoming: ExtractedItem | null     // null for 'discontinued'
  // ambiguous only: candidate existing items the user can bind to
  candidates?: { id: string; name: string; price: number | null }[]
  changed_fields?: string[]          // for 'updated'
}

export type CatalogDiff = {
  supplier_name: string | null
  changes: DiffChange[]
}

// Trigram similarity (Dice coefficient over 3-grams of the normalized name).
function trigrams(s: string): Set<string> {
  const p = `  ${s} `
  const g = new Set<string>()
  for (let i = 0; i < p.length - 2; i++) g.add(p.slice(i, i + 3))
  return g
}
export function similarity(a: string, b: string): number {
  const A = trigrams(a), B = trigrams(b)
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const g of A) if (B.has(g)) inter++
  return (2 * inter) / (A.size + B.size)
}
const FUZZY_THRESHOLD = 0.5

const ATTR_FIELDS: (keyof ExtractedItem)[] =
  ['description', 'grape_variety', 'region', 'country', 'year', 'wine_type', 'volume']

function attrDiff(existing: WineItem, incoming: ExtractedItem): string[] {
  const changed: string[] = []
  for (const f of ATTR_FIELDS) {
    const a = (existing as Record<string, unknown>)[f] ?? null
    const b = (incoming as Record<string, unknown>)[f] ?? null
    if (String(a) !== String(b)) changed.push(f)
  }
  return changed
}

export function computeDiff(existing: WineItem[], incoming: ExtractedItem[]): CatalogDiff {
  const changes: DiffChange[] = []
  const byKey = new Map<string, WineItem>()
  for (const e of existing) byKey.set(e.match_key ?? matchKey(e.name, e.volume), e)
  const matched = new Set<string>() // existing ids consumed

  const leftover: ExtractedItem[] = []
  for (const inc of incoming) {
    const key = matchKey(inc.name, inc.volume)
    const hit = byKey.get(key)
    if (hit && !matched.has(hit.id)) {
      matched.add(hit.id)
      if (hit.status === 'discontinued') {
        changes.push(mk('reactivated', key, hit, inc))
      } else if ((hit.price ?? null) !== (inc.price ?? null)) {
        changes.push(mk('price_changed', key, hit, inc))
      } else {
        const cf = attrDiff(hit, inc)
        changes.push(cf.length ? { ...mk('updated', key, hit, inc), changed_fields: cf }
                               : mk('unchanged', key, hit, inc))
      }
    } else {
      leftover.push(inc)
    }
  }

  const unmatchedExisting = existing.filter(e => !matched.has(e.id))

  // Try to fuzzy-bind each leftover incoming item to an unmatched existing one.
  const stillNew: ExtractedItem[] = []
  const boundExisting = new Set<string>()
  for (const inc of leftover) {
    const incNorm = normalizeName(inc.name)
    const cands = unmatchedExisting
      .filter(e => !boundExisting.has(e.id))
      .map(e => ({ e, score: similarity(incNorm, normalizeName(e.name)) }))
      .filter(x => x.score >= FUZZY_THRESHOLD)
      .sort((a, b) => b.score - a.score)
    if (cands.length > 0) {
      cands.forEach(c => boundExisting.add(c.e.id))
      changes.push({
        kind: 'ambiguous', match_key: matchKey(inc.name, inc.volume),
        existing_id: null, existing_name: null, old_price: null, incoming: inc,
        candidates: cands.map(c => ({ id: c.e.id, name: c.e.name, price: c.e.price })),
      })
    } else {
      stillNew.push(inc)
    }
  }

  for (const inc of stillNew) changes.push(mk('added', matchKey(inc.name, inc.volume), null, inc))
  for (const e of unmatchedExisting) {
    if (boundExisting.has(e.id)) continue // reserved for an ambiguous decision
    if (e.status === 'discontinued') continue // already gone, no change
    changes.push(mk('discontinued', e.match_key ?? matchKey(e.name, e.volume), e, null))
  }

  return { supplier_name: existing[0]?.supplier_name ?? incoming[0]?.name ?? null, changes }
}

function mk(kind: DiffKind, key: string, e: WineItem | null, inc: ExtractedItem | null): DiffChange {
  return {
    kind, match_key: key,
    existing_id: e?.id ?? null, existing_name: e?.name ?? null,
    old_price: e?.price ?? null, incoming: inc,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/price/reconcile.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add lib/price/reconcile.ts lib/price/reconcile.test.ts
git commit -m "feat(price): computeDiff — added/price/updated/discontinued/reactivated/ambiguous"
```

---

### Task 5: Route parse to reconciliation when supplier has items

**Files:**
- Modify: `02_services/mission-control/app/api/m/price/price-lists/route.ts`

- [ ] **Step 1: Add the reconciliation branch in `runExtraction`**

In `runExtraction`, after the supplier is resolved (`supplierId` known) and before the current "insert wine_items" block, insert this branch. Replace the section from the `await supabase.from('price_lists').update({ supplier_id: ... })` call through the insert loop with:

```typescript
    // Does this supplier already have an active catalog? If so, reconcile
    // instead of blindly inserting duplicates.
    const { data: existingItems } = await supabase
      .from('wine_items')
      .select('*')
      .eq('supplier_id', supplierId)
      .eq('status', 'active')

    await supabase.from('price_lists').update({
      supplier_id: supplierId,
      supplier_name: result.supplier_name,
      date: result.price_list_date ?? null,
      item_count: result.items.length,
      progress: 95,
      progress_phase: existingItems && existingItems.length ? 'reconciling' : 'inserting',
    }).eq('id', priceListId)

    if (existingItems && existingItems.length > 0) {
      const { computeDiff } = await import('@/lib/price/reconcile')
      const diff = computeDiff(existingItems as unknown as import('@/lib/price/supabase').WineItem[], result.items)
      const { error: cuErr } = await supabase.from('catalog_updates').insert({
        supplier_id: supplierId,
        new_price_list_id: priceListId,
        status: 'pending_review',
        diff,
      })
      if (cuErr) throw new Error(`catalog_updates insert failed: ${cuErr.message}`)
      await supabase.from('price_lists')
        .update({ status: 'review', progress: 100, progress_phase: null })
        .eq('id', priceListId)
      return
    }
```

Keep the existing `VALID_CATEGORY`/insert-loop block exactly as-is below this branch (it runs only for first-time suppliers).

- [ ] **Step 2: Manual smoke test**

Run the dev server (`npm run dev`) and re-upload a supplier PDF that already has items via the existing upload UI. Then query the DB:

```sql
select status, progress_phase from price_lists order by uploaded_at desc limit 1;
select status, jsonb_array_length(diff->'changes') as n from catalog_updates order by created_at desc limit 1;
```

Expected: latest `price_lists.status = 'review'`; a `catalog_updates` row with `status='pending_review'` and n > 0.

- [ ] **Step 3: Commit**

```bash
git add app/api/m/price/price-lists/route.ts
git commit -m "feat(price): reconcile on re-upload when supplier already has active items"
```

---

### Task 6: GET one update (review payload) + DELETE discard

**Files:**
- Create: `02_services/mission-control/app/api/m/price/updates/[id]/route.ts`

- [ ] **Step 1: Write the route**

Create `app/api/m/price/updates/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/price/supabase'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data, error } = await supabase
    .from('catalog_updates').select('*').eq('id', id).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json(data)
}

// Discard an open review: no mutation of wine_items.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data: cu, error: getErr } = await supabase
    .from('catalog_updates').select('new_price_list_id,status').eq('id', id).single()
  if (getErr || !cu) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (cu.status !== 'pending_review')
    return NextResponse.json({ error: `cannot discard a ${cu.status} update` }, { status: 409 })

  await supabase.from('catalog_updates').update({ status: 'discarded' }).eq('id', id)
  if (cu.new_price_list_id)
    await supabase.from('price_lists').update({ status: 'error', error_message: 'Update discarded' })
      .eq('id', cu.new_price_list_id)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in this file.

- [ ] **Step 3: Commit**

```bash
git add app/api/m/price/updates/[id]/route.ts
git commit -m "feat(price): GET catalog update + DELETE (discard) route"
```

---

### Task 7: Apply route

**Files:**
- Create: `02_services/mission-control/app/api/m/price/updates/[id]/apply/route.ts`

- [ ] **Step 1: Write the route**

Create `app/api/m/price/updates/[id]/apply/route.ts`. The client POSTs `{ decisions: Record<number, Decision> }` keyed by the change's index in `diff.changes`. A `Decision` is `{ accept: boolean }` plus, for `ambiguous`, `{ bindTo: string | 'new' }`.

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/price/supabase'
import { matchKey } from '@/lib/price/reconcile'
import type { CatalogDiff, DiffChange } from '@/lib/price/reconcile'
import type { ExtractedItem } from '@/lib/price/claude'

type Decision = { accept: boolean; bindTo?: string | 'new' }

// Fields to copy from a parsed item onto a wine_items row.
function itemFields(inc: ExtractedItem) {
  return {
    name: inc.name, country: inc.country, region: inc.region,
    grape_variety: inc.grape_variety, price: inc.price, year: inc.year,
    volume: inc.volume, description: inc.description, category: inc.category,
    wine_type: inc.wine_type, spirit_type: inc.spirit_type ?? null,
    match_key: matchKey(inc.name, inc.volume),
  }
}

// Reset Vivino enrichment when identity (name/year) changed so the tick job re-runs.
function vivinoResetIfIdentityChanged(existingName: string, existingYear: number | null, inc: ExtractedItem) {
  if (existingName !== inc.name || (existingYear ?? null) !== (inc.year ?? null))
    return { vivino_enriched_at: null, vivino_failed_at: null }
  return {}
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { decisions } = (await req.json()) as { decisions: Record<number, Decision> }

  const { data: cu, error } = await supabase
    .from('catalog_updates').select('*').eq('id', id).single()
  if (error || !cu) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (cu.status !== 'pending_review')
    return NextResponse.json({ error: `already ${cu.status}` }, { status: 409 })

  const diff = cu.diff as CatalogDiff
  const plId = cu.new_price_list_id as string
  const supplierId = cu.supplier_id as string | null

  let applied = 0
  for (let i = 0; i < diff.changes.length; i++) {
    const c = diff.changes[i]
    const d = decisions[i]
    if (!d?.accept) continue
    const inc = c.incoming

    if (c.kind === 'added' && inc) {
      await supabase.from('wine_items').insert({
        ...itemFields(inc), price_list_id: plId, supplier_id: supplierId,
        supplier_name: diff.supplier_name, status: 'active',
      })
      applied++
    } else if ((c.kind === 'price_changed' || c.kind === 'updated') && inc && c.existing_id) {
      await supabase.from('wine_items').update({
        ...itemFields(inc), price_list_id: plId,
        ...vivinoResetIfIdentityChanged(c.existing_name ?? '', null, inc),
      }).eq('id', c.existing_id)
      applied++
    } else if (c.kind === 'reactivated' && inc && c.existing_id) {
      await supabase.from('wine_items').update({
        ...itemFields(inc), price_list_id: plId, status: 'active', discontinued_at: null,
      }).eq('id', c.existing_id)
      applied++
    } else if (c.kind === 'discontinued' && c.existing_id) {
      await supabase.from('wine_items')
        .update({ status: 'discontinued', discontinued_at: new Date().toISOString() })
        .eq('id', c.existing_id)
      applied++
    } else if (c.kind === 'ambiguous' && inc) {
      if (d.bindTo && d.bindTo !== 'new') {
        await supabase.from('wine_items').update({
          ...itemFields(inc), price_list_id: plId, status: 'active', discontinued_at: null,
        }).eq('id', d.bindTo)
      } else {
        await supabase.from('wine_items').insert({
          ...itemFields(inc), price_list_id: plId, supplier_id: supplierId,
          supplier_name: diff.supplier_name, status: 'active',
        })
      }
      applied++
    }
  }

  await supabase.from('catalog_updates')
    .update({ status: 'applied', applied_at: new Date().toISOString() }).eq('id', id)
  await supabase.from('price_lists')
    .update({ status: 'done', progress: 100, progress_phase: null }).eq('id', plId)

  return NextResponse.json({ ok: true, applied })
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in this file.

- [ ] **Step 3: Commit**

```bash
git add app/api/m/price/updates/[id]/apply/route.ts
git commit -m "feat(price): apply catalog update with per-change decisions"
```

---

### Task 8: Review screen

**Files:**
- Create: `02_services/mission-control/app/(portal)/m/price/updates/[id]/page.tsx`
- Create: `02_services/mission-control/app/(portal)/m/price/updates/[id]/ReviewClient.tsx`

- [ ] **Step 1: Write the server page**

Create `app/(portal)/m/price/updates/[id]/page.tsx`:

```tsx
import { supabase } from '@/lib/price/supabase'
import type { CatalogUpdate } from '@/lib/price/supabase'
import ReviewClient from './ReviewClient'

export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data } = await supabase.from('catalog_updates').select('*').eq('id', id).single()
  if (!data) return <div className="p-6">Update not found.</div>
  return <ReviewClient update={data as CatalogUpdate} />
}
```

- [ ] **Step 2: Write the client component**

Create `app/(portal)/m/price/updates/[id]/ReviewClient.tsx`:

```tsx
'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CatalogUpdate } from '@/lib/price/supabase'
import type { DiffChange, DiffKind } from '@/lib/price/reconcile'

const KIND_LABEL: Record<DiffKind, string> = {
  added: 'New', price_changed: 'Price changed', updated: 'Updated',
  unchanged: 'Unchanged', discontinued: 'Discontinued', reactivated: 'Back in stock',
  ambiguous: 'Needs match',
}
const ACTIONABLE: DiffKind[] = ['added', 'price_changed', 'updated', 'discontinued', 'reactivated', 'ambiguous']

type Decision = { accept: boolean; bindTo?: string | 'new' }

export default function ReviewClient({ update }: { update: CatalogUpdate }) {
  const router = useRouter()
  const changes = update.diff.changes
  const [decisions, setDecisions] = useState<Record<number, Decision>>(() => {
    const init: Record<number, Decision> = {}
    changes.forEach((c, i) => {
      if (ACTIONABLE.includes(c.kind))
        init[i] = { accept: c.kind !== 'ambiguous', bindTo: c.kind === 'ambiguous' ? undefined : undefined }
    })
    return init
  })
  const [busy, setBusy] = useState(false)

  const unresolvedAmbiguous = useMemo(
    () => changes.some((c, i) => c.kind === 'ambiguous' && decisions[i]?.accept && !decisions[i]?.bindTo),
    [changes, decisions])

  async function apply() {
    setBusy(true)
    const res = await fetch(`/api/m/price/updates/${update.id}/apply`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decisions }),
    })
    setBusy(false)
    if (res.ok) router.push('/m/price/price-lists')
    else alert('Apply failed: ' + (await res.json()).error)
  }
  async function discard() {
    if (!confirm('Discard this update? No catalog changes will be made.')) return
    setBusy(true)
    await fetch(`/api/m/price/updates/${update.id}`, { method: 'DELETE' })
    setBusy(false)
    router.push('/m/price/price-lists')
  }

  const groups = ACTIONABLE.map(k => ({ k, items: changes.map((c, i) => ({ c, i })).filter(x => x.c.kind === k) }))
    .filter(g => g.items.length)
  const unchangedCount = changes.filter(c => c.kind === 'unchanged').length

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-semibold mb-1">Review catalog update — {update.diff.supplier_name}</h1>
      <p className="text-sm text-gray-500 mb-4">{unchangedCount} unchanged items hidden.</p>

      {groups.map(({ k, items }) => (
        <section key={k} className="mb-6">
          <h2 className="font-medium mb-2">{KIND_LABEL[k]} ({items.length})</h2>
          <ul className="divide-y border rounded">
            {items.map(({ c, i }) => (
              <li key={i} className="p-3 flex items-center gap-3">
                <input type="checkbox" checked={decisions[i]?.accept ?? false}
                  onChange={e => setDecisions(s => ({ ...s, [i]: { ...s[i], accept: e.target.checked } }))} />
                <div className="flex-1">
                  <div className="text-sm">{c.incoming?.name ?? c.existing_name}</div>
                  <div className="text-xs text-gray-500">
                    {c.kind === 'price_changed' && `${c.old_price} → ${c.incoming?.price}`}
                    {c.kind === 'updated' && `changed: ${(c.changed_fields ?? []).join(', ')}`}
                    {c.kind === 'added' && `${c.incoming?.price ?? '—'}`}
                    {c.kind === 'discontinued' && 'absent from new PDF'}
                    {c.kind === 'reactivated' && `back at ${c.incoming?.price}`}
                  </div>
                  {c.kind === 'ambiguous' && (
                    <select className="mt-1 text-sm border rounded px-1"
                      value={decisions[i]?.bindTo ?? ''}
                      onChange={e => setDecisions(s => ({ ...s, [i]: { ...s[i], bindTo: e.target.value } }))}>
                      <option value="">— choose —</option>
                      {(c.candidates ?? []).map(cand =>
                        <option key={cand.id} value={cand.id}>Same as: {cand.name} ({cand.price})</option>)}
                      <option value="new">Add as new item</option>
                    </select>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <div className="flex gap-3 sticky bottom-0 bg-white py-3">
        <button disabled={busy || unresolvedAmbiguous} onClick={apply}
          className="px-4 py-2 rounded bg-black text-white disabled:opacity-40">Apply</button>
        <button disabled={busy} onClick={discard}
          className="px-4 py-2 rounded border">Discard</button>
        {unresolvedAmbiguous && <span className="text-xs text-red-600 self-center">Resolve all “Needs match” first.</span>}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck + manual check**

Run: `npx tsc --noEmit`
Expected: no errors.
Then `npm run dev`, open `/m/price/updates/<id>` for the update created in Task 5, confirm groups render and Apply redirects.

- [ ] **Step 4: Commit**

```bash
git add "app/(portal)/m/price/updates/[id]/page.tsx" "app/(portal)/m/price/updates/[id]/ReviewClient.tsx"
git commit -m "feat(price): catalog-update review screen"
```

---

### Task 9: Surface review state in the price-lists list

**Files:**
- Modify: `02_services/mission-control/app/(portal)/m/price/price-lists/page.tsx`

- [ ] **Step 1: Read the file to find the per-list row render**

Run: `sed -n '1,200p' "app/(portal)/m/price/price-lists/page.tsx"` and locate where each `price_lists` row / status is rendered.

- [ ] **Step 2: Add a Review link for `status === 'review'`**

For rows where `status === 'review'`, render a link next to the status. The `catalog_updates` row is looked up by `new_price_list_id`. Add a fetch of open updates (map `new_price_list_id → id`) in the page's data load, then in the row:

```tsx
{list.status === 'review' && updateIdByList[list.id] && (
  <a href={`/m/price/updates/${updateIdByList[list.id]}`}
     className="ml-2 text-sm underline text-amber-700">Review changes</a>
)}
```

Where `updateIdByList` is built in the server component:

```tsx
const { data: openUpdates } = await supabase
  .from('catalog_updates').select('id,new_price_list_id').eq('status', 'pending_review')
const updateIdByList: Record<string, string> = {}
for (const u of openUpdates ?? []) if (u.new_price_list_id) updateIdByList[u.new_price_list_id] = u.id
```

- [ ] **Step 3: Manual check**

`npm run dev`, open `/m/price/price-lists`, confirm the re-uploaded list shows "Review changes" linking to the update.

- [ ] **Step 4: Commit**

```bash
git add "app/(portal)/m/price/price-lists/page.tsx"
git commit -m "feat(price): link price lists in review state to their diff screen"
```

---

### Task 10: Golden fixture integration test

**Files:**
- Create: `02_services/mission-control/lib/price/__fixtures__/harvest-old.json`
- Create: `02_services/mission-control/lib/price/__fixtures__/harvest-new.json`
- Create: `02_services/mission-control/lib/price/reconcile.integration.test.ts`

- [ ] **Step 1: Build the fixtures**

`harvest-old.json` = an array of ~6 `WineItem`-shaped objects representing a prior Harvest parse (reuse the `active()` shape: id, name, price, volume, status:'active', match_key computed). `harvest-new.json` = an array of `ExtractedItem`-shaped objects from the July 2026 catalog. Include at least: one identical item (unchanged), one price change, one new item, one discontinued (in old, not in new), one vintage-only change (updated/unchanged), and one near-name (ambiguous). Keep them small and hand-authored — do NOT parse the real PDF in the test (no network / no Claude in unit tests).

Example `harvest-old.json`:

```json
[
  { "id": "o1", "name": "Cabernet Reserve", "price": 300, "volume": "750ml", "status": "active", "match_key": "cabernet reserve|750", "supplier_name": "Harvest", "description": "oak", "year": 2016 },
  { "id": "o2", "name": "Grape Dance Blanc", "price": 500, "volume": "750ml", "status": "active", "match_key": "grape dance blanc|750", "supplier_name": "Harvest", "description": "", "year": 2023 },
  { "id": "o3", "name": "Old Delisted Wine", "price": 400, "volume": "750ml", "status": "active", "match_key": "old delisted wine|750", "supplier_name": "Harvest", "description": "", "year": 2020 }
]
```

Example `harvest-new.json`:

```json
[
  { "name": "Cabernet Reserve 2020", "price": 350, "volume": "750ml", "description": "oak", "year": 2020, "category": "wine", "wine_type": "red", "country": null, "region": null, "grape_variety": null },
  { "name": "Grape Dance Blanc", "price": 500, "volume": "750ml", "description": "", "year": 2023, "category": "wine", "wine_type": "white", "country": null, "region": null, "grape_variety": null },
  { "name": "Nude Saperavi", "price": 590, "volume": "750ml", "description": "", "year": 2024, "category": "wine", "wine_type": "red", "country": null, "region": null, "grape_variety": null }
]
```

(The test tolerates the partial `WineItem` shape because `computeDiff` only reads fields it needs; cast via `as unknown as WineItem[]`.)

- [ ] **Step 2: Write the test**

Create `lib/price/reconcile.integration.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { computeDiff } from './reconcile'
import type { WineItem } from './supabase'
import type { ExtractedItem } from './claude'
import oldItems from './__fixtures__/harvest-old.json'
import newItems from './__fixtures__/harvest-new.json'

describe('Harvest golden fixture', () => {
  const diff = computeDiff(oldItems as unknown as WineItem[], newItems as unknown as ExtractedItem[])
  const count = (k: string) => diff.changes.filter(c => c.kind === k).length

  it('detects the price change on Cabernet (vintage-agnostic match)', () => {
    const cab = diff.changes.find(c => c.existing_id === 'o1')
    expect(cab?.kind).toBe('price_changed')
    expect(cab?.old_price).toBe(300)
    expect(cab?.incoming?.price).toBe(350)
  })
  it('keeps the identical Grape Dance as unchanged', () => {
    expect(diff.changes.find(c => c.existing_id === 'o2')?.kind).toBe('unchanged')
  })
  it('adds the new Nude Saperavi', () => {
    expect(diff.changes.some(c => c.kind === 'added' && c.incoming?.name === 'Nude Saperavi')).toBe(true)
  })
  it('discontinues the delisted wine', () => {
    expect(diff.changes.find(c => c.existing_id === 'o3')?.kind).toBe('discontinued')
  })
  it('produces exactly one change per existing + net-new item', () => {
    expect(count('price_changed') + count('unchanged') + count('discontinued') + count('added')).toBe(diff.changes.length)
  })
})
```

- [ ] **Step 3: Run and verify**

Run: `npx vitest run lib/price/reconcile.integration.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/price/__fixtures__/harvest-old.json lib/price/__fixtures__/harvest-new.json lib/price/reconcile.integration.test.ts
git commit -m "test(price): Harvest golden-fixture reconciliation integration test"
```

---

### Task 11: Full test + build gate

- [ ] **Step 1: Run the whole price test suite**

Run: `npx vitest run lib/price`
Expected: all PASS.

- [ ] **Step 2: Typecheck the app**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds (new routes and pages compile).

- [ ] **Step 4: Final commit if any lint/build fixes were needed**

```bash
git add -A && git commit -m "chore(price): reconciliation build/lint fixes" || echo "nothing to commit"
```

---

## Self-Review notes

- **Spec coverage:** migration/fields (Task 1–2), matching + diff categories incl. reactivation & ambiguous (Task 3–4), reconcile-on-reupload trigger (Task 5), review screen + apply + discard with Vivino reset (Task 6–8), review-state surfacing (Task 9), golden fixture (Task 10). All spec sections map to a task.
- **Discontinued = flag, not delete:** Task 4 emits `discontinued`; Task 7 sets `status='discontinued'` + `discontinued_at`. ✓
- **In-place update preserves id + Vivino:** Task 7 updates by `existing_id`, only resetting Vivino when identity changed. ✓
- **Generic:** trigger keys off "supplier has active items", nothing Harvest-specific. ✓
- **Type consistency:** `computeDiff`, `CatalogDiff`, `DiffChange`, `DiffKind`, `matchKey`, `normalizeName`, `canonicalVolume` names identical across tasks; `Decision` shape identical in Task 7 & 8.
- **Manual migration:** Task 1 explicitly hands SQL to the user for the price-service project, per repo convention. Tasks 5–9 assume it's applied first.
