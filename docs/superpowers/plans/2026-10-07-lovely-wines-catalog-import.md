# Lovely Wines Catalog Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the 64-page Lovely Wines September 2026 catalog (~886 wine and spirits positions) into `wine_items` through the existing mission-control price pipeline, by adding one deterministic supplier parser.

**Architecture:** A new parser `lib/price/parsers/lovely.ts` registered in the `PARSERS` array. The parser runs `pdftotext -layout` once and hands the text to a pure function that reconstructs items from character-aligned tables. Cells are located by regex near the column anchors taken from each table's header line, never by slicing at a fixed offset. No LLM calls, no DB migration, no change to the shared upload route.

**Tech Stack:** TypeScript, Next.js (mission-control), vitest, poppler (`pdftotext`), pdf-lib (already dependencies of the service).

**Spec:** `docs/superpowers/specs/2026-10-07-lovely-wines-catalog-import-design.md`

---

## Background the engineer needs

All paths below are relative to `02_services/mission-control/`. Run every command from
that directory unless stated otherwise.

**How the pipeline works.** The user uploads a PDF at `/m/price`. The route
`app/api/m/price/price-lists/route.ts` finds the first parser in `lib/price/parsers/index.ts`
whose `detect()` returns true, calls its `run()`, and inserts the returned
`ExtractionResult.items` into the `wine_items` table. The route already coerces
illegal categories and fills missing ones, so the parser only needs to return clean
`ExtractedItem` objects. **Do not modify the route.**

**The `ExtractedItem` type** (`lib/price/claude.ts`, do not change it):

```ts
export type ExtractedItem = {
  name: string
  country: string | null
  region: string | null
  grape_variety: string | null
  price: number | null
  year: number | null
  volume: string | null
  description: string | null
  category: 'wine' | 'spirits' | 'beer' | 'other' | null
  wine_type: 'red' | 'white' | 'rose' | 'orange' | 'sparkling' | null
  spirit_type?: string | null
  supplier_sku?: string | null
}
```

**Shared helpers** available from `./_shared` (`lib/price/parsers/_shared.ts`):
`writeTemp(buf, prefix)`, `safeUnlink(path)`, `pdftotextLayout(path, fromPage, toPage)`
(where `toPage <= 0` means "to the end"), `getPageCount(buf)`.

**The source PDF** lives at `../../.inbox/Lovely Wines Catalog_Sep Claudio.pdf`
(repo root `.inbox/`). It is 64 A4 pages with a real text layer.

**What the catalog looks like.** Per page: a centred all-caps banner (category or
country), a left-indented sub-banner (region, or country on `SPIRITS` pages), a prose
paragraph about the producer, then one small table per producer whose header is
`Type   <BRAND>   Size   Alc%   [Vintage]   Price   Remark`. Glassware tables have
`Packing` / `Price/Pcs` instead and are skipped.

**Tests:** `npx vitest run lib/price/parsers/lovely.test.ts`. The project uses vitest 2.
Follow `lib/price/parsers/smd.test.ts` — it tests pure exported helpers, not live PDFs.

---

## File Structure

| File | Responsibility |
|---|---|
| Create: `lib/price/parsers/lovely.ts` | Detection, the pure text→items core, and the IO wrapper. One file, like every other parser (200–500 lines each). |
| Create: `lib/price/parsers/lovely.test.ts` | Unit tests for every pure helper plus the core run over the fixture. |
| Create: `lib/price/__fixtures__/lovely-pages.txt` | `pdftotext -layout` output of pages 2, 3, 9, 23, 31 — the five pages that between them contain every hard case. |
| Modify: `lib/price/parsers/index.ts` | One import line and one `PARSERS` entry. |
| Create: `../../07_contacts/partners/lovely-wines/profile.md` | Supplier card, including the retail/−20% fact. |

---

### Task 1: Fixture and detection

**Files:**
- Create: `lib/price/__fixtures__/lovely-pages.txt`
- Create: `lib/price/parsers/lovely.ts`
- Create: `lib/price/parsers/lovely.test.ts`

- [ ] **Step 1: Build the fixture from the real PDF**

Run from `02_services/mission-control/`:

```bash
PDF="../../.inbox/Lovely Wines Catalog_Sep Claudio.pdf"
: > lib/price/__fixtures__/lovely-pages.txt
for p in 2 3 9 23 31; do
  pdftotext -layout -f $p -l $p "$PDF" - >> lib/price/__fixtures__/lovely-pages.txt
done
wc -l lib/price/__fixtures__/lovely-pages.txt
```

Expected: a file of roughly 250–300 lines. Pages are separated by form feeds (`\f`),
which is what the parser splits on.

Sanity-check that all five hard cases made it in:

```bash
grep -c "ZALTO GLASPERFEKTION\|CANARD-DUCHÊNE\|MAISON GELAS\|CHATEAU LA PENSEE\|JAVELIER-LAURIN" lib/price/__fixtures__/lovely-pages.txt
```

Expected: `5`.

- [ ] **Step 2: Write the failing detection test**

Create `lib/price/parsers/lovely.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isLovely } from './lovely'

describe('isLovely', () => {
  it('matches on filename without reading the PDF', async () => {
    expect(await isLovely(Buffer.from(''), 'Lovely Wines Catalog_Sep Claudio.pdf')).toBe(true)
    expect(await isLovely(Buffer.from(''), 'lovely-sep.pdf')).toBe(true)
  })

  it('returns false for an unrelated filename with no readable PDF', async () => {
    expect(await isLovely(Buffer.from(''), 'random-supplier.pdf')).toBe(false)
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run lib/price/parsers/lovely.test.ts`
Expected: FAIL — `Failed to resolve import "./lovely"`.

- [ ] **Step 4: Create the parser file with detection only**

Create `lib/price/parsers/lovely.ts`:

```ts
// Lovely Wines Company Limited — Bangkok + Phuket importer, monthly catalog.
//
// One 64-page A4 PDF with a real text layer. Per page: a centred all-caps banner
// (category or country), a left-indented sub-banner (region, or the country on
// SPIRITS pages), a prose paragraph about the producer, then one small table per
// producer:
//
//   Type   <BRAND>   Size   Alc%   [Vintage]   Price   Remark
//
// Glassware tables print Packing / Price/Pcs instead and are skipped — they are
// not beverages.
//
// Why deterministic: measured on the September 2026 file, 946 of 947 size cells
// land within ±6 characters of their header's Size column, so the tables are
// genuinely character-aligned. An LLM pass would cost ~25 calls per upload and
// could misread a digit. Grape variety is the one field the tables never carry,
// and Vivino enrichment already fills it.
//
// Three typesetting traps, all verified against the real file:
//   1. Multi-size items put the product name vertically centred BETWEEN its
//      size/price rows, so the name line has neither a size nor a price.
//   2. Size cells can print up to 2 characters left of the Size label, so a hard
//      slice at the label cuts "1500ml" into "15" + "00ml" and the fragment ends
//      up inside the product name. Cells are therefore found by regex near the
//      anchor, not by slicing.
//   3. When a row carries a stock remark, pdftotext splits it: the type code sits
//      alone on one line and "low stock" / "out of stock" is rendered at the far
//      left edge, before the product name.
//
// Prices are RETAIL and VAT-exclusive ("NOTE : Prices are Vat Exclusive"); our
// purchase price is about 20% lower. We store the printed number verbatim, like
// every other parser — the discount lives in the supplier card at
// 07_contacts/partners/lovely-wines/profile.md.
//
// No supplier item codes anywhere except the Zalto glassware we skip, so
// supplier_sku stays null (same as Boozia and Richly).

import type { ExtractedItem, ExtractionResult } from '../claude'
import { writeTemp as writeTempShared, safeUnlink, pdftotextLayout } from './_shared'

const writeTemp = (buf: Buffer) => writeTempShared(buf, 'lovely')

const SUPPLIER_NAME = 'Lovely Wines Company Limited'

const FILENAME_RE = /lovely/i
const CONTENT_RE = /LOVELY\s+WINES\s+COMPANY\s+LIMITED|lovelywines\.co\.th/i

type ProgressCb = (pct: number, phase?: string, itemCount?: number) => Promise<void> | void

// ─── Detection ─────────────────────────────────────────────────────────────

export async function isLovely(buf: Buffer, filename: string): Promise<boolean> {
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
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npx vitest run lib/price/parsers/lovely.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/price/parsers/lovely.ts lib/price/parsers/lovely.test.ts lib/price/__fixtures__/lovely-pages.txt
git commit -m "Парсер Lovely Wines: детект и фикстура"
```

---

### Task 2: Price and catalog-date helpers

**Files:**
- Modify: `lib/price/parsers/lovely.ts`
- Modify: `lib/price/parsers/lovely.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `lib/price/parsers/lovely.test.ts`:

```ts
import { toIntPrice, catalogDate } from './lovely'

describe('toIntPrice', () => {
  it('strips thousands separators', () => {
    expect(toIntPrice('2,710')).toBe(2710)
    expect(toIntPrice('41,960')).toBe(41960)
    expect(toIntPrice('900')).toBe(900)
  })
  it('rejects empty and non-numeric cells', () => {
    expect(toIntPrice('')).toBeNull()
    expect(toIntPrice('N/A')).toBeNull()
    expect(toIntPrice('low stock')).toBeNull()
  })
})

describe('catalogDate', () => {
  it('reads the month from the filename and the year from ModDate', () => {
    expect(catalogDate('Lovely Wines Catalog_Sep Claudio.pdf', new Date('2026-09-01')))
      .toBe('2026-09-01')
  })
  it('prefers an explicit YYYY-MM in the filename', () => {
    expect(catalogDate('lovely-2026-11.pdf', new Date('2026-09-01'))).toBe('2026-11-01')
  })
  it('falls back to ModDate when the filename has no month', () => {
    expect(catalogDate('catalog.pdf', new Date('2026-09-01'))).toBe('2026-09-01')
  })
  it('returns null when there is nothing to go on', () => {
    expect(catalogDate('catalog.pdf', null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run lib/price/parsers/lovely.test.ts`
Expected: FAIL — `toIntPrice` and `catalogDate` are not exported.

- [ ] **Step 3: Implement both helpers**

Append to `lib/price/parsers/lovely.ts`:

```ts
// ─── Helpers ───────────────────────────────────────────────────────────────

// Prices print as "900" or "41,960"; coerce to bare integer THB. A cell holding
// anything else (empty, "N/A", a stray remark) means no price.
export function toIntPrice(cell: string): number | null {
  if (!/^[\d,]+$/.test(cell.trim())) return null
  const digits = cell.replace(/[^\d]/g, '')
  if (!digits) return null
  const n = parseInt(digits, 10)
  return Number.isFinite(n) ? n : null
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

// The catalog prints no date anywhere in its text layer, so derive one: an
// explicit YYYY-MM in the filename wins, then a month name in the filename with
// the year from the PDF's ModDate, then ModDate itself.
export function catalogDate(filename: string, modDate: Date | null): string | null {
  const iso = filename.match(/(20\d{2})[-_.](0[1-9]|1[0-2])/)
  if (iso) return `${iso[1]}-${iso[2]}-01`

  const word = filename.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i)
  if (word && modDate) {
    const month = String(MONTHS[word[1].toLowerCase()]).padStart(2, '0')
    return `${modDate.getUTCFullYear()}-${month}-01`
  }

  if (!modDate) return null
  const m = String(modDate.getUTCMonth() + 1).padStart(2, '0')
  const d = String(modDate.getUTCDate()).padStart(2, '0')
  return `${modDate.getUTCFullYear()}-${m}-${d}`
}
```

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run lib/price/parsers/lovely.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/price/parsers/lovely.ts lib/price/parsers/lovely.test.ts
git commit -m "Парсер Lovely Wines: цена и дата каталога"
```

---

### Task 3: The Type column vocabulary

The Type cell is not separated from the product name by a reliable gap — spirits
rows print `Armagnac Gelas, Bas Armagnac 8 Ans` with a single space. So it is matched
against a closed vocabulary, longest match first. Counts measured over all 921 data
rows: codes `R` 505, `W` 186, `SP` 26, `CP` 17, `RO` 9, `DW` 7, `FW` 3, `SW` 1,
`CP RO` 2, `SP RO` 2, `RO SP` 1; words `Whisky` 35, `Rum` 12, `Armagnac` 8,
`Cognac` 8, `Sherry` 6, `Calvados` 6, `Gin` 5, `Brandy` 5, `Fortified` 4, `Rhum` 3,
`Eau-de-Vie` 2, `Vermouth` 2, `Liqueur` 1, `Aperitif` 1, `Vodka` 1, `Ceylon` 1.

**Files:**
- Modify: `lib/price/parsers/lovely.ts`
- Modify: `lib/price/parsers/lovely.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `lib/price/parsers/lovely.test.ts`:

```ts
import { matchType } from './lovely'

describe('matchType', () => {
  it('reads wine colour codes', () => {
    expect(matchType("R           Blason d'Issan - Margaux")).toEqual({
      type: { category: 'wine', wineType: 'red', spiritType: null, note: null },
      rest: "Blason d'Issan - Margaux",
    })
    expect(matchType('W    Some White')?.type.wineType).toBe('white')
    expect(matchType('RO   Some Rose')?.type.wineType).toBe('rose')
    expect(matchType('SP   Some Sparkling')?.type.wineType).toBe('sparkling')
  })

  it('treats champagne as sparkling', () => {
    expect(matchType("CP     Canard Duchene Champagne 'Cuvee Leonie' Brut")?.type)
      .toEqual({ category: 'wine', wineType: 'sparkling', spiritType: null, note: 'Champagne' })
  })

  it('prefers the two-word code over its first word', () => {
    const m = matchType('CP RO Goutorbe-Bouillot Champagne Rose Brut')
    expect(m?.type.wineType).toBe('sparkling')
    expect(m?.type.note).toContain('Rosé')
    expect(m?.rest).toBe('Goutorbe-Bouillot Champagne Rose Brut')
  })

  it('keeps dessert and fortified codes as wine with no colour', () => {
    expect(matchType('DW   Tokaji Aszu')?.type)
      .toEqual({ category: 'wine', wineType: null, spiritType: null, note: 'Dessert wine' })
    expect(matchType('FW   Some Port')?.type.category).toBe('wine')
  })

  it('reads spirits words glued to the product name', () => {
    expect(matchType('Armagnac Gelas, Bas Armagnac 8 Ans')).toEqual({
      type: { category: 'spirits', wineType: null, spiritType: 'armagnac', note: null },
      rest: 'Gelas, Bas Armagnac 8 Ans',
    })
    expect(matchType('Eau-de-Vie Gelas, Vielle Eau De Vie De Prune')?.type.spiritType)
      .toBe('eau-de-vie')
    expect(matchType('Rhum     Arhumatic Punch Au Rhum')?.type.spiritType).toBe('rum')
    expect(matchType('Ceylon   Ceylon Arrack')?.type.spiritType).toBe('arrack')
  })

  it('keeps sherry and vermouth as wine, not spirits', () => {
    expect(matchType('Sherry   Lustau Amontillado')?.type)
      .toEqual({ category: 'wine', wineType: null, spiritType: null, note: 'Sherry' })
    expect(matchType('Vermouth Some Vermouth')?.type.category).toBe('wine')
  })

  it('returns null when nothing in the vocabulary matches', () => {
    expect(matchType('Domaine Philippe Cheron, Chambolle-Musigny')).toBeNull()
    expect(matchType('')).toBeNull()
  })
})
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run lib/price/parsers/lovely.test.ts`
Expected: FAIL — `matchType` is not exported.

- [ ] **Step 3: Implement the vocabulary**

Append to `lib/price/parsers/lovely.ts`:

```ts
// ─── The Type column ───────────────────────────────────────────────────────

export type TypeInfo = {
  category: ExtractedItem['category']
  wineType: ExtractedItem['wine_type']
  spiritType: string | null
  note: string | null
}

const wine = (wineType: TypeInfo['wineType'], note: string | null = null): TypeInfo =>
  ({ category: 'wine', wineType, spiritType: null, note })

const spirit = (spiritType: string): TypeInfo =>
  ({ category: 'spirits', wineType: null, spiritType, note: null })

// Sparkling rosé codes land under 'sparkling' — the word Rosé is already in every
// such product name, and the price browser is more useful with them grouped there.
const TYPES: Record<string, TypeInfo> = {
  'CP RO': wine('sparkling', 'Champagne, Rosé'),
  'SP RO': wine('sparkling', 'Rosé'),
  'RO SP': wine('sparkling', 'Rosé'),
  'R':  wine('red'),
  'W':  wine('white'),
  'RO': wine('rose'),
  'SP': wine('sparkling'),
  'CP': wine('sparkling', 'Champagne'),
  'DW': wine(null, 'Dessert wine'),
  'FW': wine(null, 'Fortified wine'),
  'SW': wine(null, 'Sweet wine'),
  // Fortified and aromatised wines stay wine — routing Lustau's sherries into
  // spirits would misfile them in the browser.
  'Sherry':     wine(null, 'Sherry'),
  'Vermouth':   wine(null, 'Vermouth'),
  'Fortified':  wine(null, 'Fortified wine'),
  'Whisky':     spirit('whisky'),
  'Rum':        spirit('rum'),
  'Rhum':       spirit('rum'),
  'Gin':        spirit('gin'),
  'Vodka':      spirit('vodka'),
  'Brandy':     spirit('brandy'),
  'Cognac':     spirit('cognac'),
  'Armagnac':   spirit('armagnac'),
  'Calvados':   spirit('calvados'),
  'Eau-de-Vie': spirit('eau-de-vie'),
  'Liqueur':    spirit('liqueur'),
  'Aperitif':   spirit('aperitif'),
  'Ceylon':     spirit('arrack'),   // "Ceylon Arrack"
}

// Longest key first so "CP RO" wins over "CP" and "Rhum" is never read as "R".
const TYPE_KEYS = Object.keys(TYPES).sort((a, b) => b.length - a.length)

// Splits the left-hand text of a row into its Type cell and the product name.
// Returns null when the text starts with something outside the vocabulary — that
// is a parser bug to surface, not a row to drop silently.
export function matchType(left: string): { type: TypeInfo; rest: string } | null {
  const text = left.trim()
  if (!text) return null
  for (const key of TYPE_KEYS) {
    if (!text.startsWith(key)) continue
    const rest = text.slice(key.length)
    // The key must be a whole cell, not the start of a longer word: "RO" must not
    // match "ROSSO", "R" must not match "Realm".
    if (rest && !/^[\s]/.test(rest)) continue
    return { type: TYPES[key], rest: rest.trim() }
  }
  return null
}
```

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run lib/price/parsers/lovely.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/price/parsers/lovely.ts lib/price/parsers/lovely.test.ts
git commit -m "Парсер Lovely Wines: словарь колонки Type"
```

---

### Task 4: Column anchors and windowed cell extraction

This is the task that decides whether prices come out right. Do not replace the
regex-near-anchor approach with slicing — the spec explains why.

**Files:**
- Modify: `lib/price/parsers/lovely.ts`
- Modify: `lib/price/parsers/lovely.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `lib/price/parsers/lovely.test.ts`:

```ts
import { columnAnchors, readRow } from './lovely'

const CANARD_HDR =
  ' Type                       CANARD-DUCHÊNE                                   Size           Alc%          Vintage          Price     Remark'
const GELAS_HDR =
  '  Type                                     MAISON GELAS                                      Size         Alc%         Price          Remark'
const GLASS_HDR =
  '   Type                                    CIGAR ASHTRAY            Size         Packing    Price/Pcs'

describe('columnAnchors', () => {
  it('reads every column of a wine table', () => {
    const a = columnAnchors(CANARD_HDR)
    expect(a).not.toBeNull()
    expect(a!.size).toBe(CANARD_HDR.indexOf('Size'))
    expect(a!.vintage).toBe(CANARD_HDR.indexOf('Vintage'))
    expect(a!.price).toBe(CANARD_HDR.indexOf('Price'))
  })

  it('accepts a spirits table with no Vintage column', () => {
    const a = columnAnchors(GELAS_HDR)
    expect(a!.vintage).toBeNull()
    expect(a!.price).toBe(GELAS_HDR.indexOf('Price'))
  })

  it('rejects glassware tables', () => {
    expect(columnAnchors(GLASS_HDR)).toBeNull()
  })

  it('rejects anything that is not a table header', () => {
    expect(columnAnchors('             CHAMPAGNE')).toBeNull()
    expect(columnAnchors('')).toBeNull()
  })
})

describe('readRow', () => {
  const a = columnAnchors(CANARD_HDR)!

  it('reads a complete row', () => {
    const row = readRow(' CP     Canard-Duchene Champagne Brut                                      750ml            12.0           2015            2,900', a)
    expect(row).toEqual({
      left: 'CP     Canard-Duchene Champagne Brut',
      size: '750ml',
      vintage: '2015',
      price: '2,900',
      remark: '',
    })
  })

  it('reads a variant row whose size prints left of the Size label', () => {
    const row = readRow('                                                                           1500ml                                          5,520', a)
    expect(row.left).toBe('')
    expect(row.size).toBe('1500ml')
    expect(row.price).toBe('5,520')
  })

  it('does not let the size bleed into the product name', () => {
    const row = readRow('                                                                            750ml                                          2,710', a)
    expect(row.left).toBe('')
    expect(row.size).toBe('750ml')
  })

  it('keeps NV out of the year and reads the remark', () => {
    const row = readRow(" CP     Canard Duchene Champagne Extra Brut 'P.181'                        750ml            12.0            NV             3,460     88 WE", a)
    expect(row.vintage).toBe('NV')
    expect(row.price).toBe('3,460')
    expect(row.remark).toBe('88 WE')
  })

  it('reads a row whose name is preceded by a stock remark', () => {
    const b = columnAnchors('  Type                                      JAVELIER-LAURIN                                       Size       Alc%         Vintage     Price   Remark')!
    const row = readRow('out of stock    Javelier-Laurin, Bourgogne Pinot Noir                                            750ml       13.0         2020       1,500', b)
    expect(row.left).toBe('out of stock    Javelier-Laurin, Bourgogne Pinot Noir')
    expect(row.price).toBe('1,500')
  })
})
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run lib/price/parsers/lovely.test.ts`
Expected: FAIL — `columnAnchors` and `readRow` are not exported.

- [ ] **Step 3: Implement anchors and row reading**

Append to `lib/price/parsers/lovely.ts`:

```ts
// ─── Table geometry ────────────────────────────────────────────────────────

export type Anchors = {
  size: number
  alc: number | null
  vintage: number | null
  price: number
  remark: number | null
}

export type Row = {
  left: string      // Type cell + product name, possibly prefixed by a stock remark
  size: string
  vintage: string
  price: string
  remark: string
}

const HEADER_RE = /^\s*(Type|CODE)\s{2,}/

// A header we can parse has Size and Price. Glassware tables carry Packing /
// Price/Pcs instead — those we refuse, which is how the block gets skipped.
export function columnAnchors(header: string): Anchors | null {
  if (!HEADER_RE.test(header)) return null
  if (/Packing|Price\/Pcs|Height\/Volume/.test(header)) return null

  const at = (label: string) => {
    const i = header.indexOf(label)
    return i === -1 ? null : i
  }
  const size = at('Size')
  const price = at('Price')
  if (size === null || price === null) return null

  return { size, alc: at('Alc%'), vintage: at('Vintage'), price, remark: at('Remark') }
}

// How far from an anchor a cell's text may start. Measured worst case on the real
// file is 2 characters (a right-shifted "1500ml"); 8 is comfortable margin that
// still cannot reach a neighbouring column.
const WINDOW = 8

// Finds the occurrence of `re` whose start is nearest to `anchor`, within WINDOW.
function near(line: string, re: RegExp, anchor: number | null): RegExpExecArray | null {
  if (anchor === null) return null
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
  let best: RegExpExecArray | null = null
  let bestDist = Infinity
  let m: RegExpExecArray | null
  while ((m = rx.exec(line)) !== null) {
    const dist = Math.abs(m.index - anchor)
    if (dist <= WINDOW && dist < bestDist) { best = m; bestDist = dist }
    if (m.index > anchor + WINDOW) break
  }
  return best
}

const SIZE_RE    = /\d{2,4}\s?(?:ml|ML|cl|CL|L)\b/
const PRICE_RE   = /\d{1,3}(?:,\d{3})+|\d{2,5}(?=\s|$)/
const VINTAGE_RE = /(?:19|20)\d{2}|NV/

// Reads one line of a table against that table's anchors. Everything left of the
// first located cell is the left-hand text; the remark is whatever trails the
// price. Cells are located by regex near their anchor, never by slicing at it —
// see the file header for why.
export function readRow(line: string, a: Anchors): Row {
  const sizeM    = near(line, SIZE_RE, a.size)
  const priceM   = near(line, PRICE_RE, a.price)
  const vintageM = near(line, VINTAGE_RE, a.vintage)

  const firstCell = Math.min(
    sizeM ? sizeM.index : Infinity,
    priceM ? priceM.index : Infinity,
    vintageM ? vintageM.index : Infinity,
  )
  const left = Number.isFinite(firstCell) ? line.slice(0, firstCell).trim() : line.trim()

  const afterPrice = priceM ? priceM.index + priceM[0].length : null
  const remark = afterPrice !== null ? line.slice(afterPrice).trim() : ''

  return {
    left,
    size: sizeM ? sizeM[0].replace(/\s+/g, '') : '',
    vintage: vintageM ? vintageM[0] : '',
    price: priceM ? priceM[0] : '',
    remark,
  }
}
```

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run lib/price/parsers/lovely.test.ts`
Expected: PASS, 24 tests.

If `readRow` returns a price where the test expects a vintage (or the reverse), the
nearest-anchor choice is working off the wrong anchor — check that `columnAnchors`
picked up `Vintage` for that header.

- [ ] **Step 5: Commit**

```bash
git add lib/price/parsers/lovely.ts lib/price/parsers/lovely.test.ts
git commit -m "Парсер Lovely Wines: геометрия таблицы и чтение строки"
```

---

### Task 5: Simple data rows into items

Start with the easy shape: a spirits table where every row is complete. Page 9 of the
fixture holds four such tables — Ron Barceló (10 rows), Maison Gelas (13), 30 & 40
(1), Arhumatic (3) — 27 items in total.

**Files:**
- Modify: `lib/price/parsers/lovely.ts`
- Modify: `lib/price/parsers/lovely.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `lib/price/parsers/lovely.test.ts`:

```ts
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseCatalogText } from './lovely'

const FIXTURE = readFileSync(join(__dirname, '../__fixtures__/lovely-pages.txt'), 'utf8')
// Fixture pages, in the order they were appended: 2, 3, 9, 23, 31.
const PAGES = FIXTURE.split('\f')
const page = (n: 2 | 3 | 9 | 23 | 31) => PAGES[[2, 3, 9, 23, 31].indexOf(n)]

describe('parseCatalogText — simple spirits rows', () => {
  const items = parseCatalogText(page(9))

  it('finds every row on the page', () => {
    expect(items).toHaveLength(27)
  })

  it('reads a plain rum row', () => {
    expect(items[0]).toMatchObject({
      name: 'Ron Barcelo Blanco Anejado',
      volume: '700ml',
      price: 1300,
      category: 'spirits',
      spirit_type: 'rum',
      year: null,
      grape_variety: null,
      supplier_sku: null,
    })
  })

  it('strips the Type word off a name it was glued to', () => {
    const armagnac = items.find(i => i.name === 'Gelas, Bas Armagnac 8 Ans')
    expect(armagnac).toBeDefined()
    expect(armagnac!.price).toBe(3125)
    expect(armagnac!.spirit_type).toBe('armagnac')
  })

  it('reads the five-figure price without losing a digit', () => {
    const ans60 = items.find(i => i.name === 'Gelas, Bas Armagnac 60 Ans')
    expect(ans60!.price).toBe(41960)
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run lib/price/parsers/lovely.test.ts`
Expected: FAIL — `parseCatalogText` is not exported.

- [ ] **Step 3: Implement the block walker for complete rows**

Append to `lib/price/parsers/lovely.ts`. This is the first cut — Tasks 6, 7 and 8 extend
the same function, so keep the structure open:

```ts
// ─── Text → items ──────────────────────────────────────────────────────────

type Block = { anchors: Anchors; lines: string[] }

// Splits a page into its producer tables. Lines before the first header (banners,
// prose) and tables we refuse (glassware) are dropped here.
function blocksOf(pageText: string): Block[] {
  const lines = pageText.split('\n')
  const blocks: Block[] = []
  let current: Block | null = null
  for (const line of lines) {
    if (HEADER_RE.test(line)) {
      const anchors = columnAnchors(line)
      current = anchors ? { anchors, lines: [] } : null
      if (current) blocks.push(current)
      continue
    }
    if (current) current.lines.push(line)
  }
  return blocks
}

function itemFrom(row: Row, type: TypeInfo, name: string): ExtractedItem {
  const year = /^(?:19|20)\d{2}$/.test(row.vintage) ? parseInt(row.vintage, 10) : null
  return {
    name,
    country: null,
    region: null,
    grape_variety: null,
    price: toIntPrice(row.price),
    year,
    volume: row.size || null,
    description: null,
    category: type.category,
    wine_type: type.wineType,
    spirit_type: type.spiritType,
    supplier_sku: null,
  }
}

export function parseCatalogText(text: string): ExtractedItem[] {
  const items: ExtractedItem[] = []
  for (const pageText of text.split('\f')) {
    for (const block of blocksOf(pageText)) {
      for (const line of block.lines) {
        if (!line.trim()) continue
        const row = readRow(line, block.anchors)
        if (!row.price && !row.size) continue
        const matched = matchType(row.left)
        if (!matched) continue
        items.push(itemFrom(row, matched.type, matched.rest))
      }
    }
  }
  return items
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run lib/price/parsers/lovely.test.ts`
Expected: PASS, 28 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/price/parsers/lovely.ts lib/price/parsers/lovely.test.ts
git commit -m "Парсер Lovely Wines: простые строки в позиции"
```

---

### Task 6: Multi-size items and the no-absorb rule

Page 3 holds the trap. Canard-Duchêne's `'Cuvee Leonie' Brut` has its name on a line
with no size and no price, with `750ml / 2,710` above it and `1500ml / 5,520` below.
Goutorbe-Bouillot has the same shape — and immediately after it a product that
carries its own `750ml / 2,570`. If a complete row absorbs its neighbours, that
second product silently takes 2,010, the previous item's price.

Page 3 contains 16 positions: Canard-Duchêne 5 (one of them two sizes),
Goutorbe-Bouillot 3 (one of them two sizes), Jean Yves de Carlini 2,
Pierre Moncuit 2, Paul Bara 4.

**Files:**
- Modify: `lib/price/parsers/lovely.ts`
- Modify: `lib/price/parsers/lovely.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `lib/price/parsers/lovely.test.ts`:

```ts
describe('parseCatalogText — multi-size items', () => {
  const items = parseCatalogText(page(3))

  it('finds every position on the champagne page', () => {
    expect(items).toHaveLength(16)
  })

  it('splits a two-size item into two positions', () => {
    const leonie = items.filter(i => i.name === "Canard Duchene Champagne 'Cuvee Leonie' Brut")
    expect(leonie).toHaveLength(2)
    expect(leonie.map(i => [i.volume, i.price])).toEqual([
      ['750ml', 2710],
      ['1500ml', 5520],
    ])
  })

  it('does not let a complete row steal a neighbour variant', () => {
    const leRu = items.find(i => i.name!.includes("Le Ru Des Charmes"))
    expect(leRu!.price).toBe(2570)
    expect(leRu!.volume).toBe('750ml')
  })

  it('keeps both sizes of the Goutorbe cuvée with their own prices', () => {
    const reflets = items.filter(i => i.name!.includes('Reflets De Riviere'))
    expect(reflets.map(i => [i.volume, i.price])).toEqual([
      ['375ml', 1440],
      ['750ml', 2010],
    ])
  })

  it('reads the vintage and leaves NV null', () => {
    expect(items.find(i => i.name === 'Canard-Duchene Champagne Brut')!.year).toBe(2015)
    expect(items.find(i => i.name!.includes("'P.181'"))!.year).toBeNull()
  })

  it('files champagne as sparkling wine', () => {
    expect(items.every(i => i.category === 'wine')).toBe(true)
    expect(items.every(i => i.wine_type === 'sparkling')).toBe(true)
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run lib/price/parsers/lovely.test.ts`
Expected: FAIL — length is 13, not 16 (the three variant rows are dropped because
they have no Type cell).

- [ ] **Step 3: Rewrite the block walker in two passes**

Replace the `parseCatalogText` function in `lib/price/parsers/lovely.ts` with:

```ts
type Slot =
  | { kind: 'item'; row: Row; type: TypeInfo; name: string; variants: Row[] }
  | { kind: 'variant'; row: Row }
  | { kind: 'other'; line: string }

function classify(line: string, anchors: Anchors): Slot {
  const row = readRow(line, anchors)
  const hasCells = Boolean(row.price || row.size)
  if (!hasCells) return { kind: 'other', line }
  if (!row.left) return { kind: 'variant', row }
  const matched = matchType(row.left)
  if (!matched) return { kind: 'other', line }
  return { kind: 'item', row, type: matched.type, name: matched.rest, variants: [] }
}

// A nameless item — name typeset between its size rows — collects the contiguous
// variant rows directly above and below it. An item that already carries its own
// size and price collects nothing: otherwise it steals the previous item's
// variant, which puts a wrong price in the database with no visible symptom.
function attachVariants(slots: Slot[]): void {
  slots.forEach((slot, i) => {
    if (slot.kind !== 'item') return
    if (slot.row.size && slot.row.price) return

    for (let j = i - 1; j >= 0 && slots[j].kind === 'variant'; j--) {
      slot.variants.unshift((slots[j] as { row: Row }).row)
      slots[j] = { kind: 'other', line: '' }
    }
    for (let j = i + 1; j < slots.length && slots[j].kind === 'variant'; j++) {
      slot.variants.push((slots[j] as { row: Row }).row)
      slots[j] = { kind: 'other', line: '' }
    }
  })
}

export function parseCatalogText(text: string): ExtractedItem[] {
  const items: ExtractedItem[] = []
  for (const pageText of text.split('\f')) {
    for (const block of blocksOf(pageText)) {
      const slots = block.lines
        .filter(l => l.trim())
        .map(l => classify(l, block.anchors))
      attachVariants(slots)

      for (const slot of slots) {
        if (slot.kind !== 'item') continue
        const rows = slot.variants.length > 0 ? slot.variants : [slot.row]
        for (const row of rows) {
          // A variant row carries its own size, price and remark, but the vintage
          // and everything else comes from the name row.
          const merged: Row = { ...row, vintage: row.vintage || slot.row.vintage }
          items.push(itemFrom(merged, slot.type, slot.name))
        }
      }
    }
  }
  return items
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run lib/price/parsers/lovely.test.ts`
Expected: PASS, 34 tests — page 9's 27 items must still be 27.

- [ ] **Step 5: Commit**

```bash
git add lib/price/parsers/lovely.ts lib/price/parsers/lovely.test.ts
git commit -m "Парсер Lovely Wines: мультиобъём без воровства цены у соседа"
```

---

### Task 7: Stock remarks and code-only lines

Page 31's Javelier-Laurin table has all four shapes of this trap:

```
     R
out of stock    Javelier-Laurin, Bourgogne Pinot Noir      750ml  13.0  2020   1,500
     R
low stock       Javelier-Laurin, Gevrey-Chambertin 'Les Champs Chenys'  750ml 13.0 2019 4,490
     R
low stock
                Javelier-Laurin, Gevrey-Chambertin 1er Cru 'Bel Air'    750ml 13.0 2020 5,900
     R
out of stock
                Javelier-Laurin, Ruchottes-Chambertin Grand Cru         750ml 13.5 2017 12,150
```

The type code sits alone on its own line; the stock remark is rendered at the far
left, sometimes before the name on the same line and sometimes on its own line.
Page 23 has the single-table version with `Chateau La Pensee`.

**Files:**
- Modify: `lib/price/parsers/lovely.ts`
- Modify: `lib/price/parsers/lovely.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `lib/price/parsers/lovely.test.ts`:

```ts
describe('parseCatalogText — stock remarks', () => {
  it('reads all four Javelier-Laurin wines with clean names', () => {
    const items = parseCatalogText(page(31))
      .filter(i => i.name!.startsWith('Javelier-Laurin'))
    expect(items.map(i => [i.name, i.price])).toEqual([
      ['Javelier-Laurin, Bourgogne Pinot Noir', 1500],
      ["Javelier-Laurin, Gevrey-Chambertin 'Les Champs Chenys'", 4490],
      ["Javelier-Laurin, Gevrey-Chambertin 1er Cru 'Bel Air'", 5900],
      ['Javelier-Laurin, Ruchottes-Chambertin Grand Cru', 12150],
    ])
  })

  it('keeps the stock state in the description, never in the name', () => {
    const items = parseCatalogText(page(31))
    expect(items.some(i => /stock/i.test(i.name!))).toBe(false)
    const bourgogne = items.find(i => i.name === 'Javelier-Laurin, Bourgogne Pinot Noir')
    expect(bourgogne!.description).toContain('out of stock')
    expect(bourgogne!.wine_type).toBe('red')
  })

  it('reads the page-23 row whose remark precedes the name', () => {
    const pensee = parseCatalogText(page(23))
      .find(i => i.name === 'Chateau La Pensee Lalande de Pomerol')
    expect(pensee).toBeDefined()
    expect(pensee!.price).toBe(1450)
    expect(pensee!.year).toBe(2020)
    expect(pensee!.description).toContain('low stock')
  })

  it('keeps ratings that bracket a product name', () => {
    const reserve = parseCatalogText(page(3))
      .find(i => i.name!.includes("'Reserve Brut'"))
    expect(reserve!.description).toContain('91 WS')
    expect(reserve!.description).toContain('90 VN')
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run lib/price/parsers/lovely.test.ts`
Expected: FAIL — names still carry `out of stock`, and the bracketing ratings are lost.

- [ ] **Step 3: Handle stock prefixes, pending codes and pending remarks**

In `lib/price/parsers/lovely.ts`, add the recognisers next to `matchType`:

```ts
const STOCK_RE  = /^(out of stock|low stock|stock)\s+/i
const RATING_RE = /^\d{2,3}\s?(WS|WE|JS|VN|RP|JD|D|TA|AG|WA)$/i

// A line that is nothing but a type code belongs to the next data line.
export function codeOnly(line: string): TypeInfo | null {
  const t = line.trim()
  if (!t || /\d/.test(t)) return null
  const m = matchType(t)
  return m && m.rest === '' ? m.type : null
}

// A line that is nothing but a remark: a critic score or a stock state.
export function remarkOnly(line: string): string | null {
  const t = line.trim()
  if (!t) return null
  if (RATING_RE.test(t)) return t
  if (/^(out of stock|low stock|stock)$/i.test(t)) return t
  return null
}

// "out of stock    Javelier-Laurin, Bourgogne Pinot Noir" → the stock state is a
// remark rendered at the left edge, not part of the product name.
export function splitStockPrefix(left: string): { stock: string | null; rest: string } {
  const m = left.match(STOCK_RE)
  if (!m) return { stock: null, rest: left }
  return { stock: m[1], rest: left.slice(m[0].length).trim() }
}
```

Then extend `classify`, `attachVariants` and `parseCatalogText`. Replace the three of
them with:

```ts
type Slot =
  | { kind: 'item'; row: Row; type: TypeInfo; name: string; variants: Row[]; remarks: string[] }
  | { kind: 'variant'; row: Row }
  | { kind: 'code'; type: TypeInfo }
  | { kind: 'remark'; text: string }
  | { kind: 'other'; line: string }

function classify(line: string, anchors: Anchors): Slot {
  const code = codeOnly(line)
  if (code) return { kind: 'code', type: code }

  const remark = remarkOnly(line)
  if (remark) return { kind: 'remark', text: remark }

  const row = readRow(line, anchors)
  if (!row.price && !row.size) return { kind: 'other', line }
  if (!row.left) return { kind: 'variant', row }

  const { stock, rest } = splitStockPrefix(row.left)
  const remarks = stock ? [stock] : []

  // With a stock prefix the type code was printed on its own line, so the
  // left-hand text starts at the product name and matchType finds nothing.
  const matched = matchType(rest)
  if (matched) {
    return { kind: 'item', row, type: matched.type, name: matched.rest, variants: [], remarks }
  }
  return { kind: 'item', row, type: PENDING_TYPE, name: rest, variants: [], remarks }
}

// Placeholder for a row whose type code arrived on an earlier line; resolved in
// parseCatalogText. Never emitted: a row that reaches the end still holding it is
// a parser bug the coverage check must catch.
const PENDING_TYPE: TypeInfo = { category: null, wineType: null, spiritType: null, note: null }

function attachVariants(slots: Slot[]): void {
  const isVariant = (s: Slot) => s.kind === 'variant'
  slots.forEach((slot, i) => {
    if (slot.kind !== 'item') return
    if (slot.row.size && slot.row.price) return

    for (let j = i - 1; j >= 0 && isVariant(slots[j]); j--) {
      slot.variants.unshift((slots[j] as { row: Row }).row)
      slots[j] = { kind: 'other', line: '' }
    }
    for (let j = i + 1; j < slots.length && isVariant(slots[j]); j++) {
      slot.variants.push((slots[j] as { row: Row }).row)
      slots[j] = { kind: 'other', line: '' }
    }
  })
}

// Remark-only lines are typeset vertically centred on their product, so one can sit
// above its name row and another below. Both belong to that product: attach to the
// nearest item slot, preferring the one above.
function attachRemarks(slots: Slot[]): void {
  slots.forEach((slot, i) => {
    if (slot.kind !== 'remark') return
    let target: Slot | undefined
    for (let j = i - 1; j >= 0; j--) {
      if (slots[j].kind === 'item') { target = slots[j]; break }
      if (slots[j].kind === 'remark') continue
      if (slots[j].kind === 'code') continue
      break
    }
    if (!target) {
      for (let j = i + 1; j < slots.length; j++) {
        if (slots[j].kind === 'item') { target = slots[j]; break }
        if (slots[j].kind === 'remark' || slots[j].kind === 'code') continue
        break
      }
    }
    if (target && target.kind === 'item') target.remarks.push(slot.text)
    slots[i] = { kind: 'other', line: '' }
  })
}

// A code-only line supplies the type for the next item slot that has none.
function attachCodes(slots: Slot[]): void {
  let pending: TypeInfo | null = null
  for (const slot of slots) {
    if (slot.kind === 'code') { pending = slot.type; continue }
    if (slot.kind === 'item' && slot.type === PENDING_TYPE && pending) {
      slot.type = pending
      pending = null
    }
  }
}

export function parseCatalogText(text: string): ExtractedItem[] {
  const items: ExtractedItem[] = []
  for (const pageText of text.split('\f')) {
    for (const block of blocksOf(pageText)) {
      const slots = block.lines
        .filter(l => l.trim())
        .map(l => classify(l, block.anchors))

      attachCodes(slots)
      attachVariants(slots)
      attachRemarks(slots)

      for (const slot of slots) {
        if (slot.kind !== 'item') continue
        const rows = slot.variants.length > 0 ? slot.variants : [slot.row]
        for (const row of rows) {
          const merged: Row = { ...row, vintage: row.vintage || slot.row.vintage }
          const item = itemFrom(merged, slot.type, slot.name)
          const notes = [
            slot.type.note,
            ...slot.remarks,
            merged.remark || null,
          ].filter(Boolean)
          item.description = notes.length ? notes.join(' · ') : null
          items.push(item)
        }
      }
    }
  }
  return items
}
```

Note the ordering: `attachCodes` must run before `attachVariants`, because a
code-only line sitting between a variant row and its name row would otherwise break
the contiguity test.

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run lib/price/parsers/lovely.test.ts`
Expected: PASS, 38 tests. Pages 3 and 9 must still yield 16 and 27 items.

- [ ] **Step 5: Commit**

```bash
git add lib/price/parsers/lovely.ts lib/price/parsers/lovely.test.ts
git commit -m "Парсер Lovely Wines: пометки об остатке и код типа отдельной строкой"
```

---

### Task 8: Page context — country, region, producer description

Country and region come from the banners, not from the table. `CHAMPAGNE` means
France, `PROSECCO` means Italy, `CAVA` means Spain; on `SPIRITS` pages the country is
the sub-banner (`DOMINICAN REPUBLIC`). Banners print in caps and must be title-cased
before they reach the UI.

**Files:**
- Modify: `lib/price/parsers/lovely.ts`
- Modify: `lib/price/parsers/lovely.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `lib/price/parsers/lovely.test.ts`:

```ts
import { titleCase } from './lovely'

describe('titleCase', () => {
  it('turns banner caps into readable text', () => {
    expect(titleCase('ARGENTINA')).toBe('Argentina')
    expect(titleCase('CÔTE DE NUITS, BURGUNDY')).toBe('Côte De Nuits, Burgundy')
    expect(titleCase('DOMINICAN REPUBLIC')).toBe('Dominican Republic')
  })
})

describe('parseCatalogText — context', () => {
  it('maps the champagne banner to France', () => {
    const items = parseCatalogText(page(3))
    expect(items.every(i => i.country === 'France')).toBe(true)
  })

  it('takes the country from the sub-banner on spirits pages', () => {
    const items = parseCatalogText(page(9))
    expect(items.find(i => i.name === 'Ron Barcelo Blanco Anejado')!.country)
      .toBe('Dominican Republic')
    expect(items.find(i => i.name === 'Gelas, Bas Armagnac 8 Ans')!.country).toBe('France')
  })

  it('reads country and region on a wine page', () => {
    const items = parseCatalogText(page(31))
    const javelier = items.find(i => i.name === 'Javelier-Laurin, Bourgogne Pinot Noir')!
    expect(javelier.country).toBe('France')
    expect(javelier.region).toBe('Côte De Nuits, Burgundy')
  })

  it('carries the producer paragraph into the description', () => {
    const items = parseCatalogText(page(9))
    const barcelo = items.find(i => i.name === 'Ron Barcelo Blanco Anejado')!
    expect(barcelo.description).toContain('leading rum producers in the Dominican Republic')
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run lib/price/parsers/lovely.test.ts`
Expected: FAIL — `titleCase` is not exported and `country` is `null` everywhere.

- [ ] **Step 3: Implement context tracking**

In `lib/price/parsers/lovely.ts`, add above `blocksOf`:

```ts
// ─── Page context ──────────────────────────────────────────────────────────

export function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s,\-'/])([a-zà-ÿ])/g, (_, sep, ch) => sep + ch.toUpperCase())
}

// Category banners that imply a country of their own.
const BANNER_COUNTRY: Record<string, string> = {
  CHAMPAGNE: 'France',
  'FRENCE SPARKLING': 'France',
  PROSECCO: 'Italy',
  CAVA: 'Spain',
  'SPANISH CAVA': 'Spain',
}

// Banners that are categories, not places — they never become a country or region.
const CATEGORY_BANNERS = new Set([
  ...Object.keys(BANNER_COUNTRY),
  'SPIRITS', 'ACCESSORIES', 'DESSERT WINE', 'FORTIFIED WINE',
])

const BANNER_RE = /^[A-Z&'\-.,/ÉÈÊÀÇÎÔÛ0-9 ]{3,40}$/

export type Context = { country: string | null; region: string | null; producer: string | null }

function isBanner(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  if (!BANNER_RE.test(t)) return false
  return !/\s{2,}/.test(t)   // a banner is one phrase, not a row of cells
}
```

Then rewrite `blocksOf` so a block carries the context it was found in, and make
`parseCatalogText` stamp it onto the items. Replace `blocksOf` with:

```ts
type Block = { anchors: Anchors; lines: string[]; context: Context }

// Walks a page top to bottom. The centred all-caps banner (indent > 30) is the
// category or country; the left-indented one is the region, or the country on
// SPIRITS pages. The prose between a banner and the table header describes the
// producer. Context carries across pages, because a run of pages repeats the same
// banner — hence the `carry` argument.
function blocksOf(pageText: string, carry: Context): { blocks: Block[]; context: Context } {
  const lines = pageText.split('\n')
  const blocks: Block[] = []
  let category: string | null = null
  let country = carry.country
  let region = carry.region
  let prose: string[] = []
  let current: Block | null = null

  for (const line of lines) {
    if (HEADER_RE.test(line)) {
      const anchors = columnAnchors(line)
      current = anchors
        ? {
            anchors,
            lines: [],
            context: { country, region, producer: prose.join(' ').trim() || null },
          }
        : null
      if (current) blocks.push(current)
      prose = []
      continue
    }

    if (isBanner(line)) {
      const text = line.trim()
      const indent = line.length - line.trimStart().length
      if (indent > 30) {
        category = text
        if (BANNER_COUNTRY[text]) country = BANNER_COUNTRY[text]
        else if (!CATEGORY_BANNERS.has(text)) { country = titleCase(text); region = null }
      } else if (category === 'SPIRITS') {
        country = titleCase(text)
        region = null
      } else {
        region = titleCase(text)
      }
      prose = []
      current = null
      continue
    }

    if (current) current.lines.push(line)
    else if (line.trim()) prose.push(line.trim())
  }

  return { blocks, context: { country, region, producer: null } }
}
```

And in `parseCatalogText`, thread the context through:

```ts
export function parseCatalogText(text: string): ExtractedItem[] {
  const items: ExtractedItem[] = []
  let carry: Context = { country: null, region: null, producer: null }

  for (const pageText of text.split('\f')) {
    const { blocks, context } = blocksOf(pageText, carry)
    carry = context

    for (const block of blocks) {
      const slots = block.lines
        .filter(l => l.trim())
        .map(l => classify(l, block.anchors))

      attachCodes(slots)
      attachVariants(slots)
      attachRemarks(slots)

      for (const slot of slots) {
        if (slot.kind !== 'item') continue
        const rows = slot.variants.length > 0 ? slot.variants : [slot.row]
        for (const row of rows) {
          const merged: Row = { ...row, vintage: row.vintage || slot.row.vintage }
          const item = itemFrom(merged, slot.type, slot.name)
          item.country = block.context.country
          item.region = block.context.region
          const notes = [
            slot.type.note,
            ...slot.remarks,
            merged.remark || null,
            block.context.producer,
          ].filter(Boolean)
          item.description = notes.length ? notes.join(' · ') : null
          items.push(item)
        }
      }
    }
  }
  return items
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run lib/price/parsers/lovely.test.ts`
Expected: PASS, 43 tests.

If `region` comes back holding a country on a wine page, the page's centred banner
was not recognised — check the indent threshold against that page's actual text.

- [ ] **Step 5: Commit**

```bash
git add lib/price/parsers/lovely.ts lib/price/parsers/lovely.test.ts
git commit -m "Парсер Lovely Wines: страна, регион и описание производителя из баннеров"
```

---

### Task 9: Glassware stays out

**Files:**
- Modify: `lib/price/parsers/lovely.test.ts`

- [ ] **Step 1: Write the test**

Append to `lib/price/parsers/lovely.test.ts`:

```ts
describe('parseCatalogText — glassware', () => {
  it('returns nothing from the accessories page', () => {
    expect(parseCatalogText(page(2))).toHaveLength(0)
  })

  it('never emits a Zalto glass or an ashtray from the whole fixture', () => {
    const names = parseCatalogText(FIXTURE).map(i => i.name)
    expect(names.some(n => /Zalto|Josephine|Ashtray|Usuhari/i.test(n!))).toBe(false)
  })
})
```

- [ ] **Step 2: Run it**

Run: `npx vitest run lib/price/parsers/lovely.test.ts`
Expected: PASS, 45 tests — `columnAnchors` already refuses `Packing` / `Price/Pcs`
headers, so this test documents the behaviour rather than driving new code. If it
fails, the glassware header slipped through `columnAnchors`.

- [ ] **Step 3: Commit**

```bash
git add lib/price/parsers/lovely.test.ts
git commit -m "Парсер Lovely Wines: стекло не попадает в позиции"
```

---

### Task 10: Wire the parser into the pipeline

**Files:**
- Modify: `lib/price/parsers/lovely.ts`
- Modify: `lib/price/parsers/index.ts`

- [ ] **Step 1: Add the IO entry point**

Append to `lib/price/parsers/lovely.ts`:

```ts
// ─── Entry point ───────────────────────────────────────────────────────────

export async function parseLovely(
  buf: Buffer,
  filename: string,
  onProgress?: ProgressCb,
): Promise<ExtractionResult> {
  await onProgress?.(10, 'reading pdf')

  const path = await writeTemp(buf)
  let text = ''
  try {
    text = await pdftotextLayout(path, 1, 0)
  } finally {
    safeUnlink(path)
  }

  await onProgress?.(40, 'parsing')
  const items = parseCatalogText(text)
  console.log(`[lovely] ${items.length} items from ${text.split('\f').length} pages`)

  if (items.length === 0) {
    throw new Error('Lovely Wines parser found no items — check that pdftotext is available')
  }

  const modDate = await pdfModDate(buf)
  await onProgress?.(95, 'inserting', items.length)

  return {
    supplier_name: SUPPLIER_NAME,
    price_list_date: catalogDate(filename, modDate),
    currency: 'THB',
    items,
  }
}
```

Add `import { PDFDocument } from 'pdf-lib'` to the import block at the **top** of the
file (next to the `./_shared` import), not here — a mid-file import is legal but the
rest of the codebase keeps them together. Then add the ModDate reader next to the
other helpers:

```ts
async function pdfModDate(buf: Buffer): Promise<Date | null> {
  try {
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false })
    return doc.getModificationDate() ?? null
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Register it**

In `lib/price/parsers/index.ts`, add the import alongside the others:

```ts
import { isLovely, parseLovely } from './lovely'
```

and add this entry to `PARSERS`, at the end of the "PDF: deterministic" block (right
after the `richly` entry):

```ts
  {
    id: 'lovely',
    fileTypes: ['pdf'],
    detect: (buf, fn) => isLovely(buf, fn),
    run: (buf, fn, _m, cb) => parseLovely(buf, fn, cb).then(async (r) => {
      await cb(95, 'inserting')
      return r
    }),
  },
```

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

Run: `npm test`
Expected: the whole suite passes, including the pre-existing `smd` and `reconcile` tests.

- [ ] **Step 4: Commit**

```bash
git add lib/price/parsers/lovely.ts lib/price/parsers/index.ts
git commit -m "Парсер Lovely Wines: подключён в реестр парсеров"
```

---

### Task 11: Coverage audit — close the gap to zero

The fixture proves five pages. This task proves all 64. The bar from the spec: every
line in the raw text that has both a volume and a price either became a position or
was deliberately skipped as glassware.

**Files:**
- Create: a throwaway script in the scratchpad directory (not committed)
- Modify: `lib/price/parsers/lovely.ts` (only if the audit finds misses)

- [ ] **Step 1: Write the audit script**

Create `/tmp/lovely-audit.mjs` (or the session scratchpad):

```js
import { execFileSync } from 'child_process'
import { parseCatalogText } from '../02_services/mission-control/lib/price/parsers/lovely.ts'

const PDF = '.inbox/Lovely Wines Catalog_Sep Claudio.pdf'
const text = execFileSync('pdftotext', ['-layout', PDF, '-'], { maxBuffer: 64 * 1024 * 1024 }).toString()

// Every line that has a volume and a price is a candidate position.
const candidates = text.split('\n').filter(l =>
  /\d{2,4}\s?(ml|ML|cl|L)\b/.test(l) && /\d[\d,]{2,}/.test(l))

const items = parseCatalogText(text)

console.log('candidate lines:', candidates.length)
console.log('items parsed:   ', items.length)
console.log('no price:       ', items.filter(i => i.price === null).length)
console.log('no country:     ', items.filter(i => !i.country).length)
console.log('no category:    ', items.filter(i => !i.category).length)
console.log('stock in name:  ', items.filter(i => /stock/i.test(i.name)).length)
console.log('digits in name: ', items.filter(i => /^\d|\d(ml|ML)$/.test(i.name)).length)

const byCountry = {}
for (const i of items) byCountry[i.country ?? '—'] = (byCountry[i.country ?? '—'] ?? 0) + 1
console.log(byCountry)
```

Run it with `npx tsx /tmp/lovely-audit.mjs` from the repo root (`tsx` is already
available through the root `package.json` scripts; if not, run
`npx --yes tsx /tmp/lovely-audit.mjs`).

- [ ] **Step 2: Read the numbers against these targets**

| Metric | Target | What a miss means |
|---|---|---|
| items parsed | ~886 — the 909 candidate lines minus the 23 glassware rows. Multi-size name rows carry no cells of their own, so they are not in the candidate count and do not shift this number | a table shape still unhandled |
| no price | 0 | a price cell was located in the wrong column |
| no country | 0 | a banner was not recognised |
| no category | 0 | a row kept `PENDING_TYPE` — a type code never arrived |
| stock in name | 0 | `splitStockPrefix` missed a variant of the remark |
| digits in name | 0 | a size cell bled into the name — the window logic regressed |

- [ ] **Step 3: Fix what the audit found, add a regression test for each fix**

For every discrepancy: find the offending page, add its text to the fixture (append
with `pdftotext -layout -f P -l P`), write a failing test that pins the correct
output, then fix the parser. Do not loosen a test to make a number match.

- [ ] **Step 4: Re-run the audit until every target is met**

Run: `npx tsx /tmp/lovely-audit.mjs`
Expected: `no price`, `no country`, `no category`, `stock in name` and
`digits in name` all `0`.

- [ ] **Step 5: Run the full suite and commit any parser fixes**

Run: `npm test`
Expected: PASS.

```bash
git add lib/price/parsers/lovely.ts lib/price/parsers/lovely.test.ts lib/price/__fixtures__/lovely-pages.txt
git commit -m "Парсер Lovely Wines: сверка покрытия на всех 64 страницах"
```

---

### Task 12: Supplier card

**Files:**
- Create: `07_contacts/partners/lovely-wines/profile.md` (repo root, not inside the service)

- [ ] **Step 1: Check the template**

Run from the repo root: `ls 07_contacts/templates/ && cat 07_contacts/templates/*partner*`
Follow whatever structure it defines; the content below is what must appear in it.

- [ ] **Step 2: Write the card**

Create `07_contacts/partners/lovely-wines/profile.md` following the template, with:

- **Name:** Lovely Wines Company Limited
- **Contact:** Claudio Bonato, Sales and Marketing Executive —
  claudio@lovelywines.co.th, +66 63 209 7488, Line `claudiolw`
- **Bangkok office:** 28 Soi Krungthep Kreetha 27, Thap Chang, Saphan Sung,
  Bangkok 10250 — tel 02-318-1588, fax 02-318-1589
- **Phuket office:** 96/27, 96/28 Moo 1, Kathu sub-district, Kathu district,
  Phuket 83150 — tel 063-912-4107
- **Hours:** 10:00–19:00, closed Sunday. www.lovelywines.co.th
- **Prices:** the catalog quotes **retail, VAT-exclusive** prices. Our purchase
  price is about **20% lower**. The portal stores the printed catalog number
  verbatim, so a Lovely Wines price in the price browser is retail, not our cost.
- **Catalog:** monthly PDF, 64 pages, wine + spirits + glassware. Parser:
  `02_services/mission-control/lib/price/parsers/lovely.ts`.

- [ ] **Step 3: Commit**

```bash
git add 07_contacts/partners/lovely-wines/profile.md
git commit -m "Карточка поставщика Lovely Wines"
```

---

### Task 13: Import run and smoke check

**Files:** none — this runs against the deployed portal.

- [ ] **Step 1: Push and wait for Railway**

```bash
git push origin main
```

Railway deploys mission-control on push to `main`. Wait for the deploy to finish
before uploading, or the old code will handle the file and the generic LLM fallback
will produce junk.

- [ ] **Step 2: Upload**

Open `/m/price` on the portal, upload `.inbox/Lovely Wines Catalog_Sep Claudio.pdf`,
and **leave the "update an existing supplier" selector empty** — Lovely Wines is a new
supplier, not a new version of an existing catalog. Picking an existing supplier here
would file the catalog under that supplier's name.

- [ ] **Step 3: Check the result**

Expected: status `done`, item count within a handful of ~886, supplier
`Lovely Wines Company Limited`, date `2026-09-01`.

Spot-check four prices against the PDF — one of each hard shape:

| Product | Expected price | Why this one |
|---|---|---|
| Canard Duchene Champagne 'Cuvee Leonie' Brut, 1500ml | 5,520 | multi-size |
| Goutorbe-Bouillot Champagne 'Le Ru Des Charmes' Rose Brut | 2,570 | the no-absorb rule |
| Gelas, Bas Armagnac 60 Ans | 41,960 | five-figure price |
| Javelier-Laurin, Ruchottes-Chambertin Grand Cru | 12,150 | stock remark on its own line |

Also confirm no item name contains `stock`, `ml`, or a leading digit, and that
searching the browser for `Zalto` returns nothing.

- [ ] **Step 4: Report the counts to the user**

State the item count, the four spot-checked prices, and anything the upload logged as
skipped. If the count is materially off ~886, do not call the import done — go back to
Task 11.

---

## Notes for whoever runs this

- **Migrations:** none needed. If you think you need one, re-read the spec's price
  section — the two-price model was explicitly deferred.
- **The 20% discount is not in the database.** It lives in the supplier card. Do not
  "helpfully" multiply prices in the parser; the catalog number must stay
  reconcilable with the PDF.
- **Next month's catalog** is uploaded with the supplier selector pointed at Lovely
  Wines, so freshness marks September expired and the new one current.
