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
// Why deterministic: the tables are genuinely tabular, and `pdftotext -bbox`
// gives every word its own box, so a cell's column is its x and its product is
// its y. An LLM pass would cost ~25 calls per upload and could misread a digit.
// Grape variety is the one field the tables never carry, and Vivino enrichment
// already fills it.
//
// The geometry is read from coordinates and not from `-layout` text, because
// `-layout` paints the page into character cells and merges baselines about 4pt
// apart onto one line — which is exactly the signal that says which product a
// centred cell belongs to. See the note above `wordRows`.
//
// Three typesetting traps, all verified against the real file:
//   1. A product spreads its cells over several baselines, with the name, the
//      sizes, the vintages or the price centred against the rest. Which rows
//      belong together is read from the gaps between baselines, not guessed.
//   2. A stock remark hangs 0.3–3.1pt under the row it belongs to, sometimes in
//      the far-left gutter and sometimes in the Remark column. It is lifted out
//      before any gap is measured.
//   3. Numbers printed oddly: a price with a dot for a thousands separator
//      ("1.020"), a size with a comma inside it ("1,500ml"), and the words
//      "pending" and "Request for Quote" where a number should be. Each is a
//      whole cell here, so none of them can be half-read.
//
// Prices are RETAIL and VAT-exclusive ("NOTE : Prices are Vat Exclusive"); our
// purchase price is about 20% lower. We store the printed number verbatim, like
// every other parser — the discount lives in the supplier card at
// 07_contacts/partners/lovely-wines/profile.md.
//
// No supplier item codes anywhere except the Zalto glassware we skip, so
// supplier_sku stays null (same as Boozia and Richly).

import { PDFDocument } from 'pdf-lib'

import type { ExtractedItem, ExtractionResult } from '../claude'
import { writeTemp as writeTempShared, safeUnlink, pdftotextLayout, exec } from './_shared'

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


// A leading word that occupies a Type-cell-shaped slot. Used only to tell an
// unknown Type cell apart from prose, never to accept one.
//
// Two shapes count. A word with a product name after it across the column gap is
// a Type cell whatever it says ("TEQUILA   Patron Silver").
//
// A token *alone* on its line is only a candidate if it has the shape of this
// catalog's type codes — one or two capitals, optionally twice ("R", "CP",
// "CP RO"). Anything else alone on a line is a page banner: region and country
// banners print in caps and are as short as LOIRE, ITALY, USA, and row assembly
// runs every line of a block through here, so admitting them would bury the one
// warning that matters under dozens that do not.
const TYPE_WITH_NAME_RE = /^([A-Za-z][A-Za-z-]{1,11})\s{2,}\S/
const TYPE_ALONE_RE = /^([A-Z]{1,2}(?: [A-Z]{2})?)\s*$/

function typeShapedToken(text: string): string | null {
  return (text.match(TYPE_WITH_NAME_RE) ?? text.match(TYPE_ALONE_RE))?.[1] ?? null
}

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
  const token = typeShapedToken(text)
  if (token) return { kind: 'unknown', token }

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

// ─── Reading the PDF ───────────────────────────────────────────────────────

// Kept local rather than put in `_shared.ts` next to pdftotextLayout: no other
// parser in the repo reads coordinates, so there is nothing to share yet. If a
// second one needs it, it belongs there.
//
// `-bbox`, never `-bbox-layout` — see the note on word coordinates below.
export async function pdftotextBbox(path: string): Promise<string> {
  const { stdout } = await exec('pdftotext', ['-bbox', path, '-'], { maxBuffer: 64 * 1024 * 1024 })
  return stdout
}

// ─── Word coordinates ──────────────────────────────────────────────────────
//
// The geometry comes from `pdftotext -bbox`, which gives every word its own
// box, rather than from `-layout`, which paints the page into character cells.
//
// Why: `-layout` merges baselines about 4pt apart onto one text line, and that
// is exactly the signal that says which product a centred cell belongs to. On
// page 14 Hermandad prints
//
//     y=549.0        2019
//     y=553.0  +4.0  R Hermandad, Blend (…)  750ml 14.5 1,490
//     y=557.7  +4.7  2022
//     y=571.6 +13.9  2022                     ← a new product starts here
//     y=575.6  +4.0  R Hermandad, Malbec     750ml 14.5 1,490
//     y=579.6  +4.0  2023
//
// and `-layout` folds 2019 onto Blend's line and the second 2022 onto Malbec's,
// leaving the first 2022 equidistant between two products that each already
// carry a size, a vintage and a price. Nothing in the text layer then says whose
// it is; with coordinates the 4.7pt gap says it plainly.
//
// Use plain `-bbox`, never `-bbox-layout`: the latter groups words into <line>
// elements and re-merges those 4pt baselines, which is the whole signal gone.

export type Word = { x: number; y: number; text: string }
export type WordRow = { y: number; words: Word[] }

const XML_NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeXml(text: string): string {
  return text.replace(/&(#[0-9]+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, ref: string) => {
    if (ref.startsWith('#x') || ref.startsWith('#X')) return String.fromCodePoint(parseInt(ref.slice(2), 16))
    if (ref.startsWith('#')) return String.fromCodePoint(parseInt(ref.slice(1), 10))
    return XML_NAMED[ref.toLowerCase()] ?? whole
  })
}

const PAGE_RE = /<page\b[^>]*>([\s\S]*?)<\/page>/g
const WORD_RE = /<word\b[^>]*\bxMin="([-\d.]+)"[^>]*\byMin="([-\d.]+)"[^>]*>([\s\S]*?)<\/word>/g

// Splits the whole document into pages of words. Any wrapper markup is ignored,
// so a fixture built by concatenating one-page dumps reads the same as a
// single whole-document dump.
export function bboxPages(xml: string): Word[][] {
  const pages: Word[][] = []
  for (const page of xml.matchAll(PAGE_RE)) {
    const words: Word[] = []
    for (const w of page[1].matchAll(WORD_RE)) {
      const text = decodeXml(w[3]).trim()
      if (text) words.push({ x: parseFloat(w[1]), y: parseFloat(w[2]), text })
    }
    pages.push(words)
  }
  return pages
}

// Words printed on one baseline. Measured over the catalog: words of the same
// visual row share a yMin exactly, so the tolerance only absorbs float noise —
// the nearest real structure is 0.3pt away (a stock remark hanging under its
// row) and that is deliberately left as a row of its own, for liftStockRows.
const ROW_TOLERANCE = 0.2

export function wordRows(words: Word[]): WordRow[] {
  const rows: WordRow[] = []
  for (const w of [...words].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const last = rows[rows.length - 1]
    if (last && w.y - last.y <= ROW_TOLERANCE) last.words.push(w)
    else rows.push({ y: w.y, words: [w] })
  }
  for (const r of rows) r.words.sort((a, b) => a.x - b.x)
  return rows
}

// Words of a row as one string. The hyphen fix-up is not cosmetic: pdftotext
// splits ENTRE‑DEUX‑MERS (U+2011) into five words with ordinary 2.2pt word gaps
// between them, so a plain join would give "ENTRE ‑ DEUX ‑ MERS" and the banner
// would no longer match its ASCII twin two producers later. Only the hyphen
// characters are closed up; the catalog's own "SAINT - ESTEPHE" keeps its spaces,
// and so do the em dashes in its in-table separators.
const TIGHT_HYPHEN = / ?([\u2010\u2011]) ?/g

export const joinWords = (words: Word[]) => words.map(w => w.text).join(' ').replace(TIGHT_HYPHEN, '$1')

export const rowText = (row: WordRow) => joinWords(row.words)

// A row that is nothing but a stock remark. The catalog hangs these 0.3–3.1pt
// under the row they belong to, sometimes in the far-left gutter and sometimes
// in the Remark column, and they must come out of the row list before anything
// measures the gaps between rows: on page 31 the gap from Javelier-Laurin's
// "low stock" to the next product is 11.1pt, which would read as one cluster,
// while the gap between the two product rows themselves is 14.2pt.
const STOCK_ROW_RE = /^(out of stock|low stock|out of|low|stock)$/

export function liftStockRows(rows: WordRow[]): { rows: WordRow[]; stock: string[][] } {
  const kept = rows.filter(r => !STOCK_ROW_RE.test(rowText(r)))
  const stock: string[][] = kept.map(() => [])
  for (const row of rows) {
    const phrase = rowText(row)
    if (!STOCK_ROW_RE.test(phrase)) continue
    if (!kept.length) continue
    // The nearest surviving row: the hanger sits just under its own row, but on
    // page 13 it is 0.9pt above the row it belongs to and 13.3pt below the one
    // before, so nearest is the rule rather than "always the row above".
    let best = 0
    for (let i = 1; i < kept.length; i++) {
      if (Math.abs(kept[i].y - row.y) < Math.abs(kept[best].y - row.y)) best = i
    }
    stock[best].push(phrase)
  }
  return { rows: kept, stock }
}

// ─── Table geometry, in points ─────────────────────────────────────────────

export type Columns = {
  size: number
  alc: number
  vintage: number | null
  price: number
  remark: number | null
  // Words starting left of this are the Type cell and the product name.
  leftEdge: number
}

// Measured over all 64 pages: a size cell starts at most 12pt left of its Size
// label, and the furthest right any product name ever starts is 23pt left of it
// (Au Bon Climat 'Sanford & Benedict Vineyard', page 57). 17 therefore has 5pt
// of clearance on the cell side and 6pt on the name side.
const LEFT_GUTTER = 17

// A header row, and the columns it fixes. Alc% is the gate rather than a
// blocklist of glassware words: of the 262 headers in the September 2026 catalog
// exactly 4 lack an Alc% column, and those 4 are precisely the cigar ashtray and
// the three glassware tables. Matching whole words settles Price/Pcs and
// Height/Volume for free — pdftotext gives each of those as one word, and one
// word is either 'Price' or it is not.
export function tableColumns(row: WordRow): Columns | null {
  const words = row.words
  if (!words.length) return null
  if (words[0].text !== 'Type' && words[0].text !== 'CODE') return null

  const at = (label: string) => words.find(w => w.text === label)?.x ?? null
  const size = at('Size')
  const alc = at('Alc%')
  const price = at('Price')
  if (size === null || alc === null || price === null) return null

  return { size, alc, vintage: at('Vintage'), price, remark: at('Remark'), leftEdge: size - LEFT_GUTTER }
}

// A size cell: "750ml", "750 ml" (two words, joined here), "1,500ml" with the
// comma the catalog prints once. Normalised so every 1500ml entry matches.
const SIZE_CELL_RE = /^(?:\d{1,2},\d{3}|\d{2,4})\s?(?:ml|ML|cl|CL|L)\.?$/
const VINTAGE_CELL_RE = /^(?:(?:19|20)\d{2}|NV)$/

// Two rows print the thousands separator as a dot — 1.970 (Giuseppe Cortese,
// Barbera d'Alba) and 1.020 (Muga Reserva 375ml) — and one more as 5.330
// (Buisson, Meursault). The catalog never prices with decimals, so inside the
// price column a dot is a separator. Read and warned about rather than dropped.
const DOT_PRICE_CELL_RE = /^(\d{1,3})\.(\d{3})$/

// The catalog's two ways of printing "no price yet": 51 rows say pending, and
// the two dearest Tesseron Cognacs say Request for Quote, which straddles the
// Price and Remark columns and so is matched across both.
const REQUEST_RE = /^Request\s+for\s+Quote\b/i

export type RowCells = {
  y: number
  left: string        // Type cell + product name, as printed
  leftX: number       // where that text starts, which is what tells prose from a name
  size: string
  vintage: string
  price: PriceCell
  remark: string
  // Words standing in the Size, Alc%, Vintage or Price columns that parse as
  // none of those. A table row has none; a producer paragraph that overran into
  // the table has its sentence spread across all of them. The Remark column is
  // left out, because a critic score parses as nothing by design.
  unexplained: number
}

// Reads one row against its table's columns. Every word goes to the column whose
// label it starts nearest — exact, with no search window and no distance
// tolerance to tune. Measured over the catalog: no cell word is ever within 4pt
// of being equally near two labels, so the assignment is never a close call.
export function rowCells(row: WordRow, c: Columns): RowCells {
  const anchors: [keyof typeof cols, number][] = [['size', c.size], ['alc', c.alc], ['price', c.price]]
  if (c.vintage !== null) anchors.push(['vintage', c.vintage])
  if (c.remark !== null) anchors.push(['remark', c.remark])

  const cols = { size: [] as Word[], alc: [] as Word[], vintage: [] as Word[], price: [] as Word[], remark: [] as Word[] }
  const left: Word[] = []
  for (const w of row.words) {
    if (w.x < c.leftEdge) { left.push(w); continue }
    let best = anchors[0]
    for (const a of anchors) if (Math.abs(w.x - a[1]) < Math.abs(w.x - best[1])) best = a
    cols[best[0]].push(w)
  }

  const join = joinWords
  const sizeText = join(cols.size)
  const vintageText = join(cols.vintage)
  const priceText = join(cols.price)
  const remarkText = join(cols.remark)

  let price: PriceCell = { kind: 'none' }
  let remark = remarkText
  const spanning = [priceText, remarkText].filter(Boolean).join(' ')
  if (REQUEST_RE.test(spanning)) {
    price = { kind: 'pending' }
    remark = spanning.replace(REQUEST_RE, '').trim()
  } else if (/^pending$/i.test(priceText)) {
    price = { kind: 'pending' }
  } else {
    const dotted = DOT_PRICE_CELL_RE.exec(priceText)
    if (dotted) {
      price = { kind: 'num', value: parseInt(dotted[1] + dotted[2], 10) }
      console.warn(`[lovely] price ${JSON.stringify(priceText)} read as ${price.value} — a dot where the catalog otherwise prints a comma: ${JSON.stringify(rowText(row).slice(0, 90))}`)
    } else {
      const n = toIntPrice(priceText)
      if (n !== null) price = { kind: 'num', value: n }
    }
  }

  const explained = (w: Word, column: 'size' | 'alc' | 'vintage' | 'price') =>
    column === 'size' ? SIZE_CELL_RE.test(w.text) || /^(?:\d{1,2},\d{3}|\d{2,4})$/.test(w.text) || /^(?:ml|ML|cl|CL|L)\.?$/.test(w.text)
      : column === 'alc' ? /^\d{1,2}(?:\.\d{1,2})?%?$/.test(w.text)
      : column === 'vintage' ? VINTAGE_CELL_RE.test(w.text)
      : /^[\d,.]+$/.test(w.text) || /^(?:pending|Request|for|Quote)$/i.test(w.text)

  let unexplained = 0
  for (const column of ['size', 'alc', 'vintage', 'price'] as const) {
    for (const w of cols[column]) if (!explained(w, column)) unexplained++
  }

  return {
    y: row.y,
    left: join(left),
    leftX: left.length ? left[0].x : Infinity,
    size: SIZE_CELL_RE.test(sizeText) ? sizeText.replace(/[\s,]/g, '').replace(/\.$/, '') : '',
    vintage: VINTAGE_CELL_RE.test(vintageText) ? vintageText : '',
    price,
    remark,
    unexplained,
  }
}

// ─── Row assembly ──────────────────────────────────────────────────────────

// Stock remarks are typeset at the far left edge, before the product name, and
// pdftotext tears them apart when a type code shares the line: the catalog's
// "low stock" arrives as "low R" on one line and "stock   <name>" on the next.
//
// Both halves are stripped here, before anything looks at the Type cell —
// otherwise "stock   Chateau Cos d'Estournel" reads as an unrecognised Type
// cell named "stock" and the row is dropped. Matched case-sensitively in lower
// case: every one of these fragments is printed lower case, while a product
// name beginning "Low..." (Lowland, Lowe) is not a stock remark.
//
// Twice in the catalog the fragment is glued to the code with no space at all
// ("lowR"), which is why an upper-case letter also ends the fragment. Left
// alone, "lowR" becomes a product of its own and takes the code with it, and
// the row underneath — Blason d'Issan at 1,845 — is dropped for having no
// category.
const STOCK_PREFIX_RE = /^(out of stock|low stock|out of|low|stock)(?=\s|$|[A-Z])/

export function splitStockPrefix(left: string): { stock: string; rest: string } {
  const m = STOCK_PREFIX_RE.exec(left)
  if (!m) return { stock: '', rest: left }
  return { stock: m[1], rest: left.slice(m[0].length).trim() }
}

// ─── Page context: banners and producer prose ──────────────────────────────

// Typographic hyphens. The catalog prints ENTRE‑DEUX‑MERS with U+2011, so a
// matcher restricted to ASCII '-' misses that banner outright and leaks its
// region into the next producer's rows. Normalised only for lookups; the region
// text itself keeps the characters the catalog printed.
const FANCY_DASHES = /[‐‑‒–—]/g

const normBanner = (text: string) =>
  text.replace(FANCY_DASHES, '-').replace(/\s+/g, ' ').trim().toUpperCase()

// A banner is a line that has letters and no lower case. That single test
// covers page banners, region sub-banners and the brand separators printed
// inside a table (TORRE DE OÑA — RIOJA ALAVESA), and unlike /[a-z]/ it is not
// fooled by accents: 'Côte' is not upper case, 'CÔTE' is.
const isBannerText = (text: string) => /\p{L}/u.test(text) && text === text.toUpperCase()

// ARGENTINA → Argentina; CÔTE DE NUITS, BURGUNDY → Côte De Nuits, Burgundy.
const titleCase = (text: string) =>
  text.toLowerCase().replace(/(^|[\s\-‐-—/(,.])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase())

// Page banners that name a style rather than a place: CHAMPAGNE, PROSECCO and
// CAVA are printed where a country would be, so they are mapped to one.
const BANNER_COUNTRY: Record<string, string> = {
  'CHAMPAGNE': 'France',
  'FRENCE SPARKLING': 'France',   // the catalog's own spelling
  'FRENCH SPARKLING': 'France',
  'PROSECCO': 'Italy',
  'CAVA': 'Spain',
  'SPANISH CAVA': 'Spain',
  'ITALIAN': 'Italy',
  'USA': 'USA',
  'UNITED STATES': 'USA',
  'SCOTLAND': 'United Kingdom',
}

// Page banners that set a category instead of a place. On these pages the place
// comes from the sub-banner (DOMINICAN REPUBLIC, JEREZ, SPAIN).
const CATEGORY_BANNERS = new Set(['SPIRITS', 'ACCESSORIES', 'DESSERT WINE', 'FORTIFIED WINE', 'SWEET WINE'])

// Consulted only to tell a country sub-banner from a region one on those
// category pages, where both shapes occur (SRI LANKA, but also TOKAJI under
// HUNGARY DESSERT WINE). On a country-bannered page the sub-banner is always
// the region, so no list is needed there.
const COUNTRIES = new Set([
  'FRANCE', 'ITALY', 'ITALIAN', 'SPAIN', 'USA', 'UNITED STATES', 'ARGENTINA', 'AUSTRALIA',
  'CHILE', 'GERMANY', 'NEW ZEALAND', 'AUSTRIA', 'SOUTH AFRICA', 'HUNGARY', 'SWITZERLAND',
  'UNITED KINGDOM', 'SCOTLAND', 'DOMINICAN REPUBLIC', 'SRI LANKA', 'PORTUGAL', 'GREECE',
  'JAPAN', 'MEXICO', 'CUBA', 'LEBANON', 'ISRAEL', 'GEORGIA', 'MOLDOVA',
  // Spirits countries the catalog does not print today but plausibly will.
  'PERU', 'JAMAICA', 'GUATEMALA', 'VENEZUELA', 'IRELAND', 'BARBADOS',
  'MARTINIQUE', 'INDIA', 'TAIWAN', 'CANADA', 'BRAZIL', 'POLAND', 'SWEDEN',
])

const countryOf = (norm: string) => BANNER_COUNTRY[norm] ?? titleCase(norm)

type Context = {
  category: string | null     // the category page banner, where the page has one
  country: string | null
  region: string | null
  pageHadCountry: boolean     // has anything named a country since this banner?
  prose: string[]             // producer paragraph being collected
}

// A banner's left edge says which kind it is. Measured over all 64 pages: page
// banners are centred, so they start at 130pt and beyond (and every one of the 64
// is centred within 7pt of the page's own centre line); region sub-banners start
// at 81–91pt; the separators printed inside a table start at 31–46pt. 130 has
// 39pt of clearance below it.
const PAGE_BANNER_X = 130

function applyBanner(ctx: Context, text: string, x: number): void {
  const norm = normBanner(text)
  ctx.prose = []

  if (x >= PAGE_BANNER_X) {
    if (CATEGORY_BANNERS.has(norm)) {
      ctx.category = norm
      ctx.region = null
      ctx.pageHadCountry = false
      return
    }
    ctx.category = null
    ctx.country = countryOf(norm)
    ctx.region = null
    ctx.pageHadCountry = true
    return
  }

  if (!ctx.category) { ctx.region = text.replace(/\s+/g, ' ').trim() && titleCase(text.trim()); return }

  // A category page: the sub-banner carries the place, sometimes with the
  // category word glued on (AUSTRIA DESSERT WINE), sometimes as "region,
  // country" (JEREZ, SPAIN).
  const place = norm.replace(/\s*(DESSERT|FORTIFIED|SWEET)\s+WINE$/, '').trim()
  const parts = place.split(/\s*,\s*/)
  if (parts.length > 1 && COUNTRIES.has(parts[parts.length - 1])) {
    ctx.country = countryOf(parts[parts.length - 1])
    ctx.region = titleCase(parts.slice(0, -1).join(', '))
    ctx.pageHadCountry = true
  } else if (COUNTRIES.has(place)) {
    ctx.country = countryOf(place)
    ctx.region = null
    ctx.pageHadCountry = true
  } else {
    // Not a country this list knows. Usually a region under the country the
    // previous sub-banner established (TOKAJI, under HUNGARY DESSERT WINE), but
    // a country page for Peru or Jamaica would land here too and would quietly
    // inherit whatever country came before — Pisco filed as Sri Lankan. So the
    // inheritance is only allowed when this page has already named a country.
    ctx.region = titleCase(place)
    if (!ctx.pageHadCountry && ctx.category !== 'ACCESSORIES') {
      console.warn(`[lovely] sub-banner ${JSON.stringify(text.trim())} on a ${ctx.category} page names no country this parser knows, and none was set on the page — country left empty`)
      ctx.country = null
    }
  }
}

// ─── What a cell can say besides a number ──────────────────────────────────

export type PriceCell =
  | { kind: 'num'; value: number }
  | { kind: 'pending' }     // the catalog prints a word: a real position, no price yet
  | { kind: 'none' }        // no price cell on this row at all

const hasCells = (c: RowCells) => Boolean(c.size) || Boolean(c.vintage) || c.price.kind !== 'none'

// ─── Products ──────────────────────────────────────────────────────────────

// One product: the rows of one printed cluster.
type Product = {
  nameParts: string[]
  type: TypeInfo | null
  rows: RowCells[]
  remarks: string[]
  stock: string[]
  prose: string
  country: string | null
  region: string | null
}

// ─── The core: catalog coordinates → items ─────────────────────────────────

// Rows closer together than this are one cluster — one product, however many
// rows it spreads its cells over.
//
// Measured over all 64 pages, between the rows of a table and after the hanging
// stock remarks have been lifted out: gaps inside a cluster are 4.0, 4.6, 4.7,
// 5.3, 5.4, 9.3, 9.4, 10.6 and 10.7pt, and the gap from one product to the next
// is never less than 13.1pt (Prototype, page 56). 12 sits in that empty band
// with 1.3pt of clearance below and 1.1pt above.
//
// This is what replaced guessing. The old reader worked from `-layout` text,
// where a cluster boundary is simply not recorded, and had to infer ownership
// from how well a product's columns lined up and how evenly its rows sat around
// its name. That inference was wrong at least once — Hermandad's lone 2022 on
// page 14 — and silently: the row became a duplicate vintage and the dedup
// swallowed it.
const CLUSTER_GAP = 12

// An all-caps row's left edge says which kind of banner it is. Measured: the
// separators printed inside a table start at 31–46pt, region sub-banners at
// 81–91pt, and page banners at 130pt and beyond (they are centred on the page).
const SUB_BANNER_X = 60

// Producer prose starts at 150pt and beyond; a product name, or a wrapped half
// of one, starts at 86pt at the furthest. 120 sits in that 64pt-wide gap.
const PROSE_X = 120

// Takes the `pdftotext -bbox` dump of the whole document. Named for what it
// reads: the geometry is in the XML, not in laid-out text.
export function parseCatalogXml(xml: string): ExtractedItem[] {
  const items: ExtractedItem[] = []
  const ctx: Context = { category: null, country: null, region: null, pageHadCountry: false, prose: [] }
  const tally = { oneCluster: 0 }

  for (const pageWords of bboxPages(xml)) {
    const { rows, stock } = liftStockRows(wordRows(pageWords))

    let columns: Columns | null = null
    let skipping = false            // inside a table we refuse (glassware)
    let blockProse = ''
    let cluster: RowCells[] = []
    let clusterStock: string[] = []
    let lastY = -Infinity

    const flush = (): void => {
      if (cluster.length) {
        items.push(...positionsOf(buildProduct(cluster, clusterStock, ctx, blockProse), tally))
      }
      cluster = []
      clusterStock = []
      lastY = -Infinity
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]

      // A header either opens a table we can read or closes whatever was open.
      if (row.words[0].text === 'Type' || row.words[0].text === 'CODE') {
        flush()
        columns = tableColumns(row)
        skipping = columns === null
        blockProse = ctx.prose.join(' ').replace(/\s+/g, ' ').trim()
        ctx.prose = []
        continue
      }

      const text = rowText(row)

      // ── outside a table ────────────────────────────────────────────────────
      if (columns === null) {
        if (isBannerText(text)) applyBanner(ctx, text, row.words[0].x)
        else if (!skipping) ctx.prose.push(text)
        continue
      }

      // ── inside a beverage table ────────────────────────────────────────────
      const cells = rowCells(row, columns)
      const { rest } = splitStockPrefix(cells.left)

      // A banner can appear while a table is still open — the next producer's
      // region, printed before its header. Judged on the whole row, not on the
      // left-hand part: RUPPERTSBERG, DEIDESHEIM, FORST spreads its three words
      // across the cell columns, and reading only the first gives a region
      // truncated to "Ruppertsberg, Deidesheim,". A row with no left-hand words
      // at all is a Remark cell on its own baseline (a critic score in caps), not
      // a banner.
      if (cells.leftX < Infinity && isBannerText(text) && !hasCells(cells)) {
        flush()
        // A separator printed hard against the left margin heads a run of rows
        // inside one table (TORRE DE OÑA — RIOJA ALAVESA) and says nothing about
        // place. Anything further right is a real banner and ends the table.
        if (cells.leftX >= SUB_BANNER_X) { columns = null; applyBanner(ctx, text, cells.leftX) }
        continue
      }

      // Producer prose that overran into the table. Eleven rows in the catalog,
      // and every one is reported: a wrapped product name mistaken for prose
      // would be thrown away with its cells, which is how a phantom priced wine
      // ends up filed under half a sentence.
      // Two shapes of paragraph reach a table: one indented under the brand, at
      // 150pt and beyond, and one set at the left margin like a product row —
      // told apart from a row by its sentence lying across the cell columns,
      // where a table row has nothing that fails to parse. One stray word is not
      // enough: "'Sous Roche' 2320" is a real wrapped name whose vintage the
      // catalog mistyped.
      const looksLikeProse = cells.leftX >= PROSE_X || cells.unexplained >= 2
      if (rest && looksLikeProse && classifyTypeCell(rest).kind !== 'matched') {
        flush()
        console.warn(`[lovely] prose inside a table, discarded${hasCells(cells) ? ' WITH CELLS' : ''}: ${JSON.stringify(text.slice(0, 90))}`)
        continue
      }

      if (row.y - lastY >= CLUSTER_GAP) flush()
      lastY = row.y
      cluster.push(cells)
      clusterStock.push(...(stock[i] ?? []))
    }

    flush()
  }

  if (tally.oneCluster) {
    console.warn(`[lovely] ${tally.oneCluster} clusters print one price for several vintages — paired as printed`)
  }
  return items
}

// ─── One cluster → one product ─────────────────────────────────────────────

function buildProduct(rows: RowCells[], stock: string[], ctx: Context, prose: string): Product {
  const p: Product = {
    nameParts: [], type: null, rows, remarks: [], stock: [...stock], prose,
    country: ctx.country, region: ctx.region,
  }
  for (const row of rows) {
    const { stock: own, rest } = splitStockPrefix(row.left)
    if (own) p.stock.push(own)
    if (row.remark) p.remarks.push(row.remark)
    if (!rest) continue
    const cell = classifyTypeCell(rest)
    if (cell.kind === 'matched') {
      // One cluster is one product, so a second Type cell inside it would mean
      // the gap threshold had merged two products. Worth hearing about.
      if (p.type) {
        console.warn(`[lovely] two Type cells in one cluster: ${JSON.stringify(rows.map(r => r.left).filter(Boolean).join(' / ').slice(0, 110))}`)
      }
      p.type = cell.type
      if (cell.rest) p.nameParts.push(cell.rest)
    } else if (cell.kind === 'unknown') {
      matchType(rest)
    } else {
      p.nameParts.push(rest)
    }
  }
  return p
}

function positionsOf(p: Product, tally: { oneCluster: number }): ExtractedItem[] {
  const name = p.nameParts.join(' ').replace(/\s+/g, ' ').trim()
  if (!p.type) {
    if (name) console.warn(`[lovely] no Type cell in the cluster for ${JSON.stringify(name)} — position dropped`)
    return []
  }
  if (name.length < 4) {
    console.warn(`[lovely] product name too short to be real: ${JSON.stringify(name)} — position dropped`)
    return []
  }

  const rows = p.rows
  const sizes = rows.filter(r => r.size).map(r => ({ y: r.y, value: r.size }))
  const years = rows.filter(r => r.vintage).map(r => ({ y: r.y, value: r.vintage }))
  const prices = rows.filter(r => r.price.kind !== 'none').map(r => ({ y: r.y, value: r.price }))

  // A cluster with a name, a type and not one cell is not a position. It is a
  // row the catalog prints for layout — a brand heading, or half a sentence that
  // reached the table — and emitting it put an all-null row into the database.
  if (!sizes.length && !years.length && !prices.length) {
    console.warn(`[lovely] no size, vintage or price anywhere in the cluster for ${JSON.stringify(name)} — position dropped`)
    return []
  }

  const distinctPrices = new Set(prices.map(c => (c.value.kind === 'num' ? String(c.value.value) : 'pending')))
  if (prices.length >= 1 && years.length > prices.length) {
    // Where a cluster prints more vintages than prices the text does not record
    // which year goes with which price. Two or more distinct prices is the only
    // genuinely ambiguous shape; "these three years all cost X" is the catalog's
    // house style and is only counted, so the log carries one line, not 200.
    if (distinctPrices.size >= 2) {
      const shown = prices.map(c => (c.value.kind === 'num' ? String(c.value.value) : 'pending')).join(', ')
      console.warn(`[lovely] ambiguous cluster — ${years.length} vintages (${years.map(c => c.value).join(', ')}) against ${prices.length} prices (${shown}): ${JSON.stringify(name)}`)
    } else {
      tally.oneCluster++
    }
  }

  // One price shared across two different bottle sizes is a different animal: a
  // magnum would go into the database at the 750ml price. It happens once in the
  // catalog (Tolaini 'Al Passo') and must not hide among the benign ones.
  const distinctSizes = new Set(sizes.map(c => c.value))
  if (distinctSizes.size > 1 && distinctPrices.size === 1 && sizes.length > prices.length) {
    console.warn(`[lovely] ONE PRICE ACROSS ${distinctSizes.size} BOTTLE SIZES (${[...distinctSizes].join(', ')}) — check against the PDF: ${JSON.stringify(name)}`)
  }

  const n = Math.max(1, sizes.length, years.length, prices.length)
  // The spine is the column with a value per position; the others are lined up
  // against it by the baselines they were printed on. Vintage wins a tie because
  // it is the axis the catalog varies most often.
  const spine = [years, sizes, prices].find(list => list.length === n) ?? []
  const spineYs = spine.length ? spine.map(c => c.y) : [rows[0]?.y ?? 0]
  const yearAt = alignToSpine(spineYs, years)
  const priceAt = alignToSpine(spineYs, prices)
  const sizeAt = alignToSpine(spineYs, sizes)

  const description = [
    p.type.note,
    [...new Set(p.stock)].join(' ').replace(/\s+/g, ' ').trim(),
    ...p.remarks,
    p.prose,
  ].filter(Boolean).join(' · ') || null

  const items: ExtractedItem[] = []
  // Deduplicated in place rather than with _shared.dedupBy: the key is built from
  // the three fields as they are being derived, not from the finished item.
  const seen = new Set<string>()
  for (let i = 0; i < n; i++) {
    const year = yearAt[i]
    const price = priceAt[i]
    const volume = sizeAt[i]
    const key = `${volume}|${year}|${price?.kind === 'num' ? price.value : null}`
    if (seen.has(key)) continue
    seen.add(key)
    items.push({
      name,
      country: p.country,
      region: p.region,
      grape_variety: null,
      price: price && price.kind === 'num' ? price.value : null,
      year: year && year !== 'NV' ? parseInt(year, 10) : null,
      volume,
      description,
      category: p.type.category,
      wine_type: p.type.wineType,
      spirit_type: p.type.spiritType,
      supplier_sku: null,
    })
  }
  return items
}

// Lines up one column's cells against the positions of the spine column.
//
// Each cell goes to the spine slot whose baseline it was printed nearest,
// keeping the printed order — which is what "paired positionally" has to mean
// once vintages and prices alternate row by row, as they do in the Comtesse de
// Chérisey tables. Cluster membership is settled before this runs; all that is
// left here is pairing inside one product. A slot left over then takes the nearest cell of that column, because
// a cell centred between two rows serves both: that is how one price covers two
// vintages, and how a bottle size on the name row reaches its vintage rows.
function alignToSpine<T>(spine: number[], cells: { y: number; value: T }[]): (T | null)[] {
  const out: (T | null)[] = spine.map(() => null)
  if (!cells.length) return out

  // Best order-preserving assignment of cells to slots, by total line distance.
  const INF = Infinity
  const best: number[][] = []
  for (let i = 0; i <= spine.length; i++) best.push(new Array(cells.length + 1).fill(INF))
  for (let i = 0; i <= spine.length; i++) best[i][cells.length] = 0
  for (let i = spine.length - 1; i >= 0; i--) {
    for (let j = cells.length - 1; j >= 0; j--) {
      const skip = best[i + 1][j]
      const take = best[i + 1][j + 1] + Math.abs(spine[i] - cells[j].y)
      best[i][j] = Math.min(skip, take)
    }
  }
  let j = 0
  for (let i = 0; i < spine.length && j < cells.length; i++) {
    const take = best[i + 1][j + 1] + Math.abs(spine[i] - cells[j].y)
    if (take <= best[i + 1][j]) { out[i] = cells[j].value; j++ }
  }

  // Slots no cell was assigned to take the nearest one.
  for (let i = 0; i < spine.length; i++) {
    if (out[i] !== null) continue
    let pick = cells[0]
    for (const c of cells) if (Math.abs(c.y - spine[i]) < Math.abs(pick.y - spine[i])) pick = c
    out[i] = pick.value
  }
  return out
}

// ─── Entry point ───────────────────────────────────────────────────────────

// The catalog prints no date in its text layer, so the PDF's own metadata is the
// fallback behind the filename.
export async function pdfModDate(buf: Buffer): Promise<Date | null> {
  try {
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false })
    return doc.getModificationDate() ?? null
  } catch {
    return null
  }
}

export async function parseLovely(
  buf: Buffer,
  filename: string,
  onProgress?: ProgressCb,
): Promise<ExtractionResult> {
  await onProgress?.(10, 'reading pdf')

  const path = await writeTemp(buf)
  let xml = ''
  try {
    // Coordinates, not laid-out text: see the note above `wordRows`.
    xml = await pdftotextBbox(path)
  } finally {
    safeUnlink(path)
  }

  await onProgress?.(40, 'parsing')
  const items = parseCatalogXml(xml)
  console.log(`[lovely] ${items.length} items from ${xml.split('<page').length - 1} pages`)

  // An empty catalog is a failed upload, not a price list of nothing: inserted,
  // it would expire the previous one and leave the browser blank. Either
  // pdftotext is missing, or the catalog has been redesigned.
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
