// Lovely Wines Company Limited — Bangkok + Phuket importer, monthly catalog.
//
// One 64-page A4 PDF with a real text layer. Per page: a centred all-caps banner
// (category or country), a left-indented sub-banner (region, or the country on
// SPIRITS pages), a prose paragraph about the producer, then one small table per
// producer:
//
//   Type   <BRAND>   Size   Alc%   [Vintage]   Price   Remark
//
// Glassware and the cigar ashtray are not beverages and are skipped. They are
// recognised by the absence of an Alc% column, not by a blocklist of their column
// names: of the 262 table headers in the September 2026 file exactly 4 have no
// Alc%, and they are precisely those 4 tables.
//
// Why deterministic: measured on the September 2026 file, every one of the 923
// size cells, 598 vintages and 860 prices sits within a few characters of its
// header's column, so the tables are genuinely character-aligned. An LLM pass
// would cost ~25 calls per upload and could misread a digit. Grape variety is the
// one field the tables never carry, and Vivino enrichment already fills it.
//
// Four typesetting traps, all verified against the real file:
//   1. Multi-size items put the product name vertically centred BETWEEN its
//      size/price rows, so the name line has neither a size nor a price.
//   2. Size cells print as much as 8 characters left of the Size label, so a hard
//      slice at the label cuts "1500ml" into "15" + "00ml" and the fragment ends
//      up inside the product name. Cells are therefore found by regex near the
//      anchor, not by slicing — and each search is clamped to the midpoint
//      between its own column and its neighbours, because the Remark column can
//      sit as close as 6 characters right of Price.
//   3. When a row carries a stock remark, pdftotext splits it: the type code sits
//      alone on one line and "low stock" / "out of stock" is rendered at the far
//      left edge, before the product name.
//   4. Numbers that abut other numbers. A price is only ever a whole token: the
//      catalog contains ABVs like "37.50", a price mistyped as "1.020", and
//      vintages that sit inside the price column's reach. Every cell regex is
//      bounded on both sides and a vintage is never accepted as a price.
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

// ─── Helpers ───────────────────────────────────────────────────────────────

// Prices print as "900" or "41,960"; coerce to bare integer THB. A cell holding
// anything else (empty, "N/A", a stray remark) means no price.
//
// The thousands separators have to be checked as grammar, not as a character
// set: a shape test like /^[\d,]+$/ accepts "41,96" and quietly returns 4196,
// and "1,2,3" and quietly returns 123. A dropped digit that still looks like a
// plausible price is the worst failure this parser can have, so a cell whose
// grouping is malformed is refused outright.
const PRICE_CELL_RE = /^\d{1,3}(?:,\d{3})*$|^\d+$/

export function toIntPrice(cell: string): number | null {
  const text = cell.trim()
  if (!PRICE_CELL_RE.test(text)) return null
  const n = parseInt(text.replace(/,/g, ''), 10)
  return Number.isFinite(n) ? n : null
}

// Month labels as a closed alternation with real boundaries on both sides. A
// prefix pattern like /\b(jan|feb|…)[a-z]*\b/ fires on any word that merely
// starts with those three letters, and the catalog world is full of them:
// Decanter → December, Novelties → November, Junmai → June,
// Marlborough → March, Marchesi → March, Janhom → January (Janhom is another
// supplier in this repo, so a co-import filename is not hypothetical).
const MONTH_RE =
  /(?<![a-z])(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?![a-z])/i

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

// The supplier is in Bangkok and so are we, so a ModDate instant is read as the
// Bangkok day it fell on. Neither getUTC* nor the server's local clock will do:
// a PDF stamped 2026-09-01 00:30 Bangkok is 2026-08-31 in UTC (which is what
// Railway containers run on) and in any timezone west of +07:00 — and August is
// the wrong month for a September price list.
const CATALOG_TZ = 'Asia/Bangkok'

function ymdInCatalogTz(d: Date): { year: number; month: number; day: number } {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
    timeZone: CATALOG_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d).split('-').map(Number)
  return { year, month, day }
}

// The catalog prints no date anywhere in its text layer, so derive one: an
// explicit YYYY-MM in the filename wins, then a month name in the filename
// resolved against the PDF's ModDate, then ModDate itself.
export function catalogDate(filename: string, modDate: Date | null): string | null {
  // Only the basename: a directory called `Nov-drafts/` or `archive/2026-11/`
  // says nothing about which month this particular catalog is.
  const base = filename.split(/[/\\]/).pop() ?? filename

  const iso = base.match(/(20\d{2})[-_.](0[1-9]|1[0-2])/)
  if (iso) return `${iso[1]}-${iso[2]}-01`

  const word = base.match(MONTH_RE)
  if (word && modDate) {
    const month = MONTHS[word[1].slice(0, 3).toLowerCase()]
    const stamp = ymdInCatalogTz(modDate)
    // The filename names a month but not a year, so choose the year that puts
    // that month closest to when the file was stamped: a January catalog mailed
    // in late December is next January's, not last January's.
    const target = stamp.year * 12 + stamp.month
    let best = stamp.year
    let bestDist = Infinity
    for (const year of [stamp.year - 1, stamp.year, stamp.year + 1]) {
      const dist = Math.abs(year * 12 + month - target)
      if (dist < bestDist) { best = year; bestDist = dist }
    }
    return `${best}-${String(month).padStart(2, '0')}-01`
  }

  if (!modDate) return null
  const { year, month, day } = ymdInCatalogTz(modDate)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

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


// A leading word that occupies a Type-cell-shaped slot: alphabetic, short, and
// followed by the column gap. Used only to tell an unknown Type cell apart from
// prose, never to accept one.
const TYPE_SHAPED_RE = /^([A-Za-z][A-Za-z-]{1,11})(?:\s{2,}|\s*$)/

export type TypeCell =
  | { kind: 'matched'; type: TypeInfo; rest: string }
  | { kind: 'unknown'; token: string }
  | { kind: 'none' }

// Splits the left-hand text of a row into its Type cell and the product name,
// and — crucially — distinguishes "there is no Type cell here" (prose, a bare
// product name) from "there is one and I do not know this word".
//
// Those two were one `null` before, which meant a Tequila, Mezcal, Sake or Port
// section appearing next month would be dropped without a trace, and so would a
// `RUM` that the supplier simply typed in capitals. A casing variant is reported
// rather than quietly accepted: failing closed on an unreadable Type cell is
// right, failing closed *silently* is not.
//
// Limitation worth knowing: the shape test needs two or more spaces after the
// word, because the glued single-space form ("Armagnac Gelas, …") is
// indistinguishable from a product name that starts with a capitalised word. Every
// unknown single-word Type in this catalog's column widths prints with a wide gap.
export function classifyTypeCell(left: string): TypeCell {
  const text = left.trim()
  if (!text) return { kind: 'none' }

  for (const key of TYPE_KEYS) {
    if (!text.startsWith(key)) continue
    const rest = text.slice(key.length)
    // The key must be a whole cell, not the start of a longer word: "RO" must not
    // match "ROSSO", "R" must not match "Realm".
    if (rest && !/^[\s]/.test(rest)) continue
    return { kind: 'matched', type: TYPES[key], rest: rest.trim() }
  }

  // A vocabulary word in unexpected case ("RUM", "whisky") lands here along with
  // genuinely new ones like Tequila — reported either way, never guessed at.
  const shaped = text.match(TYPE_SHAPED_RE)
  if (shaped) return { kind: 'unknown', token: shaped[1] }

  return { kind: 'none' }
}

// Thin wrapper keeping the original shape for callers that only care whether the
// row could be read, and making an unreadable Type cell audible on the way past.
export function matchType(left: string): { type: TypeInfo; rest: string } | null {
  const cell = classifyTypeCell(left)
  if (cell.kind === 'matched') return { type: cell.type, rest: cell.rest }
  if (cell.kind === 'unknown') {
    console.warn(`[lovely] unrecognised Type cell ${JSON.stringify(cell.token)} — row skipped: ${JSON.stringify(left.trim().slice(0, 80))}`)
  }
  return null
}

// ─── Table geometry ────────────────────────────────────────────────────────

export type Anchors = {
  size: number
  // Always present in practice — columnAnchors refuses a header without it — but
  // kept nullable so the window arithmetic treats every column uniformly.
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

// A header we can parse has Size, Price and Alc%.
//
// Alc% is the gate rather than a blocklist of glassware words: over the 262 table
// headers in the September 2026 catalog exactly 4 lack an Alc% column, and those 4
// are precisely the cigar ashtray and the three glassware tables. A blocklist of
// the literals Packing / Price/Pcs / Height/Volume only holds until the supplier
// rewords a column, whereas a table of things you drink will always state strength.
//
// Labels are matched as whole tokens, not with indexOf: `indexOf('Price')` finds
// the Price inside `Price/Pcs` and hands back an anchor pointing at a column of
// per-piece glass prices.
function labelAt(header: string, label: string): number | null {
  const m = new RegExp(`(?<![A-Za-z/])${label}(?![A-Za-z/])`).exec(header)
  return m ? m.index : null
}

export function columnAnchors(header: string): Anchors | null {
  if (!HEADER_RE.test(header)) return null

  const at = (label: string) => labelAt(header, label)
  const size = at('Size')
  const price = at('Price')
  const alc = at('Alc%')
  if (size === null || price === null || alc === null) return null

  return { size, alc, vintage: at('Vintage'), price, remark: at('Remark') }
}

// The widest a cell search ever reaches, whatever the table geometry allows.
const WINDOW_CAP = 8

// How far left and right of its own anchor a cell may be searched. A flat window
// of 8 was wrong: in the Paul Bara, Javelier-Laurin and Philippe Leclerc tables
// the Remark anchor sits exactly 8 characters right of Price (as little as 6
// elsewhere in the catalog), so a critic score typeset in the Remark column was
// read as the price. The search is therefore clamped to the midpoint between this
// anchor and its neighbours, which the header hands us for free.
//
// Verified over the whole September 2026 catalog: this loses none of the 923 size,
// 598 vintage or 860 price cells, because real cells sit at most 4 characters
// right of their anchor (8 left, for Size, which has no column to its left).
function windowAround(anchor: number, a: Anchors): { left: number; right: number } {
  const cols = [a.size, a.alc, a.vintage, a.price, a.remark]
    .filter((v): v is number => v !== null)
    .sort((x, y) => x - y)
  const i = cols.indexOf(anchor)
  const prev = i > 0 ? cols[i - 1] : null
  const next = i >= 0 && i < cols.length - 1 ? cols[i + 1] : null
  const half = (gap: number) => Math.min(WINDOW_CAP, Math.floor(gap / 2))
  return {
    left: prev === null ? WINDOW_CAP : half(anchor - prev),
    right: next === null ? WINDOW_CAP : half(next - anchor),
  }
}

// Finds the occurrence of `re` whose start is nearest to `anchor`, inside that
// anchor's own window.
function near(line: string, re: RegExp, anchor: number | null, a: Anchors): RegExpExecArray | null {
  if (anchor === null) return null
  const { left, right } = windowAround(anchor, a)
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
  let best: RegExpExecArray | null = null
  let bestDist = Infinity
  let m: RegExpExecArray | null
  while ((m = rx.exec(line)) !== null) {
    const offset = m.index - anchor
    const dist = Math.abs(offset)
    if (offset >= -left && offset <= right && dist < bestDist) { best = m; bestDist = dist }
    if (offset > right) break
  }
  return best
}

// Every cell regex is bounded on BOTH sides against digits, dots and commas, so
// a match can only ever be a whole number as typeset. Without the left boundary:
//   "102000"  yielded the price "02000"
//   "37.50"   (a real ABV in the Ron Barceló table) yielded the price "50"
//   "1.020"   (a real price on page 48, mistyped with a dot) yielded "020", i.e.
//             a THB 1,020 bottle imported at THB 20
//   "12000ml" yielded the size "2000ml"
// A price with a decimal part does not occur in this catalog, so the dot form is
// refused outright rather than truncated: no price is recoverable, a wrong one is
// not. Litre sizes are deliberately unsupported — every one of the 923 size cells
// in the September 2026 file is in ml.
const SIZE_RE    = /(?<![\d.,])\d{2,4}\s?(?:ml|ML|cl|CL|L)\b/
const PRICE_RE   = /(?<![\d.,])(?:\d{1,3}(?:,\d{3})+|\d{2,5})(?![\d.,])/
const VINTAGE_RE = /(?<![\d.,])(?:19|20)\d{2}(?![\d.,])|(?<![A-Za-z])NV(?![A-Za-z])/

// Reads one line of a table against that table's anchors. Everything left of the
// first located cell is the left-hand text; the remark is whatever trails the
// price. Cells are located by regex near their anchor, never by slicing at it —
// see the file header for why.
export function readRow(line: string, a: Anchors): Row {
  const sizeM    = near(line, SIZE_RE, a.size, a)
  const priceM   = near(line, PRICE_RE, a.price, a)
  const vintageM = near(line, VINTAGE_RE, a.vintage, a)

  // A vintage is never a price. Where the two searches land on the same token the
  // row simply has no price cell — a name row, or one priced "pending". Without
  // this the year would be stored as the price: the Vintage and Price columns sit
  // as little as 10 characters apart and vintages print up to 5 characters right
  // of their anchor, which is inside the price window.
  const price = priceM && vintageM && priceM.index === vintageM.index ? null : priceM

  const firstCell = Math.min(
    sizeM ? sizeM.index : Infinity,
    price ? price.index : Infinity,
    vintageM ? vintageM.index : Infinity,
  )
  const left = Number.isFinite(firstCell) ? line.slice(0, firstCell).trim() : line.trim()

  const afterPrice = price ? price.index + price[0].length : null
  const remark = afterPrice !== null ? line.slice(afterPrice).trim() : ''

  return {
    left,
    size: sizeM ? sizeM[0].replace(/\s+/g, '') : '',
    vintage: vintageM ? vintageM[0] : '',
    price: price ? price[0] : '',
    remark,
  }
}
