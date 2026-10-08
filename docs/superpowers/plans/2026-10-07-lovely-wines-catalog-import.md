# Lovely Wines Catalog Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the 64-page Lovely Wines September 2026 catalog (~1,262 wine and spirits positions — each vintage of a wine is its own position) into `wine_items` through the existing mission-control price pipeline, by adding one deterministic supplier parser.

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
| Create: `lib/price/__fixtures__/lovely-pages.txt` | `pdftotext -layout` output of the pages that between them contain every hard case: 2, 3, 9, 23, 31 to start, extended by Task 5 to 12 pages. Addressed by content, never by position. |
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

### Task 5: Row assembly — the generalised centring rule

**Files:**
- Modify: `lib/price/parsers/lovely.ts`
- Modify: `lib/price/parsers/lovely.test.ts`
- Modify: `lib/price/__fixtures__/lovely-pages.txt` (append pages 16, 22, 46, 48, 52, 58)

This task replaces what earlier drafts of this plan split across Tasks 5–9. It is
specified as behaviour plus required tests rather than as code to copy: the earlier
prescribed implementation was reviewed and found defective twice, and the catalog
turned out to contain five variations of one rule rather than three special cases.
Design the assembly yourself against the behaviour below; the helpers from Tasks 1–4
(`columnAnchors`, `readRow`, `matchType`, `classifyTypeCell`, `toIntPrice`) are
already in place and tested — read them before you start.

#### The rule

**A cell typeset alone on its line is vertically centred and belongs to the adjacent
rows that lack that cell.** The catalog applies this to names, bottle sizes, vintages
and prices alike. Implement it once, generally, instead of special-casing each shape.

What that means per column:

- A **name** row with no size and no price collects the size/price rows contiguous
  above and below it. (Canard-Duchêne `'Cuvee Leonie'`: 750ml/2,710 and 1500ml/5,520.)
- A **variant row with no size** inherits the size from its name row. (Aldridge
  `'Twynham' Chardonnay` carries `750ml` on the name row; the 2024/590 and
  2025/pending rows carry none. Without inheritance those positions get
  `volume: null`.)
- A **price alone on its line** applies to the adjacent vintage rows that have no
  price of their own. (Yangarra `'GSM'`: 2,120 serves 2017 and 2021; 2015 is
  `pending`. Cantina Tollo `'Rocca Ventosa' Pinot Grigio`: 840 serves 2023, 2024 and
  2025.)
- A **name wrapped over two lines**, with the type code on a line between the halves,
  joins into one name; the continuation line's own cells form another variant of that
  same product. (Realm Cellars `'Houyi Vineyard'` + `Cabernet Sauvignon`; Comtesse de
  Cherisey `... 1er Cru 'La` + `Genelotte'`.) Emitting the continuation as its own
  product would file junk — a position named "Cabernet Sauvignon" at ฿12,800.
- A **row that already carries both its own size and its own price collects nothing.**
  Without this, Goutorbe-Bouillot's 750ml/2,010 variant is stolen by the next
  product, which really costs 2,570 — a wrong price with no visible symptom.

Deduplicate identical `(volume, year, price)` triples within one product: the text
layer prints Comtesse de Cherisey's `2018 / 7,245` twice.

#### Line roles

Within a producer's table block, classify each line as exactly one of:

| Role | Recognised by | Effect |
|---|---|---|
| data row | cells present, left-hand text matches the Type vocabulary | starts a product |
| variant row | cells present, no left-hand text | attaches per the rule above |
| code-only row | the whole line is a type code (`     R`) | supplies the type for the next product that lacks one |
| torn stock code | `low R` / `lowR` — a stock fragment glued to the code | strip the fragment, keep the code, remember the fragment as a remark |
| stock-prefixed row | left-hand text begins `out of stock` / `low stock` / `stock` | strip it off the name into the remark; the type code came on an earlier line |
| remark-only row | the line is only a rating (`91 WS`, `96+ RP`) or a stock state | attaches to the adjacent product, preferring the one above |
| name continuation | left-hand text matches no Type word, is not a stock prefix, and **ends before the `Size` column** | joins the previous product's name |
| prose / banner | left-hand text runs past the `Size` column into the cell area | context only, never a product |

The last two are told apart purely by where the text ends. That is the discriminator
that keeps a producer paragraph from becoming a ฿2,013 phantom wine.

#### Context from banners

Track, per page and carrying across pages:

- the centred all-caps banner (indent > 30) → category or country. `CHAMPAGNE`,
  `FRENCE SPARKLING` → France; `PROSECCO` → Italy; `CAVA`, `SPANISH CAVA` → Spain;
  `SPIRITS`, `ACCESSORIES`, `DESSERT WINE`, `FORTIFIED WINE` are categories and set
  no place; anything else is a country.
- the left-indented banner → region, or the country when the page banner is `SPIRITS`.
- the prose between a banner and the table header → the producer description.

Banners are title-cased before they reach the UI (`ARGENTINA` → `Argentina`). **The
banner matcher must accept typographic hyphens** — `ENTRE‑DEUX‑MERS` uses U+2011, and
an ASCII-only matcher drops that banner and leaks its region into the next producer.
A block ends at the next banner, which is what keeps prose out of the tables.

#### Two price details

- **`pending` is a price.** 51 rows print the word instead of a number. Emit the
  position with `price: null`; do not drop it.
- **Two rows use a dot as the thousands separator** — `1.970` (Giuseppe Cortese,
  Barbera d'Alba, page 46) and `1.020` (Muga Reserva 375ml, page 52). The catalog
  never prices with decimals, so in the price cell `\d{1,3}\.\d{3}` is a thousands
  separator: read `1.020` as 1020, and `console.warn` the row so the oddity is
  visible. Leaving them `null` loses two real prices; reading `1.020` as 20 — which
  the unbounded regex did before Task 4's fix — would have imported a ฿1,020 bottle
  at ฿20.

#### Steps

- [ ] **Step 1: Extend the fixture and make it addressable by content**

Append the six pages that carry the hard shapes:

```bash
PDF="../../.inbox/Lovely Wines Catalog_Sep Claudio.pdf"
for p in 16 22 46 48 52 58; do
  pdftotext -layout -f $p -l $p "$PDF" - >> lib/price/__fixtures__/lovely-pages.txt
done
```

The fixture now holds pages 2, 3, 9, 23, 31, 16, 22, 46, 48, 52, 58 in that order.
**Replace the positional `page()` helper in the test file with a content-based
lookup** — find the page whose text contains a given marker (`'ZALTO GLASPERFEKTION'`,
`'CANARD-DUCHÊNE'`, `'MAISON GELAS'`, `'CHATEAU LA PENSEE'`, `'JAVELIER-LAURIN'`,
`'YANGARRA ESTATE VINEYARD'`, `"CHATEAU COS D'ESTOURNEL"`, `'GIUSEPPE CORTESE'`,
`'CANTINA TOLLO'`, `'MUGA'`, `"O'SHAUGHNESSY"`). Indexing by position breaks the next
time anyone appends a page, and this task appends six.

- [ ] **Step 2: Write the failing tests, then implement, then make them pass**

Follow TDD per behaviour, not one big bang: take the roles in the table above one at
a time, write its test against the real fixture text, watch it fail, implement, watch
it pass, commit. Roughly one commit per role.

**Required assertions.** Values below were verified against the catalog by hand;
where a count is given it is exact.

Known-good counts and values (regression floor — these already worked before this task):
- glassware page → **0 positions**; no position anywhere named like `Zalto`,
  `Josephine`, `Usuhari` or `Ashtray`
- Maison Gelas page → **27 positions**; `Ron Barcelo Blanco Anejado` 700ml ฿1300
  spirits/rum; `Gelas, Bas Armagnac 8 Ans` ฿3125 armagnac; `Gelas, Bas Armagnac
  60 Ans` ฿41960
- Canard-Duchêne page → **16 positions**, every one `wine` / `sparkling` / France;
  `'Cuvee Leonie' Brut` → two positions, 750ml ฿2710 and 1500ml ฿5520;
  `'Le Ru Des Charmes' Rose Brut` → ฿2570 (not 2010); `'Reflets De Riviere'` → 375ml
  ฿1440 and 750ml ฿2010; `Canard-Duchene Champagne Brut` year 2015; `'P.181'` year null
- Javelier-Laurin → four positions ฿1500, ฿4490, ฿5900, ฿12150, country France,
  region `Côte De Nuits, Burgundy`; no position name contains `stock`
- `Chateau La Pensee Lalande de Pomerol` → ฿1450, year 2020, description mentions
  `low stock`
- Paul Bara `'Reserve Brut'` → description carries both `91 WS` and `90 VN`

New behaviour this task must add:
- `Aldridge 'Twynham' Chardonnay` → **two** positions, **both `volume: '750ml'`**,
  year 2024 at ฿590 and year 2025 at `price: null`
- `Yangarra Estae Vineyard 'GSM'` → name joined with its continuation
  `(Grenache/ Shiraz/ Mourvèdre)`; years **2017 and 2021, both at ฿2,120**; no position
  named `(Grenache/ Shiraz/ Mourvèdre)` on its own. The `2015 / pending` row below it
  belongs to **High Sands Grenache**, not to `'GSM'` — verified against the PDF's word
  coordinates, where the gaps inside the `'GSM'` cluster are 5.3pt and the gap before
  `2015 pending` is 14.1pt. High Sands Grenache therefore has 2015/`null` and
  2019/฿7,760
- `Cantina Tollo 'Rocca Ventosa' Pinot Grigio` → name joined with `Terre di Chieti
  IGP`; three years (2023, 2024, 2025), each ฿840
- Realm Cellars `'Houyi Vineyard'` → name joined with `Cabernet Sauvignon`; years 2021
  ฿16360 and 2022 ฿12800; **no position named `Cabernet Sauvignon`**
- Comtesse de Cherisey `'La Genelotte'` → name joined across the two lines, **one
  position**: 750ml / 2018 / ฿7,245. The repeated `2018 / 7,245` and the `2019 /
  7,575` below it belong to `'Bois de Blagny'`, which also has 2020 and 2021 at
  ฿10,280 — again verified against the PDF's coordinates. Deduplicate identical
  (volume, year, price) triples within one product anyway, as a safety net
- `Chateau Cos d'Estournel Saint-Estephe` → `wine_type: 'red'` (the `low R` code must
  survive), name free of `stock`/`low`, description mentions the stock state
- `Giuseppe Cortese, Barbera D'Alba Morassina` → ฿1970 from the printed `1.970`
- `Muga Reserva, Rioja DOC` 375ml → ฿1020 from the printed `1.020`
- the Monsanto `DW` dessert wine → `category: 'wine'`, `wine_type: null`, description
  mentions dessert
- no position has a name that contains a size token or is shorter than four
  characters; **exactly one** name begins with a digit, and it is the real product
  `30&40 Double Jus (Aperitive de Normandie)`
- no position has `category: null`

- [ ] **Step 3: Run the whole suite**

Run: `npx vitest run lib/price/parsers/lovely.test.ts` then `npm test` and
`npx tsc --noEmit`. All three must be clean, and the 62 tests from Tasks 1–4 must
still pass unchanged — if one of them now fails, you have changed a helper's contract
and need to say so rather than edit the old test.

- [ ] **Step 4: Report the ambiguous clusters**

Some clusters genuinely do not record which year goes with which price — Yangarra
prints three vintages against two price values, Tolaini `'Al Passo'` prints two sizes
and two vintages against one price. Pair them positionally, and **print a list of
every cluster where vintages outnumber prices** (producer, name, the years, the
prices) so a human can check ~20–25 of them by eye against the PDF. Include that list
in your report.

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
console.log('size in name:   ', items.filter(i => /\d\s?(ml|ML)\b/.test(i.name)).length)
console.log('digit-first:    ', items.filter(i => /^\d/.test(i.name)).length)   // expect 1: 30&40 Double Jus

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
| items parsed | ~1,262. Each vintage is its own position; the earlier figure of ~886 counted only lines carrying a size, and vintage rows carry a vintage and a price but no size | a table shape still unhandled |
| no price | 59 — 57 `pending`, Giuseppe Cortese `'Scapulin'` (empty cell) and Dumol Meteor Vineyard (printed `4,.395`) | a price cell was located in the wrong column |
| no country | 0 | a banner was not recognised |
| no category | 0 | a row kept `PENDING_TYPE` — a type code never arrived |
| stock in name | 0 | `splitStockPrefix` missed a variant of the remark |
| size token in name | 0 | a size cell bled into the name — the window logic regressed |
| names beginning with a digit | exactly 1, `30&40 Double Jus …` | more than one means a cell bled into a name |
| ambiguous clusters | 214 printed, of which 213 are "N vintages share one price"; the one to check by eye is Domaine J.A. Ferret `'Tournant De Pouilly'` (page 36), four vintages against ฿3,630 and ฿3,880 | — |

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
