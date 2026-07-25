# Price List Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A native mission-control page (Marketing → Price Lists) that assembles a branded price list from store products, CSV/Excel, or manual rows, and exports it as A4 PNG pages + a PDF.

**Architecture:** Pure, DB-free logic (`lib/pricelist/{types,layout,template}.ts`) drives both a live in-browser preview and a server-side puppeteer render. Data comes from `inventory.v_sku_breakdown` joined with a new `marketing.sku_enrichment` table; saved lists live in `marketing.price_lists`. The render endpoint reuses the puppeteer pattern already proven in `lib/promo/render.ts`.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, vitest, `xlsx`, `pdf-lib`, `puppeteer-core` + `@sparticuz/chromium`, Supabase (PostgREST), Tailwind. All working paths below are relative to `02_services/mission-control/` unless noted.

**Spec:** `docs/superpowers/specs/2026-07-25-pricelist-builder-design.md`

---

## File Structure

Created:
- `supabase/migrations/035_marketing_pricelist.sql` — schema `marketing` + `price_lists` + `sku_enrichment`
- `lib/pricelist/types.ts` — shared types (pure)
- `lib/pricelist/layout.ts` — grouping + row packing + pagination (pure)
- `lib/pricelist/layout.test.ts` — unit tests
- `lib/pricelist/template.ts` — doc → HTML string (pure)
- `lib/pricelist/template.test.ts` — snapshot-ish unit tests
- `lib/pricelist/plaques.ts` — wine color → plaque zone/token (pure)
- `lib/pricelist/plaques.test.ts`
- `lib/pricelist/import.ts` — CSV/Excel rows → LineItem[] + report (pure over parsed rows)
- `lib/pricelist/import.test.ts`
- `lib/pricelist/catalog.ts` — read `v_sku_breakdown` + join enrichment (impure, Supabase)
- `lib/pricelist/store.ts` — CRUD for `marketing.price_lists` + enrichment upsert (impure)
- `lib/pricelist/render.ts` — HTML → PNG pages + PDF (impure, puppeteer + pdf-lib)
- `app/api/m/pricelist/catalog/route.ts` — GET inventory catalog
- `app/api/m/pricelist/import/route.ts` — POST file → parsed rows
- `app/api/m/pricelist/lists/route.ts` — GET list index / POST create
- `app/api/m/pricelist/lists/[id]/route.ts` — GET/PUT one list
- `app/api/m/pricelist/render/route.ts` — POST doc → PNG+PDF buffers
- `app/(portal)/m/pricelist/page.tsx` — server page (auth gate, initial data)
- `app/(portal)/m/pricelist/PricelistBuilderClient.tsx` — client builder + preview
- `app/(portal)/m/pricelist/preview.tsx` — client-side preview wrapper (renders template HTML in a scaled iframe)
- `04_brand/price-list.md` — brand guideline (repo root, NOT under mission-control)

Modified:
- `lib/supabase.ts` — add `sbMarketing` client
- `lib/registry.ts` — add `pricelist` item to the `marketing` section
- `lib/brand-tokens.json` + `04_brand/design-tokens.json` — add `rose-dust` token
- `tailwind.config.ts` — add `rose-dust` color

---

## Phase 0 — Foundations

### Task 1: Migration 035 (marketing schema + tables)

**Files:**
- Create: `supabase/migrations/035_marketing_pricelist.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 035_marketing_pricelist.sql
-- Price List Builder (Marketing → Price Lists).
-- MANUAL STEP: after applying, add schema `marketing` to Supabase
--   Settings → API → Exposed schemas, or PostgREST returns 404.
-- Applied by hand in the Supabase SQL Editor (service key is PostgREST, not DDL).

create schema if not exists marketing;

-- Region/producer/volume are NOT in inventory.v_sku_breakdown but appear on the
-- price-list card. Keyed by Loyverse product code so a value entered once
-- prefills every future list that includes the same product.
create table if not exists marketing.sku_enrichment (
  loyverse_product_code text primary key,
  region                text,
  producer              text,
  volume                text,
  updated_at            timestamptz not null default now()
);

-- Saved price lists (drafts + finished). `items` is the ordered array of line
-- objects; `settings` holds header contact text, VAT note, grouping options,
-- tier thresholds, plaque overrides.
create table if not exists marketing.price_lists (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  grouping   text not null default 'manual',
  items      jsonb not null default '[]'::jsonb,
  settings   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Service-role-only access (mirrors portal.users). RLS on, no policies.
alter table marketing.sku_enrichment enable row level security;
alter table marketing.price_lists   enable row level security;
```

- [ ] **Step 2: Commit** (the user applies it manually — do not attempt to run DDL)

```bash
git add supabase/migrations/035_marketing_pricelist.sql
git commit -m "feat(marketing): migration 035 — pricelist tables"
```

> **Handoff note for the executor:** flag to the user that migration 035 must be applied in the Supabase SQL Editor AND the `marketing` schema added to Exposed schemas before the catalog/store code works end-to-end. Pure-logic tasks (2–9) do not need the DB and can proceed regardless.

### Task 2: `sbMarketing` client + `rose-dust` brand token

**Files:**
- Modify: `lib/supabase.ts` (after the `sbPortal` block, ~line 24)
- Modify: `lib/brand-tokens.json` (palette section)
- Modify: `04_brand/design-tokens.json` (repo root — palette section)
- Modify: `tailwind.config.ts` (colors block)

- [ ] **Step 1: Add the `sbMarketing` client**

In `lib/supabase.ts`, after the `sbPortal` export:

```ts
// Marketing — price lists + SKU enrichment. See migration 035_marketing_pricelist.sql.
// Schema `marketing` must be added to "Exposed schemas" in Supabase settings.
export const sbMarketing = createClient(url, key, { db: { schema: 'marketing' } })
```

- [ ] **Step 2: Add the `rose-dust` color to tailwind**

In `tailwind.config.ts`, add to the `theme.extend.colors` block (next to `wine-red`, `amber-gold`, `graphite`):

```ts
'rose-dust': '#C98C8C',
```

- [ ] **Step 3: Add `rose-dust` to both token JSON files**

In `lib/brand-tokens.json` and `04_brand/design-tokens.json`, add `"rose-dust": "#C98C8C"` to the palette color map (match the existing key style used for `amber-gold`). If the two files' palette shapes differ, mirror each file's own convention.

- [ ] **Step 4: Verify build still typechecks**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add lib/supabase.ts tailwind.config.ts lib/brand-tokens.json ../../04_brand/design-tokens.json
git commit -m "feat(marketing): sbMarketing client + rose-dust brand token"
```

---

## Phase 1 — Pure core (types, plaques, layout, template)

### Task 3: Types

**Files:**
- Create: `lib/pricelist/types.ts`

- [ ] **Step 1: Write the types**

```ts
// Shared, DB-free types for the price-list builder.

export type PlaqueZone = 'white' | 'red' | 'sparkling' | 'rose' | 'spirits'

// wine_color from inventory.v_sku_breakdown: red|white|rose|sparkling|orange
export type WineColor = 'red' | 'white' | 'rose' | 'sparkling' | 'orange'

export type LineItem = {
  id: string                 // client-generated uid, stable within a doc
  code?: string              // loyverse_product_code (inventory items only)
  name: string
  price: number | null       // THB; null = show placeholder
  zone: PlaqueZone           // drives the plaque colour
  grape?: string
  country?: string
  region?: string
  producer?: string
  volume?: string
  imageSlug?: string         // resolves to 04_brand/products/<slug>.png
  imageUrl?: string          // explicit image (CSV/manual); wins over imageSlug
  rowLayout?: RowLayout      // manual override of auto packing
}

export type RowLayout = 'pair' | 'solo-wide'

export type Grouping =
  | 'producer' | 'type' | 'region' | 'tier' | 'grape' | 'curated' | 'manual'

export type PageSettings = {
  title: string
  grouping: Grouping
  showDividers: boolean             // group heading bands; false = reference look
  tierThresholds: number[]          // e.g. [600, 1000] → three buckets
  oddItemMode: 'solo-wide' | 'tight'
  headerContact: string             // e.g. 'WhatsApp · Irina +66 93 914 0004'
  vatNote: string                   // e.g. '7% VAT NOT INCLUDED'
  cardsPerPage: number              // default 14
}

export type Row =
  | { kind: 'pair'; items: [LineItem, LineItem] }
  | { kind: 'solo-wide'; item: LineItem }
  | { kind: 'divider'; label: string }

export type Page = { rows: Row[] }

export type PriceListDoc = {
  settings: PageSettings
  items: LineItem[]
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/pricelist/types.ts
git commit -m "feat(pricelist): shared types"
```

### Task 4: Plaque mapping

**Files:**
- Create: `lib/pricelist/plaques.ts`
- Test: `lib/pricelist/plaques.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { zoneFromWineColor, zoneToken, PLAQUE_TOKENS } from './plaques'

describe('zoneFromWineColor', () => {
  it('maps direct colors', () => {
    expect(zoneFromWineColor('red')).toBe('red')
    expect(zoneFromWineColor('white')).toBe('white')
    expect(zoneFromWineColor('sparkling')).toBe('sparkling')
    expect(zoneFromWineColor('rose')).toBe('rose')
  })
  it('folds orange into the white zone (v1)', () => {
    expect(zoneFromWineColor('orange')).toBe('white')
  })
  it('defaults unknown/nullish to white', () => {
    expect(zoneFromWineColor(null)).toBe('white')
    expect(zoneFromWineColor(undefined)).toBe('white')
    expect(zoneFromWineColor('grape-juice')).toBe('white')
  })
})

describe('zoneToken', () => {
  it('returns the brand token hex per zone', () => {
    expect(zoneToken('red')).toBe(PLAQUE_TOKENS.red)
    expect(zoneToken('spirits')).toBe('#3D3D3D')
    expect(zoneToken('rose')).toBe('#C98C8C')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/pricelist/plaques.test.ts`
Expected: FAIL — cannot find module `./plaques`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { PlaqueZone } from './types'

// Brand tokens (04_brand/design-system.md §2). `sparkling` reuses amber-gold
// with a bubble texture applied in the template; the swatch hex here is the
// base fill. `label` is the vertical plaque caption.
export const PLAQUE_TOKENS: Record<PlaqueZone, string> = {
  white:     '#C9A84C', // amber-gold
  red:       '#8C1C1C', // wine-red
  sparkling: '#C9A84C', // amber-gold + bubble pattern (template)
  rose:      '#C98C8C', // rose-dust
  spirits:   '#3D3D3D', // graphite
}

export const PLAQUE_LABELS: Record<PlaqueZone, string> = {
  white: 'WHITE', red: 'RED', sparkling: 'SPARKLING', rose: 'ROSÉ', spirits: 'SPIRITS',
}

export function zoneFromWineColor(c: string | null | undefined): PlaqueZone {
  switch (c) {
    case 'red':       return 'red'
    case 'white':     return 'white'
    case 'sparkling': return 'sparkling'
    case 'rose':      return 'rose'
    case 'orange':    return 'white' // folded into white zone in v1
    default:          return 'white'
  }
}

export function zoneToken(z: PlaqueZone): string {
  return PLAQUE_TOKENS[z]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/pricelist/plaques.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/pricelist/plaques.ts lib/pricelist/plaques.test.ts
git commit -m "feat(pricelist): plaque zone mapping"
```

### Task 5: Layout engine

**Files:**
- Create: `lib/pricelist/layout.ts`
- Test: `lib/pricelist/layout.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { buildPages } from './layout'
import type { LineItem, PageSettings } from './types'

function item(id: string, over: Partial<LineItem> = {}): LineItem {
  return { id, name: `Wine ${id}`, price: 500, zone: 'white', ...over }
}

const base: PageSettings = {
  title: 'Test', grouping: 'manual', showDividers: false,
  tierThresholds: [600, 1000], oddItemMode: 'solo-wide',
  headerContact: '', vatNote: '', cardsPerPage: 14,
}

describe('buildPages — packing', () => {
  it('packs an even manual list into pair rows, no dividers', () => {
    const pages = buildPages([item('a'), item('b'), item('c'), item('d')], base)
    expect(pages).toHaveLength(1)
    expect(pages[0].rows).toEqual([
      { kind: 'pair', items: [expect.objectContaining({ id: 'a' }), expect.objectContaining({ id: 'b' })] },
      { kind: 'pair', items: [expect.objectContaining({ id: 'c' }), expect.objectContaining({ id: 'd' })] },
    ])
  })

  it('turns a trailing odd item into solo-wide by default', () => {
    const pages = buildPages([item('a'), item('b'), item('c')], base)
    const rows = pages[0].rows
    expect(rows[0].kind).toBe('pair')
    expect(rows[1]).toEqual({ kind: 'solo-wide', item: expect.objectContaining({ id: 'c' }) })
  })

  it('keeps a trailing odd item as a half-width lone pair when oddItemMode=tight', () => {
    const pages = buildPages([item('a'), item('b'), item('c')], { ...base, oddItemMode: 'tight' })
    const last = pages[0].rows[1]
    expect(last.kind).toBe('pair')
    // tight mode leaves the right slot empty (null placeholder)
    expect((last as any).items[1]).toBeNull()
  })

  it('honours a per-item rowLayout override', () => {
    const pages = buildPages([item('a', { rowLayout: 'solo-wide' }), item('b'), item('c')], base)
    expect(pages[0].rows[0]).toEqual({ kind: 'solo-wide', item: expect.objectContaining({ id: 'a' }) })
    expect(pages[0].rows[1]).toEqual({ kind: 'pair', items: [expect.objectContaining({ id: 'b' }), expect.objectContaining({ id: 'c' })] })
  })
})

describe('buildPages — grouping', () => {
  it('groups by type and emits a divider per group when showDividers', () => {
    const items = [item('a', { zone: 'white' }), item('b', { zone: 'red' }), item('c', { zone: 'white' })]
    const pages = buildPages(items, { ...base, grouping: 'type', showDividers: true })
    const kinds = pages[0].rows.map(r => r.kind)
    expect(kinds[0]).toBe('divider')
    // white group (a, c) then red group (b), each preceded by a divider
    expect(pages[0].rows.filter(r => r.kind === 'divider')).toHaveLength(2)
  })

  it('buckets by tier thresholds', () => {
    const items = [item('cheap', { price: 400 }), item('mid', { price: 800 }), item('lux', { price: 1500 })]
    const pages = buildPages(items, { ...base, grouping: 'tier', showDividers: true })
    const labels = pages[0].rows.filter(r => r.kind === 'divider').map(r => (r as any).label)
    expect(labels).toHaveLength(3)
  })
})

describe('buildPages — pagination', () => {
  it('flows rows onto multiple pages at cardsPerPage', () => {
    const items = Array.from({ length: 30 }, (_, i) => item(String(i)))
    const pages = buildPages(items, { ...base, cardsPerPage: 14 })
    expect(pages.length).toBeGreaterThan(1)
  })

  it('never orphans a divider at the end of a page', () => {
    // 14-card page; construct groups so a divider would land last without the guard
    const items = [
      ...Array.from({ length: 13 }, (_, i) => item(`w${i}`, { zone: 'white' })),
      item('r0', { zone: 'red' }), item('r1', { zone: 'red' }),
    ]
    const pages = buildPages(items, { ...base, grouping: 'type', showDividers: true, cardsPerPage: 14 })
    for (const p of pages) {
      expect(p.rows[p.rows.length - 1].kind).not.toBe('divider')
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/pricelist/layout.test.ts`
Expected: FAIL — cannot find module `./layout`.

- [ ] **Step 3: Write the implementation**

```ts
import type { LineItem, PageSettings, Row, Page, Grouping } from './types'
import { PLAQUE_LABELS } from './plaques'

// ─── Grouping ────────────────────────────────────────────────────────────
type Group = { label: string; items: LineItem[] }

function groupItems(items: LineItem[], s: PageSettings): Group[] {
  const g = s.grouping
  if (g === 'manual' || g === 'curated') return [{ label: '', items }]

  const keyOf = (it: LineItem): string => {
    switch (g) {
      case 'producer': return it.producer || 'Other'
      case 'type':     return PLAQUE_LABELS[it.zone]
      case 'region':   return it.region || it.country || 'Other'
      case 'grape':    return it.grape || 'Other'
      case 'tier':     return tierLabel(it.price, s.tierThresholds)
      default:         return ''
    }
  }

  const order: string[] = []
  const map = new Map<string, LineItem[]>()
  for (const it of items) {
    const k = keyOf(it)
    if (!map.has(k)) { map.set(k, []); order.push(k) }
    map.get(k)!.push(it)
  }
  return order.map(label => ({ label, items: map.get(label)! }))
}

function tierLabel(price: number | null, thresholds: number[]): string {
  const p = price ?? 0
  const sorted = [...thresholds].sort((a, b) => a - b)
  let lo = 0
  for (const t of sorted) {
    if (p < t) return `฿${lo || 0}–${t}`
    lo = t
  }
  return `฿${lo}+`
}

// ─── Row packing within one group ──────────────────────────────────────────
function packGroup(items: LineItem[], s: PageSettings): Row[] {
  const rows: Row[] = []
  let i = 0
  while (i < items.length) {
    const a = items[i]
    if (a.rowLayout === 'solo-wide') {
      rows.push({ kind: 'solo-wide', item: a }); i += 1; continue
    }
    const b = items[i + 1]
    if (!b) {
      // trailing odd item
      if (s.oddItemMode === 'solo-wide') rows.push({ kind: 'solo-wide', item: a })
      else rows.push({ kind: 'pair', items: [a, null as unknown as LineItem] })
      i += 1; continue
    }
    if (b.rowLayout === 'solo-wide') {
      // a alone, then b handled next loop
      rows.push({ kind: 'solo-wide', item: a }); i += 1; continue
    }
    rows.push({ kind: 'pair', items: [a, b] }); i += 2
  }
  return rows
}

// ─── Pagination ─────────────────────────────────────────────────────────────
// A divider counts as 0 cards; pair = 2, solo-wide = 1. Never end a page on a
// divider — push it to the next page with its following row.
function paginate(rows: Row[], cardsPerPage: number): Page[] {
  const pages: Page[] = []
  let cur: Row[] = []
  let count = 0
  const cardCost = (r: Row) => (r.kind === 'pair' ? 2 : r.kind === 'solo-wide' ? 1 : 0)

  for (const r of rows) {
    const cost = cardCost(r)
    if (count + cost > cardsPerPage && cur.length) {
      pages.push({ rows: cur }); cur = []; count = 0
    }
    cur.push(r); count += cost
  }
  if (cur.length) pages.push({ rows: cur })

  // Guard: if any page ends on a divider, move it to the next page's front.
  for (let p = 0; p < pages.length - 1; p++) {
    const rowsP = pages[p].rows
    while (rowsP.length && rowsP[rowsP.length - 1].kind === 'divider') {
      const d = rowsP.pop()!
      pages[p + 1].rows.unshift(d)
    }
  }
  // Last page ending on a divider = a group with no items; drop it.
  const last = pages[pages.length - 1]?.rows
  while (last && last.length && last[last.length - 1].kind === 'divider') last.pop()

  return pages.filter(p => p.rows.length)
}

// ─── Public entry ────────────────────────────────────────────────────────────
export function buildPages(items: LineItem[], s: PageSettings): Page[] {
  const groups = groupItems(items, s)
  const rows: Row[] = []
  for (const grp of groups) {
    if (s.showDividers && grp.label) rows.push({ kind: 'divider', label: grp.label })
    rows.push(...packGroup(grp.items, s))
  }
  return paginate(rows, s.cardsPerPage)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/pricelist/layout.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/pricelist/layout.ts lib/pricelist/layout.test.ts
git commit -m "feat(pricelist): layout engine — grouping, packing, pagination"
```

### Task 6: HTML template

**Files:**
- Create: `lib/pricelist/template.ts`
- Test: `lib/pricelist/template.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { buildHtml } from './template'
import { buildPages } from './layout'
import type { LineItem, PageSettings } from './types'

const s: PageSettings = {
  title: 'W&W', grouping: 'manual', showDividers: false, tierThresholds: [600, 1000],
  oddItemMode: 'solo-wide', headerContact: 'WhatsApp · Irina', vatNote: '7% VAT NOT INCLUDED',
  cardsPerPage: 14,
}
const items: LineItem[] = [
  { id: 'a', name: 'TENUTA MERLOT', price: 540, zone: 'red', country: 'ITALY', region: 'VENEZIA DOC', grape: 'MERLOT' },
  { id: 'b', name: 'PINOT GRIGIO', price: 540, zone: 'white', country: 'ITALY', grape: 'PINOT GRIGIO 100%' },
  { id: 'c', name: 'ARISTOV RIESLING', price: 610, zone: 'white', country: 'RUSSIA' },
]

describe('buildHtml', () => {
  const html = buildHtml({ pages: buildPages(items, s), settings: s })
  it('is a full document with the brand fonts', () => {
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('Bebas Neue')
  })
  it('renders the VAT footer and each wine name', () => {
    expect(html).toContain('7% VAT NOT INCLUDED')
    expect(html).toContain('TENUTA MERLOT')
    expect(html).toContain('ARISTOV RIESLING')
  })
  it('renders the price with a .- suffix', () => {
    expect(html).toContain('540')
    expect(html).toContain('.-')
  })
  it('renders a solo-wide card for the odd third item', () => {
    expect(html).toContain('card--wide')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/pricelist/template.test.ts`
Expected: FAIL — cannot find module `./template`.

- [ ] **Step 3: Write the implementation**

Build a self-contained HTML document. Keep all CSS inline in a `<style>` block. Match the reference: header band (contact + QR slot left, WINE & WHISKEY wordmark right), a grid of card rows, VAT footer. Plaque colours come from `zoneToken`; `sparkling` gets a bubble background layer. Image resolution (data URLs) is done by the render step and passed in via `imageDataUrls`; the template just references `imageUrl` or a placeholder.

```ts
import type { Page, PageSettings, LineItem, Row } from './types'
import { zoneToken, PLAQUE_LABELS } from './plaques'

export type BuildHtmlArgs = {
  pages: Page[]
  settings: PageSettings
  imageDataUrls?: Map<string, string> // key: imageSlug → data URL (render step)
  qrDataUrl?: string
  wordmarkDataUrl?: string
}

const A4 = { w: 794, h: 1123 } // px @ 96dpi

function esc(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
}

function priceHtml(p: number | null): string {
  if (p == null) return `<span class="price">—</span>`
  return `<span class="price">${p}<span class="price__suf">.-</span></span>`
}

function imgSrc(it: LineItem, images?: Map<string, string>): string {
  if (it.imageUrl) return it.imageUrl
  if (it.imageSlug && images?.get(it.imageSlug)) return images.get(it.imageSlug)!
  return '' // template shows the silhouette placeholder when empty
}

function cardHtml(it: LineItem, images: Map<string, string> | undefined, wide: boolean): string {
  const zone = it.zone
  const src = imgSrc(it, images)
  const meta = [
    it.country || it.region ? `<div class="meta"><span class="ico">🌍</span>${esc([it.country, it.region].filter(Boolean).join(', '))}</div>` : '',
    it.grape ? `<div class="meta"><span class="ico">🍇</span>${esc(it.grape)}</div>` : '',
    it.volume ? `<div class="meta"><span class="ico">🍾</span>${esc(it.volume)}</div>` : '',
  ].join('')
  return `
    <div class="card ${wide ? 'card--wide' : ''} zone--${zone}" style="--plaque:${zoneToken(zone)}">
      <div class="plaque"><span>${PLAQUE_LABELS[zone]}</span></div>
      <div class="bottle">${src ? `<img src="${src}" alt="">` : `<div class="bottle__ph"></div>`}</div>
      <div class="body">
        <div class="name">${esc(it.name)}</div>
        ${meta}
      </div>
      <div class="pricecol">${priceHtml(it.price)}</div>
    </div>`
}

function rowHtml(r: Row, images?: Map<string, string>): string {
  if (r.kind === 'divider') return `<div class="divider">${esc(r.label)}</div>`
  if (r.kind === 'solo-wide') return `<div class="row row--solo">${cardHtml(r.item, images, true)}</div>`
  const [a, b] = r.items
  return `<div class="row">${cardHtml(a, images, false)}${b ? cardHtml(b, images, false) : '<div class="card card--empty"></div>'}</div>`
}

function pageHtml(page: Page, s: PageSettings, isFirst: boolean, args: BuildHtmlArgs): string {
  const header = isFirst ? `
    <div class="header">
      <div class="header__left">
        ${args.qrDataUrl ? `<img class="qr" src="${args.qrDataUrl}" alt="">` : ''}
        <div class="cta"><div class="cta__t">PLACE AN ORDER ›</div><div class="cta__ru">СДЕЛАТЬ ЗАКАЗ</div><div class="cta__c">${esc(s.headerContact)}</div></div>
      </div>
      <div class="wordmark">${args.wordmarkDataUrl ? `<img src="${args.wordmarkDataUrl}" alt="WINE & WHISKEY">` : `<span class="wm1">WINE</span><span class="wm2">&amp; WHISKEY</span>`}</div>
    </div>` : ''
  return `<section class="page">${header}<div class="grid">${page.rows.map(r => rowHtml(r, args.imageDataUrls)).join('')}</div><div class="vat">${esc(s.vatNote)}</div></section>`
}

export function buildHtml(args: BuildHtmlArgs): string {
  const { pages, settings } = args
  const body = pages.map((p, i) => pageHtml(p, settings, i === 0, args)).join('')
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@500;700&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; }
  :root { --warm-white:#F5F0EB; --cream:#EDE0D0; --ink:#1A1A1A; --graphite:#3D3D3D; }
  body { font-family:'Inter',sans-serif; color:var(--ink); background:var(--warm-white); }
  .page { width:${A4.w}px; min-height:${A4.h}px; padding:28px 32px; display:flex; flex-direction:column; page-break-after:always; }
  .header { display:flex; justify-content:space-between; align-items:center; border:1px solid var(--ink); border-radius:14px; padding:14px 20px; margin-bottom:18px; }
  .header__left { display:flex; gap:14px; align-items:center; }
  .qr { width:56px; height:56px; }
  .cta__t { color:#8C1C1C; font-weight:700; font-size:13px; letter-spacing:.04em; }
  .cta__ru { font-weight:700; font-size:12px; }
  .cta__c { font-size:11px; color:var(--graphite); }
  .wordmark { text-align:right; line-height:.9; }
  .wm1 { font-family:'Bebas Neue'; color:#8C1C1C; font-size:34px; display:block; letter-spacing:.02em; }
  .wm2 { font-family:'Bebas Neue'; font-size:34px; display:block; }
  .grid { display:flex; flex-direction:column; gap:12px; flex:1; }
  .row { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  .row--solo { grid-template-columns:1fr; }
  .card { position:relative; display:grid; grid-template-columns:22px 78px 1fr auto; align-items:center; gap:10px;
          background:#fff; border:1px solid #E4DBCE; border-radius:14px; padding:10px 14px 10px 0; min-height:96px; }
  .card--wide { grid-template-columns:22px 100px 1fr auto; }
  .card--empty { visibility:hidden; }
  .plaque { background:var(--plaque); border-radius:14px 0 0 14px; height:100%; width:22px;
            display:flex; align-items:center; justify-content:center; }
  .plaque span { writing-mode:vertical-rl; transform:rotate(180deg); color:#fff; font-family:'DM Sans'; font-weight:700;
                 font-size:11px; letter-spacing:.14em; }
  .zone--sparkling .plaque { background:
      radial-gradient(circle at 30% 20%, rgba(255,255,255,.55) 2px, transparent 3px),
      radial-gradient(circle at 60% 60%, rgba(255,255,255,.45) 2.5px, transparent 3.5px),
      radial-gradient(circle at 40% 85%, rgba(255,255,255,.5) 2px, transparent 3px),
      var(--plaque); }
  .bottle { display:flex; align-items:center; justify-content:center; height:90px; }
  .bottle img { max-height:90px; max-width:100%; }
  .bottle__ph { width:30px; height:80px; border-radius:6px 6px 3px 3px; background:linear-gradient(#e9e2d6,#d8cdbc); }
  .name { font-family:'DM Sans'; font-weight:700; font-size:16px; text-transform:uppercase; line-height:1.05; }
  .meta { font-size:11px; color:var(--graphite); margin-top:4px; display:flex; gap:6px; align-items:center; }
  .meta .ico { opacity:.8; }
  .pricecol { padding-right:6px; }
  .price { font-family:'Bebas Neue'; font-size:46px; line-height:1; }
  .price__suf { font-size:22px; vertical-align:baseline; }
  .divider { font-family:'DM Sans'; font-weight:700; letter-spacing:.14em; text-transform:uppercase;
             font-size:13px; color:var(--graphite); padding:6px 2px 2px; border-bottom:2px solid var(--plaque,#8C1C1C); }
  .vat { text-align:center; font-family:'DM Sans'; font-weight:700; letter-spacing:.1em; font-size:13px; margin-top:16px; }
</style></head><body>${body}</body></html>`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/pricelist/template.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/pricelist/template.ts lib/pricelist/template.test.ts
git commit -m "feat(pricelist): HTML template — cards, plaques, header, VAT footer"
```

---

## Phase 2 — Import parser

### Task 7: CSV/Excel row mapping

**Files:**
- Create: `lib/pricelist/import.ts`
- Test: `lib/pricelist/import.test.ts`

The `xlsx` parse (file → array of raw row objects) happens in the API route; `import.ts` is the pure mapper over already-parsed rows so it is unit-testable without a file.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { rowsToLineItems, typeToZone } from './import'

describe('typeToZone', () => {
  it('maps synonyms to plaque zones', () => {
    expect(typeToZone('White')).toBe('white')
    expect(typeToZone('красное')).toBe('red')
    expect(typeToZone('sparkling')).toBe('sparkling')
    expect(typeToZone('игристое')).toBe('sparkling')
    expect(typeToZone('whisky')).toBe('spirits')
    expect(typeToZone('rosé')).toBe('rose')
  })
  it('defaults unknown to white', () => {
    expect(typeToZone('xyz')).toBe('white')
  })
})

describe('rowsToLineItems', () => {
  it('fuzzy-matches headers case-insensitively', () => {
    const { items } = rowsToLineItems([
      { Name: 'Merlot', Price: '540', Type: 'red', Country: 'Italy', Region: 'Venezia', Grape: 'Merlot' },
    ])
    expect(items[0]).toMatchObject({ name: 'Merlot', price: 540, zone: 'red', country: 'Italy', region: 'Venezia', grape: 'Merlot' })
  })
  it('flags rows missing name or price', () => {
    const { items, report } = rowsToLineItems([
      { name: '', price: '500' },
      { name: 'Ok', price: '' },
    ])
    expect(items).toHaveLength(2)
    expect(report.missingName).toBe(1)
    expect(report.missingPrice).toBe(1)
  })
  it('assigns stable ids', () => {
    const { items } = rowsToLineItems([{ name: 'A', price: '1' }, { name: 'B', price: '2' }])
    expect(items[0].id).not.toBe(items[1].id)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/pricelist/import.test.ts`
Expected: FAIL — cannot find module `./import`.

- [ ] **Step 3: Write the implementation**

```ts
import type { LineItem, PlaqueZone } from './types'

const ZONE_SYNONYMS: Record<string, PlaqueZone> = {
  white: 'white', biały: 'white', белое: 'white', белый: 'white', blanc: 'white', orange: 'white',
  red: 'red', красное: 'red', красный: 'red', rouge: 'red',
  sparkling: 'sparkling', игристое: 'sparkling', spumante: 'sparkling', champagne: 'sparkling',
  rose: 'rose', 'rosé': 'rose', розе: 'rose', розовое: 'rose',
  spirit: 'spirits', spirits: 'spirits', whisky: 'spirits', whiskey: 'spirits', vodka: 'spirits',
  крепкое: 'spirits', виски: 'spirits',
}

export function typeToZone(raw: string | undefined | null): PlaqueZone {
  const k = String(raw ?? '').trim().toLowerCase()
  return ZONE_SYNONYMS[k] ?? 'white'
}

// Header aliases → canonical field. Compared lower-cased/trimmed.
const HEADER_ALIASES: Record<string, keyof RawFields> = {
  name: 'name', наименование: 'name', вино: 'name', title: 'name',
  price: 'price', цена: 'price', thb: 'price',
  type: 'type', color: 'type', цвет: 'type', тип: 'type',
  country: 'country', страна: 'country',
  region: 'region', регион: 'region', appellation: 'region',
  grape: 'grape', сорт: 'grape', variety: 'grape',
  producer: 'producer', производитель: 'producer', winery: 'producer',
  volume: 'volume', объем: 'volume', 'объём': 'volume', size: 'volume',
  image: 'image', photo: 'image', url: 'image', фото: 'image',
}

type RawFields = {
  name?: string; price?: string; type?: string; country?: string;
  region?: string; grape?: string; producer?: string; volume?: string; image?: string
}

export type ImportReport = { total: number; missingName: number; missingPrice: number; matchedHeaders: string[] }

function normalizeRow(row: Record<string, unknown>): { fields: RawFields; matched: Set<string> } {
  const fields: RawFields = {}
  const matched = new Set<string>()
  for (const [key, val] of Object.entries(row)) {
    const canon = HEADER_ALIASES[key.trim().toLowerCase()]
    if (canon) { fields[canon] = val == null ? '' : String(val).trim(); matched.add(canon) }
  }
  return { fields, matched }
}

let counter = 0
function uid(): string { counter += 1; return `imp_${counter}_${Math.round(performance.now?.() ?? counter)}` }

export function rowsToLineItems(rows: Record<string, unknown>[]): { items: LineItem[]; report: ImportReport } {
  const items: LineItem[] = []
  const matchedHeaders = new Set<string>()
  let missingName = 0, missingPrice = 0

  for (const raw of rows) {
    const { fields, matched } = normalizeRow(raw)
    matched.forEach(m => matchedHeaders.add(m))
    const name = fields.name ?? ''
    const priceNum = fields.price ? Number(String(fields.price).replace(/[^\d.]/g, '')) : NaN
    if (!name) missingName += 1
    if (!fields.price || Number.isNaN(priceNum)) missingPrice += 1
    items.push({
      id: uid(),
      name,
      price: Number.isNaN(priceNum) ? null : priceNum,
      zone: typeToZone(fields.type),
      country: fields.country || undefined,
      region: fields.region || undefined,
      grape: fields.grape || undefined,
      producer: fields.producer || undefined,
      volume: fields.volume || undefined,
      imageUrl: fields.image || undefined,
    })
  }
  return { items, report: { total: rows.length, missingName, missingPrice, matchedHeaders: [...matchedHeaders] } }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/pricelist/import.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/pricelist/import.ts lib/pricelist/import.test.ts
git commit -m "feat(pricelist): CSV/Excel row → LineItem mapper"
```

---

## Phase 3 — Data access (catalog, store, render)

### Task 8: Catalog reader + enrichment join

**Files:**
- Create: `lib/pricelist/catalog.ts`

No unit test (thin Supabase wrapper — covered by the integration smoke in Task 14). Follow the read pattern from `app/russian-wine/page.tsx` and `lib/supabase.ts` clients.

- [ ] **Step 1: Write `catalog.ts`**

```ts
import { sbInventory, sbMarketing } from '@/lib/supabase'
import type { LineItem } from './types'
import { zoneFromWineColor } from './plaques'

export type CatalogRow = {
  code: string; name: string; price: number | null; zone: LineItem['zone']
  grape?: string; country?: string; region?: string; producer?: string; volume?: string
  onHand: number
}

// Reads inventory.v_sku_breakdown, left-joins marketing.sku_enrichment by
// loyverse_product_code so region/producer/volume prefill where known.
export async function readCatalog(): Promise<CatalogRow[]> {
  const { data: skus, error } = await sbInventory
    .from('v_sku_breakdown')
    .select('loyverse_product_code,name,wine_color,grape_variety,wine_country,default_price,on_hand')
  if (error) throw error

  const { data: enr } = await sbMarketing
    .from('sku_enrichment')
    .select('loyverse_product_code,region,producer,volume')
  const enrMap = new Map((enr ?? []).map(e => [e.loyverse_product_code, e]))

  return (skus ?? [])
    .filter(s => s.loyverse_product_code)
    .map(s => {
      const e = enrMap.get(s.loyverse_product_code)
      return {
        code: s.loyverse_product_code,
        name: s.name,
        price: s.default_price ?? null,
        zone: zoneFromWineColor(s.wine_color),
        grape: s.grape_variety ?? undefined,
        country: s.wine_country ?? undefined,
        region: e?.region ?? undefined,
        producer: e?.producer ?? undefined,
        volume: e?.volume ?? undefined,
        onHand: s.on_hand ?? 0,
      }
    })
}

// Turns a catalog row into a fresh LineItem for the working list.
export function catalogRowToLineItem(row: CatalogRow, id: string): LineItem {
  return {
    id, code: row.code, name: row.name, price: row.price, zone: row.zone,
    grape: row.grape, country: row.country, region: row.region,
    producer: row.producer, volume: row.volume,
    imageSlug: row.code, // 04_brand/products/<code>.png
  }
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run lint`
Expected: no errors from `lib/pricelist/catalog.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/pricelist/catalog.ts
git commit -m "feat(pricelist): catalog reader + enrichment join"
```

### Task 9: Saved-list + enrichment store

**Files:**
- Create: `lib/pricelist/store.ts`

- [ ] **Step 1: Write `store.ts`**

```ts
import { sbMarketing } from '@/lib/supabase'
import type { PriceListDoc, LineItem } from './types'

export type SavedList = { id: string; title: string; grouping: string; items: LineItem[]; settings: PriceListDoc['settings']; updated_at: string }

export async function listSaved(): Promise<Pick<SavedList, 'id' | 'title' | 'updated_at'>[]> {
  const { data, error } = await sbMarketing.from('price_lists')
    .select('id,title,updated_at').order('updated_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function getList(id: string): Promise<SavedList | null> {
  const { data, error } = await sbMarketing.from('price_lists').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data as SavedList | null
}

export async function createList(doc: PriceListDoc): Promise<string> {
  const { data, error } = await sbMarketing.from('price_lists')
    .insert({ title: doc.settings.title, grouping: doc.settings.grouping, items: doc.items, settings: doc.settings })
    .select('id').single()
  if (error) throw error
  return data.id
}

export async function updateList(id: string, doc: PriceListDoc): Promise<void> {
  const { error } = await sbMarketing.from('price_lists')
    .update({ title: doc.settings.title, grouping: doc.settings.grouping, items: doc.items, settings: doc.settings, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// Upsert region/producer/volume for every inventory-backed item that has them,
// so they prefill next time. Called on save.
export async function upsertEnrichment(items: LineItem[]): Promise<void> {
  const rows = items
    .filter(it => it.code && (it.region || it.producer || it.volume))
    .map(it => ({ loyverse_product_code: it.code!, region: it.region ?? null, producer: it.producer ?? null, volume: it.volume ?? null, updated_at: new Date().toISOString() }))
  if (!rows.length) return
  const { error } = await sbMarketing.from('sku_enrichment').upsert(rows, { onConflict: 'loyverse_product_code' })
  if (error) throw error
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/pricelist/store.ts
git commit -m "feat(pricelist): saved-list + enrichment store"
```

### Task 10: Render library (HTML → PNG pages + PDF)

**Files:**
- Create: `lib/pricelist/render.ts`

Reuse the browser launcher + product-image data-URL loader shape from `lib/promo/render.ts:29-82`. One A4 page → one PNG; assemble PNGs into a PDF with `pdf-lib`.

- [ ] **Step 1: Write `render.ts`**

```ts
import puppeteer, { type Browser } from 'puppeteer-core'
import chromium from '@sparticuz/chromium'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { buildHtml } from './template'
import { buildPages } from './layout'
import type { PriceListDoc } from './types'

const A4 = { width: 794, height: 1123 }

// ─── product image data URLs (mirrors lib/promo/render.ts) ───────────────
let cache: Map<string, string> | null = null
async function productMap(): Promise<Map<string, string>> {
  if (cache) return cache
  const root = path.join(process.cwd(), 'public', 'brand', 'products')
  const map = new Map<string, string>()
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    if (e.isFile() && e.name.toLowerCase().endsWith('.png')) map.set(e.name.replace(/\.png$/i, ''), path.join(root, e.name))
    else if (e.isDirectory()) {
      const inner = await readdir(path.join(root, e.name), { withFileTypes: true }).catch(() => [])
      for (const f of inner) if (f.isFile() && f.name.toLowerCase().endsWith('.png')) {
        const slug = f.name.replace(/\.png$/i, ''); if (!map.has(slug)) map.set(slug, path.join(root, e.name, f.name))
      }
    }
  }
  cache = map; return map
}
async function loadImages(slugs: string[]): Promise<Map<string, string>> {
  const paths = await productMap(); const out = new Map<string, string>()
  for (const slug of slugs) { const p = paths.get(slug); if (!p) continue; const buf = await readFile(p); out.set(slug, `data:image/png;base64,${buf.toString('base64')}`) }
  return out
}

async function launch(): Promise<Browser> {
  const local = process.env.PUPPETEER_EXECUTABLE_PATH
  if (local) return puppeteer.launch({ executablePath: local, headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
  return puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true })
}

export type RenderResult = { pngs: Buffer[]; pdf: Buffer }

export async function renderPricelist(doc: PriceListDoc): Promise<RenderResult> {
  const pages = buildPages(doc.items, doc.settings)
  const slugs = doc.items.map(i => i.imageSlug).filter(Boolean) as string[]
  const imageDataUrls = await loadImages(slugs)
  const html = buildHtml({ pages, settings: doc.settings, imageDataUrls })

  const browser = await launch()
  const pngs: Buffer[] = []
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: A4.width, height: A4.height, deviceScaleFactor: 2 })
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 })
    await page.evaluate(() => (document as Document & { fonts: { ready: Promise<unknown> } }).fonts.ready)
    const sections = await page.$$('section.page')
    for (const s of sections) pngs.push(Buffer.from(await s.screenshot({ type: 'png' })))
    await page.close().catch(() => {})
  } finally {
    await browser.close().catch(() => {})
  }

  const pdfDoc = await PDFDocument.create()
  for (const png of pngs) {
    const img = await pdfDoc.embedPng(png)
    const p = pdfDoc.addPage([A4.width, A4.height])
    p.drawImage(img, { x: 0, y: 0, width: A4.width, height: A4.height })
  }
  const pdf = Buffer.from(await pdfDoc.save())
  return { pngs, pdf }
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/pricelist/render.ts
git commit -m "feat(pricelist): puppeteer render — A4 PNG pages + PDF"
```

---

## Phase 4 — API routes

### Task 11: Catalog, import, lists, render routes

**Files:**
- Create: `app/api/m/pricelist/catalog/route.ts`
- Create: `app/api/m/pricelist/import/route.ts`
- Create: `app/api/m/pricelist/lists/route.ts`
- Create: `app/api/m/pricelist/lists/[id]/route.ts`
- Create: `app/api/m/pricelist/render/route.ts`

Follow the existing route style under `app/api/m/price/*` (Next route handlers returning `NextResponse.json`). Middleware already gates `/m/*` behind the password cookie, so no per-route auth.

- [ ] **Step 1: `catalog/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { readCatalog } from '@/lib/pricelist/catalog'
export const dynamic = 'force-dynamic'
export async function GET() {
  try { return NextResponse.json({ rows: await readCatalog() }) }
  catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
}
```

- [ ] **Step 2: `import/route.ts`** (parse the uploaded file with `xlsx`, map with `rowsToLineItems`)

```ts
import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { rowsToLineItems } from '@/lib/pricelist/import'
export const dynamic = 'force-dynamic'
export async function POST(req: Request) {
  try {
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof Blob)) return NextResponse.json({ error: 'no file' }, { status: 400 })
    const wb = XLSX.read(await file.arrayBuffer())
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
    return NextResponse.json(rowsToLineItems(rows))
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
}
```

- [ ] **Step 3: `lists/route.ts`** (GET index, POST create)

```ts
import { NextResponse } from 'next/server'
import { listSaved, createList, upsertEnrichment } from '@/lib/pricelist/store'
import type { PriceListDoc } from '@/lib/pricelist/types'
export const dynamic = 'force-dynamic'
export async function GET() {
  try { return NextResponse.json({ lists: await listSaved() }) }
  catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
}
export async function POST(req: Request) {
  try {
    const doc = (await req.json()) as PriceListDoc
    const id = await createList(doc)
    await upsertEnrichment(doc.items)
    return NextResponse.json({ id })
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
}
```

- [ ] **Step 4: `lists/[id]/route.ts`** (GET one, PUT update)

```ts
import { NextResponse } from 'next/server'
import { getList, updateList, upsertEnrichment } from '@/lib/pricelist/store'
import type { PriceListDoc } from '@/lib/pricelist/types'
export const dynamic = 'force-dynamic'
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try { const l = await getList(id); return l ? NextResponse.json(l) : NextResponse.json({ error: 'not found' }, { status: 404 }) }
  catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
}
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const doc = (await req.json()) as PriceListDoc
    await updateList(id, doc); await upsertEnrichment(doc.items)
    return NextResponse.json({ ok: true })
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
}
```

- [ ] **Step 5: `render/route.ts`** (returns the PDF; PNG pages base64 in JSON for the UI to offer as downloads)

```ts
import { NextResponse } from 'next/server'
import { renderPricelist } from '@/lib/pricelist/render'
import type { PriceListDoc } from '@/lib/pricelist/types'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
export async function POST(req: Request) {
  try {
    const doc = (await req.json()) as PriceListDoc
    const { pngs, pdf } = await renderPricelist(doc)
    return NextResponse.json({
      pdf: pdf.toString('base64'),
      pngs: pngs.map(p => p.toString('base64')),
    })
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
}
```

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: compiles; all five routes appear in the route list.

- [ ] **Step 7: Commit**

```bash
git add app/api/m/pricelist
git commit -m "feat(pricelist): API routes — catalog, import, lists, render"
```

---

## Phase 5 — UI + registry

### Task 12: Register the Marketing item + server page

**Files:**
- Modify: `lib/registry.ts` (marketing section `items` array, ~line 216, after `trendwatch`)
- Create: `app/(portal)/m/pricelist/page.tsx`

- [ ] **Step 1: Add the registry item**

In `lib/registry.ts`, inside the `marketing` section `items: [...]`, add after the `trendwatch` item:

```ts
      {
        slug: 'pricelist', name: 'Price Lists', icon: '🧾', status: 'building',
        description: 'Собери брендовый прайс из каталога/CSV/вручную → PNG + PDF.',
        route: m('pricelist'),
        embed: { kind: 'native' },
      },
```

- [ ] **Step 2: Write the server page**

```tsx
import { findItem } from '@/lib/registry'
import { PaneHeader } from '@/components/shell/PaneHeader'
import { readCatalog } from '@/lib/pricelist/catalog'
import { listSaved } from '@/lib/pricelist/store'
import { PricelistBuilderClient } from './PricelistBuilderClient'

export const dynamic = 'force-dynamic'

export default async function PricelistPage() {
  const item = findItem('pricelist')
  const [catalog, saved] = await Promise.all([
    readCatalog().catch(() => []),
    listSaved().catch(() => []),
  ])
  return (
    <div className="flex flex-col h-full">
      <PaneHeader item={item} />
      <PricelistBuilderClient catalog={catalog} saved={saved} />
    </div>
  )
}
```

- [ ] **Step 3: Verify the item shows in the sidebar**

Run: `npm run dev` and open `http://localhost:3003/m/pricelist` (with the password cookie). Expected: the page loads with the PaneHeader; sidebar shows "Price Lists" under Marketing. (Catalog may be empty until migration 035 is applied — that is fine.)

- [ ] **Step 4: Commit**

```bash
git add lib/registry.ts "app/(portal)/m/pricelist/page.tsx"
git commit -m "feat(pricelist): register Marketing item + server page"
```

### Task 13: Builder client + live preview

**Files:**
- Create: `app/(portal)/m/pricelist/PricelistBuilderClient.tsx`
- Create: `app/(portal)/m/pricelist/preview.tsx`

This is the interactive UI. Build it in labelled sub-steps; there is no unit test — verification is the manual walk-through in Task 14. Keep state in one `useReducer` over `PriceListDoc`. Use the pure `buildPages` + `buildHtml` for the live preview so preview and server render share one code path.

- [ ] **Step 1: Preview component** — renders template HTML into a scaled iframe.

```tsx
'use client'
import { useMemo } from 'react'
import { buildPages } from '@/lib/pricelist/layout'
import { buildHtml } from '@/lib/pricelist/template'
import type { PriceListDoc } from '@/lib/pricelist/types'

export function Preview({ doc }: { doc: PriceListDoc }) {
  const html = useMemo(() => buildHtml({ pages: buildPages(doc.items, doc.settings), settings: doc.settings }), [doc])
  return (
    <div className="flex-1 overflow-auto bg-neutral-100 p-4">
      <iframe title="preview" srcDoc={html} className="mx-auto block border shadow"
        style={{ width: 794, height: 1123, transform: 'scale(0.8)', transformOrigin: 'top center' }} />
    </div>
  )
}
```

> Note: the preview uses live Google Fonts and no product images (slugs resolve to data URLs only on the server). That is acceptable — it is a layout preview; the exported PNG/PDF is the source of truth for images.

- [ ] **Step 2: Builder shell** — three panes: catalog/sources (left), working list editor (center), preview (right). Sketch:

```tsx
'use client'
import { useReducer, useState } from 'react'
import { Preview } from './preview'
import type { PriceListDoc, LineItem, PageSettings, Grouping } from '@/lib/pricelist/types'
import type { CatalogRow } from '@/lib/pricelist/catalog'
import { catalogRowToLineItem } from '@/lib/pricelist/catalog'

const DEFAULT_SETTINGS: PageSettings = {
  title: 'Wine & Whiskey', grouping: 'type', showDividers: false, tierThresholds: [600, 1000],
  oddItemMode: 'solo-wide', headerContact: 'WhatsApp · Irina +66 93 914 0004',
  vatNote: '7% VAT NOT INCLUDED', cardsPerPage: 14,
}

type Action =
  | { t: 'add'; item: LineItem } | { t: 'remove'; id: string }
  | { t: 'update'; id: string; patch: Partial<LineItem> }
  | { t: 'reorder'; from: number; to: number }
  | { t: 'settings'; patch: Partial<PageSettings> }
  | { t: 'load'; doc: PriceListDoc }

function reducer(doc: PriceListDoc, a: Action): PriceListDoc {
  switch (a.t) {
    case 'add': return { ...doc, items: [...doc.items, a.item] }
    case 'remove': return { ...doc, items: doc.items.filter(i => i.id !== a.id) }
    case 'update': return { ...doc, items: doc.items.map(i => i.id === a.id ? { ...i, ...a.patch } : i) }
    case 'reorder': { const items = [...doc.items]; const [m] = items.splice(a.from, 1); items.splice(a.to, 0, m); return { ...doc, items } }
    case 'settings': return { ...doc, settings: { ...doc.settings, ...a.patch } }
    case 'load': return a.doc
  }
}

let uidN = 0
const uid = () => `ui_${++uidN}`

export function PricelistBuilderClient({ catalog, saved }: { catalog: CatalogRow[]; saved: { id: string; title: string; updated_at: string }[] }) {
  const [doc, dispatch] = useReducer(reducer, { settings: DEFAULT_SETTINGS, items: [] })
  const [rendering, setRendering] = useState(false)

  async function exportDoc() {
    setRendering(true)
    try {
      const res = await fetch('/api/m/pricelist/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc) })
      const { pdf, pngs, error } = await res.json()
      if (error) { alert(error); return }
      downloadB64(pdf, 'application/pdf', `${doc.settings.title}.pdf`)
      pngs.forEach((p: string, i: number) => downloadB64(p, 'image/png', `${doc.settings.title}-${i + 1}.png`))
    } finally { setRendering(false) }
  }

  return (
    <div className="flex flex-1 min-h-0">
      {/* LEFT: sources — catalog picker (search + filter), CSV upload, add-manual */}
      <aside className="w-72 border-r overflow-auto p-3">{/* Step 3 fills this */}</aside>
      {/* CENTER: working list editor + grouping controls */}
      <section className="w-96 border-r overflow-auto p-3">{/* Step 4 fills this */}
        <button disabled={rendering} onClick={exportDoc} className="btn-primary w-full mt-3">
          {rendering ? 'Rendering…' : 'Export PNG + PDF'}
        </button>
      </section>
      {/* RIGHT: live preview */}
      <Preview doc={doc} />
    </div>
  )
}

function downloadB64(b64: string, mime: string, filename: string) {
  const a = document.createElement('a')
  a.href = `data:${mime};base64,${b64}`; a.download = filename; a.click()
}
```

- [ ] **Step 3: Fill the LEFT pane** — three source tabs:
  1. **Catalog**: a search box + filter chips (zone/country) over `catalog`; each row has an "Add" button dispatching `{ t: 'add', item: catalogRowToLineItem(row, uid()) }`.
  2. **CSV/Excel**: a file input that POSTs to `/api/m/pricelist/import`, shows the `report` (matched headers, missing name/price counts), and an "Add all" button that dispatches one `add` per returned item (regenerate ids with `uid()`).
  3. **Manual**: a small form (name, price, zone) → `add`.

- [ ] **Step 4: Fill the CENTER pane** — the working list:
  - Grouping `<select>` bound to `settings.grouping` (`producer|type|region|tier|grape|curated|manual`).
  - `showDividers`, `oddItemMode`, `cardsPerPage`, `headerContact`, `vatNote`, `title` controls bound to `settings`.
  - The item list: each item a compact editable card (name, price, zone select, region, producer, volume, grape, country, rowLayout override), a remove button, and up/down reorder buttons dispatching `reorder`.
  - A "Save" button POSTing `doc` to `/api/m/pricelist/lists` (or PUT to `/lists/[id]` when editing a saved one) and a "Saved lists" dropdown from `saved` that GETs `/lists/[id]` and dispatches `{ t: 'load', doc }`.

- [ ] **Step 5: Verify the dev walk-through**

Run: `npm run dev`; open `/m/pricelist`. Add 3 catalog items (or manual ones if catalog empty) → the preview updates live → click Export → a PDF + PNG(s) download and match the preview.
Expected: works end-to-end locally (requires system Chrome + `PUPPETEER_EXECUTABLE_PATH`).

- [ ] **Step 6: Commit**

```bash
git add "app/(portal)/m/pricelist/PricelistBuilderClient.tsx" "app/(portal)/m/pricelist/preview.tsx"
git commit -m "feat(pricelist): builder UI — sources, editor, live preview, export"
```

---

## Phase 6 — Brand doc, end-to-end, swatch pick

### Task 14: Brand guideline doc

**Files:**
- Create: `04_brand/price-list.md` (repo root)

- [ ] **Step 1: Write the guideline** documenting: purpose; card anatomy (plaque → bottle → name → 🌍/🍇/🍾 meta → price with `.-`); the plaque zone system table (WHITE=amber-gold, RED=wine-red, SPARKLING=gold+bubbles, ROSÉ=rose-dust, SPIRITS=graphite); the 2-up grid + row layouts (pair/solo-wide/divider); typography (Bebas Neue prices, DM Sans names, Inter meta); header band (QR + contact + wordmark); VAT footer rule. Reference the source image `.inbox/WhatsApp Image 2026-07-25 at 10.49.05.jpeg` and note the generator lives at Marketing → Price Lists. Cross-link `docs/superpowers/specs/2026-07-25-pricelist-builder-design.md`.

- [ ] **Step 2: Commit**

```bash
git add ../../04_brand/price-list.md
git commit -m "docs(brand): price-list layout guideline"
```

### Task 15: Full suite + end-to-end + sparkling swatch pick

- [ ] **Step 1: Run the whole unit suite**

Run: `npm run test`
Expected: all `lib/pricelist/*.test.ts` pass alongside the existing suite (no regressions).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean build; `/m/pricelist` + the five API routes present.

- [ ] **Step 3: Sparkling swatch decision (visual)**

Render a one-page test list containing one item per zone (white, red, sparkling, rose, spirits) via the Export button. Produce a second variant with the sparkling plaque as a cool mint (`#8FBFB0`) instead of gold+bubbles. Show both to the user and let them pick; set `PLAQUE_TOKENS.sparkling` (and, if mint, drop the bubble CSS) to the chosen value. Commit the decision:

```bash
git add lib/pricelist/plaques.ts lib/pricelist/template.ts
git commit -m "feat(pricelist): finalize sparkling plaque per swatch pick"
```

- [ ] **Step 4: Handoff reminders to the user**
  - Apply migration `035_marketing_pricelist.sql` in the Supabase SQL Editor and add `marketing` to Exposed schemas.
  - Grant the relevant users the `marketing` section (or `pricelist` slug) in the Users admin.
  - Push to `main` to deploy (Railway auto-deploys).

---

## Self-review notes (author)

- **Spec coverage:** three sources (Task 13 §3), enrichment (Tasks 8/9), saved lists (Task 9), layout/row variants (Task 5), plaques incl. sparkling/rose (Tasks 4/15), render PNG+PDF (Task 10), registry/permissions (Task 12), brand doc (Task 14), migration 035 + sbMarketing + rose-dust token (Tasks 1/2). All spec sections map to a task.
- **Type consistency:** `LineItem`/`PageSettings`/`Row`/`Page`/`PriceListDoc` defined once in Task 3 and used verbatim thereafter; `buildPages(items, settings)` and `buildHtml({ pages, settings, imageDataUrls })` signatures are identical across layout, template, render, and preview; `zoneFromWineColor`/`zoneToken`/`PLAQUE_TOKENS` names consistent across plaques/catalog/template.
- **Known trade-off:** the live preview omits product images (server-only data URLs); called out inline in Task 13 §1 — exported PNG/PDF is the image source of truth.
