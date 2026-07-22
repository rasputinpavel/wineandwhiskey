# SMD Price-List Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bespoke price-list parser for the new supplier **SMD** so its two magazine-grid brochures (pouring wines + Grand Cru Classé 1855 Bordeaux) extract cleanly through the portal upload path.

**Architecture:** One new parser file `lib/price/parsers/smd.ts` modeled on `universal.ts` (one supplier, multiple catalogs, `detectVariant`) using the shared native-PDF path `callWithPdf` from `_shared.ts` (like `janhom.ts`). PDF pages are chunked 2-at-a-time and sent to Claude with a grid-aware prompt per variant; results are deduped and returned as `ExtractionResult`. The parser is registered in `parsers/index.ts`; the existing extraction route (`extract.ts` → `findMatchingParser`) does the rest.

**Tech Stack:** TypeScript, Next.js (mission-control), `@anthropic-ai/sdk` (via `_shared.callWithPdf`), `pdf-lib` + poppler (`pdftotext`) via `_shared`, vitest.

**Working directory for all paths & commands:** `02_services/mission-control/`

---

### Task 1: Pure detection logic (`detectVariant`) + `isSMD`, test-first

**Files:**
- Create: `02_services/mission-control/lib/price/parsers/smd.ts`
- Test: `02_services/mission-control/lib/price/parsers/smd.test.ts`

This task builds only the detection surface (pure `detectVariant`, plus `isSMD` and a `toIntPrice` helper). The heavy `parseSMD` body comes in Task 2. `detectVariant` and `toIntPrice` are pure → unit-tested; `isSMD` is tested on its filename fast-path (no real PDF needed — a non-matching filename with an empty buffer exercises the catch → `false`).

- [ ] **Step 1: Write the failing test**

Create `lib/price/parsers/smd.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { detectVariant, toIntPrice, isSMD } from './smd'

describe('detectVariant', () => {
  it('returns gcc1855 from the GCC filename', () => {
    expect(detectVariant('SMD_BROCHURE_GCC1855.pdf', '')).toBe('gcc1855')
  })
  it('returns gcc1855 from first-page text when filename is neutral', () => {
    expect(detectVariant('catalog.pdf', 'GRAND CRU CLASSÉ 1855 THE COMPLETE COLLECTION')).toBe('gcc1855')
  })
  it('defaults to wine', () => {
    expect(detectVariant('SMD_BROCHURE_WINE_JUL26.pdf', 'DARK HORSE POURING')).toBe('wine')
  })
})

describe('toIntPrice', () => {
  it('strips thousands separators to an integer', () => {
    expect(toIntPrice('9,400')).toBe(9400)
    expect(toIntPrice('410')).toBe(410)
  })
  it('rounds numbers and rejects junk', () => {
    expect(toIntPrice(360.4)).toBe(360)
    expect(toIntPrice('N/A')).toBeNull()
    expect(toIntPrice(null)).toBeNull()
  })
})

describe('isSMD', () => {
  it('matches on filename without reading the PDF', async () => {
    expect(await isSMD(Buffer.from(''), 'SMD_BROCHURE_WINE_JUL26.pdf')).toBe(true)
    expect(await isSMD(Buffer.from(''), 'gcc1855.pdf')).toBe(true)
  })
  it('returns false for a non-SMD filename with no readable PDF', async () => {
    expect(await isSMD(Buffer.from(''), 'random-supplier.pdf')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/price/parsers/smd.test.ts`
Expected: FAIL — cannot resolve `./smd` (module not created yet).

- [ ] **Step 3: Write minimal implementation**

Create `lib/price/parsers/smd.ts`:

```ts
// SMD (Smiling Dark Horse) — two magazine-grid brochures, one supplier:
//
//   WINE  (SMD_BROCHURE_WINE_JUL26.pdf, 14 pp) — "DARK HORSE POURING" pouring
//          wines. ~4 cards per row band; each card:
//          COUNTRY / PRODUCER (multiline) / appellation / grape composition /
//          YEAR / ABV% / PRICE (e.g. 330, 360, 410 THB).
//   GCC1855 (SMD_BROCHURE_GCC1855.pdf, 11 pp) — Grand Cru Classé 1855 Bordeaux.
//          Cover on p.1. Cards: CHÂTEAU / appellation / YEAR / PRICE (e.g.
//          9,400 → 9400). Section headers like "Second Growth".
//
// pdftotext -layout interleaves the grid columns, so we let Claude read each
// 2-page chunk of the PDF natively (callWithPdf) and reconstruct the cards.
// SKU is absent — items are deduped by (name, year, price).

import type { ExtractedItem, ExtractionResult } from '../claude'
import {
  writeTemp as writeTempShared, safeUnlink, pdftotextLayout,
  getPageCount, extractPdfPages, parseJson, callWithPdf, dedupBy,
} from './_shared'

const writeTemp = (buf: Buffer) => writeTempShared(buf, 'smd')

const SUPPLIER_NAME = 'SMD'

export type Variant = 'wine' | 'gcc1855'
type ProgressCb = (pct: number, phase?: string, itemCount?: number) => Promise<void> | void

const FILENAME_RE = /smd|dark[\s_-]?horse|gcc\s?1855/i
const CONTENT_RE = /SMILING\s+DARK\s+HORSE|DARK\s+HORSE\s+POURING|GRAND\s+CRU\s+CLASS[EÉ]\s+1855/i

// ─── Detection ─────────────────────────────────────────────────────────────

export async function isSMD(buf: Buffer, filename: string): Promise<boolean> {
  if (FILENAME_RE.test(filename)) return true
  const path = await writeTemp(buf)
  try {
    const text = await pdftotextLayout(path, 1, 1)
    return CONTENT_RE.test(text)
  } catch {
    return false
  } finally {
    safeUnlink(path)
  }
}

export function detectVariant(filename: string, firstPageText: string): Variant {
  if (/gcc|1855|grand\s+cru/i.test(filename) || /GRAND\s+CRU\s+CLASS[EÉ]\s+1855/i.test(firstPageText)) {
    return 'gcc1855'
  }
  return 'wine'
}

// ─── Helpers ───────────────────────────────────────────────────────────────

// Prices print as "410" or "9,400"; coerce to a bare integer THB.
export function toIntPrice(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null
  if (typeof v === 'string') {
    const digits = v.replace(/[^\d]/g, '')
    if (!digits) return null
    const n = parseInt(digits, 10)
    return Number.isFinite(n) ? n : null
  }
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/price/parsers/smd.test.ts`
Expected: PASS (3 suites, all green).

- [ ] **Step 5: Commit**

```bash
cd 02_services/mission-control
git add lib/price/parsers/smd.ts lib/price/parsers/smd.test.ts
git commit -m "feat(price): SMD parser — detection + price coercion (tested)"
```

---

### Task 2: `parseSMD` — chunked LLM extraction + grid prompts

**Files:**
- Modify: `02_services/mission-control/lib/price/parsers/smd.ts` (append `parseSMD` + two prompts)

No unit test here — `parseSMD` calls the Anthropic API. It is verified by the manual smoke run in Task 4. Follow the `janhom.ts` / `universal.ts` chunking pattern exactly.

- [ ] **Step 1: Append `parseSMD` to `lib/price/parsers/smd.ts`**

Add below `toIntPrice`:

```ts
// ─── Entry point ───────────────────────────────────────────────────────────

export async function parseSMD(
  buf: Buffer,
  filename: string,
  onProgress?: ProgressCb,
): Promise<ExtractionResult> {
  const totalPages = await getPageCount(buf)

  const path = await writeTemp(buf)
  let firstPage = ''
  try {
    firstPage = await pdftotextLayout(path, 1, 1)
  } finally {
    safeUnlink(path)
  }

  const variant = detectVariant(filename, firstPage)
  console.log(`[smd] ${variant} brochure (${totalPages} pages)`)
  await onProgress?.(5, `reading ${variant}`)

  const prompt = variant === 'gcc1855' ? GCC_PROMPT : WINE_PROMPT

  // 2 PDF pages per chunk. Cover / section-only pages yield [] via the prompt,
  // so we chunk from page 1 without guessing a start page.
  const chunks: { from: number; to: number }[] = []
  for (let p = 1; p <= totalPages; p += 2) {
    chunks.push({ from: p, to: Math.min(p + 1, totalPages) })
  }

  const PARALLEL = 5
  const all: ExtractedItem[] = []
  let done = 0

  for (let i = 0; i < chunks.length; i += PARALLEL) {
    const batch = chunks.slice(i, i + PARALLEL)
    const results = await Promise.all(
      batch.map(async (c) => {
        try {
          const chunkBuf = await extractPdfPages(buf, c.from, c.to)
          const raw = await callWithPdf(prompt, chunkBuf.toString('base64'))
          const parsed = parseJson<{ items: ExtractedItem[] }>(raw)
          const items = (parsed?.items ?? []).map((it) => ({
            ...it,
            price: toIntPrice(it.price),
            volume: it.volume || '750ml',
            category: 'wine' as const,
          }))
          console.log(`[smd] pages ${c.from}-${c.to} → ${items.length} items`)
          return items
        } catch (e) {
          console.error(`[smd] pages ${c.from}-${c.to} failed:`, e instanceof Error ? e.message : e)
          return [] as ExtractedItem[]
        }
      }),
    )
    results.forEach((items) => all.push(...items))
    done += batch.length
    const pct = 5 + Math.round((done / chunks.length) * 90)
    await onProgress?.(pct, `extracting ${done}/${chunks.length}`, all.length)
  }

  await onProgress?.(95, 'inserting')
  return {
    supplier_name: SUPPLIER_NAME,
    price_list_date: null,
    currency: 'THB',
    items: dedupBy(all, (it) => `${(it.name || '').toLowerCase().trim()}|${it.year ?? ''}|${it.price ?? ''}`),
  }
}

// ─── Prompts ───────────────────────────────────────────────────────────────

const WINE_PROMPT = `This is 1-2 pages of the SMD "DARK HORSE POURING" wine brochure — a
magazine grid of ~4 wine cards per row band. Each card is a vertical stack:

  COUNTRY            (e.g. AUSTRALIA, FRANCE, ITALY, PORTUGAL)
  PRODUCER / WINE    (one or more lines — brand then wine name)
  appellation/type   (e.g. BORDEAUX, CHIANTI DOCG, VIN DE FRANCE, WHITE/RED)
  grape composition  (e.g. "60% MERLOT, 40% CABERNET SAUVIGNON" or "PINOT GRIGIO")
  YEAR               (4-digit vintage, or absent for NV)
  ABV%               (e.g. 13.0%)
  PRICE              (a bare number like 330, 360, 410 — THB per bottle, VAT-exclusive)

For EACH card return ONE item:
{
  "name": "<producer + wine name joined, e.g. 'Grand Louis Bordeaux White'>",
  "country": "<canonical country from the card>",
  "region": "<appellation line, e.g. 'Bordeaux', 'Chianti DOCG', or null>",
  "grape_variety": "<the grape composition line, or null>",
  "year": <vintage integer, or null if NV>,
  "price": <integer THB from the price number>,
  "volume": "750ml",
  "wine_type": "red"|"white"|"rose"|"orange"|"sparkling"|null,
  "category": "wine",
  "spirit_type": null,
  "description": "<ABV if useful, max 120 chars, or null>"
}

Infer wine_type: sparkling for Spumante/Prosecco/Champagne/"Gran Cuvee"/"Extra Dry";
rose for "Rosé"/"Rosato"; white for white grapes or "WHITE"; red for red grapes or "RED".
Skip cover pages, section dividers, and any page with no price cards.
Return ONLY JSON: {"items": [...]}.`

const GCC_PROMPT = `This is 1-2 pages of the SMD "Grand Cru Classé 1855" fine-Bordeaux brochure —
a magazine grid of cards. Some pages are cover or section dividers (e.g.
"SECOND GROWTH / DEUXIÈME GRAND CRU CLASSÉ") with no prices — skip those.

Each priced card is a vertical stack:

  CHÂTEAU <name>      (may span multiple lines)
  appellation         (e.g. ST.JULIEN, PAUILLAC, MARGAUX, ST.ESTÈPHE)
  YEAR                (4-digit vintage)
  PRICE               (a number like 9,400 or 5,500 — THB per bottle, VAT-exclusive)

For EACH priced card return ONE item:
{
  "name": "<full château name, e.g. 'Château Ducru-Beaucaillou'>",
  "country": "France",
  "region": "<appellation, e.g. 'Saint-Julien', 'Pauillac', 'Margaux', 'Saint-Estèphe'>",
  "grape_variety": null,
  "year": <vintage integer>,
  "price": <integer THB, thousands separators removed (9,400 -> 9400)>,
  "volume": "750ml",
  "wine_type": "red",
  "category": "wine",
  "spirit_type": null,
  "description": "<growth classification if shown on the page, e.g. 'Second Growth', else null>"
}

Nearly all are red; use "white" only if the card clearly says a white wine.
Return ONLY JSON: {"items": [...]}.`
```

- [ ] **Step 2: Type-check the new code**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors introduced by `smd.ts`. (If the repo's `tsc` reports pre-existing unrelated errors, confirm none reference `parsers/smd.ts`.)

- [ ] **Step 3: Re-run the unit tests (regression)**

Run: `npx vitest run lib/price/parsers/smd.test.ts`
Expected: PASS (unchanged — the appended code doesn't alter Task 1 exports).

- [ ] **Step 4: Commit**

```bash
cd 02_services/mission-control
git add lib/price/parsers/smd.ts
git commit -m "feat(price): SMD parser — chunked LLM extraction + grid prompts"
```

---

### Task 3: Register the parser

**Files:**
- Modify: `02_services/mission-control/lib/price/parsers/index.ts`

- [ ] **Step 1: Add the import**

In `lib/price/parsers/index.ts`, add alongside the other parser imports (after the `isBoozia` import near line 31):

```ts
import { isSMD, parseSMD } from './smd'
```

- [ ] **Step 2: Add the `PARSERS[]` entry**

In the `PARSERS` array, add this entry in the "PDF: LLM-driven" block (e.g. after the `universal` entry, before the `// ── Excel ──` divider):

```ts
  {
    id: 'smd',
    fileTypes: ['pdf'],
    detect: (buf, fn) => isSMD(buf, fn),
    run: (buf, fn, _m, cb) => parseSMD(buf, fn, cb),
  },
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors; `smd` import resolves.

- [ ] **Step 4: Commit**

```bash
cd 02_services/mission-control
git add lib/price/parsers/index.ts
git commit -m "feat(price): register SMD parser in the parser registry"
```

---

### Task 4: Smoke-test against the real brochures (manual, one run)

**Files:**
- Reads (not committed): `.inbox/Suppliers/SMD/SMD_BROCHURE_WINE_JUL26.pdf`, `.inbox/Suppliers/SMD/SMD_BROCHURE_GCC1855.pdf`
- Requires: `ANTHROPIC_API_KEY` present in `02_services/mission-control/.env.local` (or the shell env).

This verifies the LLM path end-to-end. It is a one-off manual command, not a committed script (per repo tidiness — no probe files left behind).

- [ ] **Step 1: Run the parser against both PDFs**

From repo root, run:

```bash
cd 02_services/mission-control
npx tsx -e '
import { readFileSync } from "fs";
import { isSMD, parseSMD, detectVariant } from "./lib/price/parsers/smd";
const base = "../../.inbox/Suppliers/SMD/";
for (const f of ["SMD_BROCHURE_WINE_JUL26.pdf", "SMD_BROCHURE_GCC1855.pdf"]) {
  const buf = readFileSync(base + f);
  console.log("\n===", f, "detect:", await isSMD(buf, f), "===");
  const r = await parseSMD(buf, f, (p, ph) => console.log("  progress", p, ph));
  console.log("  supplier:", r.supplier_name, "| currency:", r.currency, "| items:", r.items.length);
  console.log("  sample:", JSON.stringify(r.items.slice(0, 3), null, 2));
}
'
```

- [ ] **Step 2: Verify the results by hand**

Confirm:
- `isSMD` is `true` for both files.
- WINE brochure returns **≥ ~150** items; GCC1855 returns **≥ ~30** items.
- Spot-check 2-3 known cards against the PDF: name, `year`, and `price` (integer THB, no commas) match; `volume` is `750ml`; `currency` is `THB`; `category` is `wine`.
- No item has a `price` that still contains a comma or non-numeric string.

If counts are far below expectation or fields are wrong, adjust the prompts in `smd.ts` (Task 2) and re-run Step 1 before proceeding. Record the observed counts in a one-line comment at the top of `smd.ts` (e.g. `// smoke 2026-07-22: wine=NNN, gcc1855=NN`).

- [ ] **Step 3: Commit the recorded counts (if the comment was added)**

```bash
cd 02_services/mission-control
git add lib/price/parsers/smd.ts
git commit -m "chore(price): record SMD smoke-test item counts"
```

---

### Task 5: Verify supplier resolution & finish

**Files:**
- Reads: `02_services/mission-control/app/api/m/price/price-lists/route.ts` (supplier find-or-create by slug)

- [ ] **Step 1: Confirm the slug is clean**

The upload route derives the supplier slug from `supplier_name` (`'SMD'` → `'smd'`) and find-or-creates the `suppliers` row. Check no conflicting `smd` slug already exists with a different display name:

```bash
cd 02_services/mission-control
grep -n "slug" app/api/m/price/price-lists/route.ts | head
```

Read the slug-derivation lines (around the `.from('suppliers').select('id').eq('slug', supplierSlug)` block) and confirm `'SMD'` normalizes to `'smd'`. If the store already has an `smd` supplier under a different name, note it — the row will be reused (name won't be overwritten), which is fine.

- [ ] **Step 2: Full test + type-check pass (regression gate)**

Run:
```bash
cd 02_services/mission-control
npx vitest run lib/price
npx tsc --noEmit -p tsconfig.json
```
Expected: price-suite tests PASS; no new type errors referencing `smd.ts`.

- [ ] **Step 3: Push (deploys to Railway on main)**

Confirm the branch with the user first (this repo auto-deploys `main` to Railway). If approved:

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey
git push origin <branch>
```

Then the user uploads both SMD PDFs through the portal price-list screen to confirm the live extraction.

---

## Self-Review

**Spec coverage:**
- New parser file `lib/price/parsers/smd.ts` → Tasks 1-2. ✓
- `isSMD` + `detectVariant` (filename + content) → Task 1. ✓
- Two variants `wine` / `gcc1855` with own prompts → Task 2. ✓
- Chunked `callWithPdf`, PARALLEL=5, dedup by name|year|price, progress 5→95 → Task 2. ✓
- Price = integer THB VAT-exclusive, thousands stripped; volume default 750ml → `toIntPrice` (Task 1) + map + prompts (Task 2). ✓
- Registration in `index.ts` → Task 3. ✓
- Supplier `SMD` / find-or-create by slug → Task 5. ✓
- Tests: unit (no API) + one smoke run → Task 1 (unit) + Task 4 (smoke). ✓
- Non-goals (reconciliation, deploy specifics) respected — no tasks touch reconcile or migrations. ✓

**Placeholder scan:** No TBD/TODO; all code shown in full; smoke command is concrete. ✓

**Type consistency:** `Variant`, `detectVariant`, `toIntPrice`, `isSMD`, `parseSMD`, `SUPPLIER_NAME` names identical across Tasks 1-3 and the test. `ExtractedItem`/`ExtractionResult` imported from `../claude` match the shape used in the route. ✓
