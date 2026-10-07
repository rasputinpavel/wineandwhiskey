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
