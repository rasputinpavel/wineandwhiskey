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
])

const countryOf = (norm: string) => BANNER_COUNTRY[norm] ?? titleCase(norm)

type Context = {
  category: string | null     // the category page banner, where the page has one
  country: string | null
  region: string | null
  prose: string[]             // producer paragraph being collected
}

// Indent decides which kind of banner this is: page banners are centred
// (indent > 30) and region sub-banners sit near the left margin.
function applyBanner(ctx: Context, text: string, indent: number): void {
  const norm = normBanner(text)
  ctx.prose = []

  if (indent > 30) {
    if (CATEGORY_BANNERS.has(norm)) { ctx.category = norm; ctx.region = null; return }
    ctx.category = null
    ctx.country = countryOf(norm)
    ctx.region = null
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
  } else if (COUNTRIES.has(place)) {
    ctx.country = countryOf(place)
    ctx.region = null
  } else {
    // Not a country we know (TOKAJI): a region under whatever country the
    // previous sub-banner established.
    ctx.region = titleCase(place)
  }
}

// ─── What a line carries, beyond what readRow reports ──────────────────────

// readRow is deliberately blind to these two: both are about meaning rather
// than geometry, and its Row type is pinned by its own tests.
export type PriceCell =
  | { kind: 'num'; value: number }
  | { kind: 'pending' }     // the catalog prints the word: a real position, no price yet
  | { kind: 'none' }        // no price cell on this line at all

// "pending" is a price here — 51 rows print it instead of a number. It must be
// told apart from an empty price cell, or a vintage row priced "pending"
// silently borrows the price of the row it is centred against.
const PENDING_RE = /pending/i

// Two rows in the September 2026 file print the thousands separator as a dot:
// 1.970 (Giuseppe Cortese, Barbera d'Alba) and 1.020 (Muga Reserva 375ml). The
// catalog never prices with decimals, so inside the price column a dot is a
// separator. Read and warned about rather than dropped — but only as a whole
// token, because the unbounded regex used to read "1.020" as 20.
const DOT_PRICE_RE = /(?<![\d.,])(\d{1,3})\.(\d{3})(?![\d.,])/

type LineCells = {
  line: number
  left: string            // Type cell + name, stock prefix still attached
  size: string
  vintage: string
  price: PriceCell
  remark: string
}

function readCells(line: string, lineNo: number, a: Anchors): LineCells {
  const row = readRow(line, a)

  let price: PriceCell = { kind: 'none' }
  let priceEnd = 0
  if (row.price) {
    const value = toIntPrice(row.price)
    if (value !== null) {
      price = { kind: 'num', value }
      priceEnd = line.indexOf(row.price) + row.price.length
    }
  } else {
    const dotted = near(line, DOT_PRICE_RE, a.price, a)
    if (dotted) {
      price = { kind: 'num', value: parseInt(dotted[1] + dotted[2], 10) }
      priceEnd = dotted.index + dotted[0].length
      console.warn(`[lovely] price ${JSON.stringify(dotted[0])} read as ${price.value} — a dot where the catalog otherwise prints a comma: ${JSON.stringify(line.trim().slice(0, 90))}`)
    } else {
      const word = near(line, PENDING_RE, a.price, a)
      if (word) { price = { kind: 'pending' }; priceEnd = word.index + word[0].length }
    }
  }

  // readRow only reports what trails the price, so a row that has a critic
  // score but no price loses it (Yangarra High Sands prints "100 JS" and no
  // price at all). Reading from the Remark anchor recovers those, clamped past
  // the price token so it can never bite into a number.
  const remark = row.remark || (a.remark === null
    ? ''
    : line.slice(Math.max(a.remark - 2, priceEnd)).trim())

  return { line: lineNo, left: row.left, size: row.size, vintage: row.vintage, price, remark }
}

const hasCells = (c: LineCells) => Boolean(c.size) || Boolean(c.vintage) || c.price.kind !== 'none'

// A Remark cell printed alone on its line: a critic score ("91 WS", "96+ RP",
// "87WE 93JS", "95 RP, 94 JS") or, rarely, a bare stock state.
const RATING_RE = /^\d{2,3}\+?\s*[A-Z]{2}(?:[\s,/]+\d{2,3}\+?\s*[A-Z]{2})*$/

// ─── Products ──────────────────────────────────────────────────────────────

type Product = {
  nameParts: string[]
  type: TypeInfo | null
  // True when the type code was printed alone on its line. That is the signal
  // that the product name is wrapped *around* the code line, and so the only
  // case in which a second name fragment continues this product instead of
  // starting a new one.
  codeAlone: boolean
  // A wrapped name has exactly two halves, one either side of the code line.
  // Once the second has arrived the name is closed: keep absorbing and the next
  // product's name joins this one, and its own row loses its type code.
  tailTaken: boolean
  own: LineCells[]        // rows printed on this product's own lines
  ownLines: number[]
  above: LineCells[]      // centred rows assigned from the gap above
  below: LineCells[]      //                     ... and from the gap below
  ownRemark: boolean      // this product printed a Remark cell of its own
  remarks: string[]
  stock: string[]
  prose: string
  country: string | null
  region: string | null
}

const newProduct = (ctx: Context, prose: string): Product => ({
  nameParts: [], type: null, codeAlone: false, tailTaken: false, own: [], ownLines: [],
  above: [], below: [], ownRemark: false, remarks: [], stock: [], prose,
  country: ctx.country, region: ctx.region,
})

// ─── The core: catalog text → items ────────────────────────────────────────

export function parseCatalogText(text: string): ExtractedItem[] {
  const items: ExtractedItem[] = []
  const ctx: Context = { category: null, country: null, region: null, prose: [] }

  for (const pageText of text.split('\f')) {
    const lines = pageText.split('\n')

    let anchors: Anchors | null = null
    let skipping = false              // inside a table we refuse (glassware)
    let products: Product[] = []
    let gaps: LineCells[][] = [[]]    // gaps[k]: centred rows printed before products[k]
    let cur: Product | null = null
    let prevLine = -99                // last line that fed `cur`, for adjacency
    let blockProse = ''
    let heldRemarks: string[] = []    // ratings printed before their product
    let heldStock: string[] = []

    const open = (): Product => {
      const p = newProduct(ctx, blockProse)
      p.remarks.push(...heldRemarks)
      p.stock.push(...heldStock)
      heldRemarks = []
      heldStock = []
      products.push(p)
      if (!gaps[products.length]) gaps[products.length] = []
      cur = p
      return p
    }

    const flush = (): void => {
      if (products.length) emitBlock(products, gaps, items)
      products = []
      gaps = [[]]
      cur = null
      prevLine = -99
      heldRemarks = []
      heldStock = []
      anchors = null
      skipping = false
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      if (HEADER_RE.test(line)) {
        flush()
        anchors = columnAnchors(line)
        skipping = anchors === null
        blockProse = ctx.prose.join(' ').replace(/\s+/g, ' ').trim()
        ctx.prose = []
        continue
      }

      const bare = line.trim()
      const indent = line.length - line.trimStart().length

      // ── outside a table ──────────────────────────────────────────────────
      if (anchors === null) {
        if (!bare) continue
        if (isBannerText(bare)) applyBanner(ctx, bare, indent)
        else if (!skipping) ctx.prose.push(bare)
        continue
      }

      // ── inside a beverage table ──────────────────────────────────────────
      if (!bare) continue

      const cells = readCells(line, i, anchors)

      // readRow stops the left-hand text at the first cell it located, so on a
      // row with no size, vintage or price at all — a name row centred between
      // its vintage rows — the Alc% and Remark columns come back as part of the
      // name ("...'Cuvee Leonie' Brut 14.5"). A product name can never reach the
      // Size column, because anything that does is producer prose, so that is
      // where the name is cut.
      const raw = cells.left
      const rawStart = raw ? line.indexOf(raw) : 0
      const inCellArea = Boolean(raw) && rawStart >= anchors.size
      // The stock remark comes off before anything looks at the Type cell:
      // otherwise "stock   Chateau Cos d'Estournel" is an unknown Type cell and
      // the row is dropped.
      const unstocked = splitStockPrefix(inCellArea ? '' : raw)
      const stock = unstocked.stock
      const restStart = unstocked.rest ? line.indexOf(unstocked.rest, rawStart) : rawStart
      // A product name is one run of words with no wide gap in it; a producer
      // paragraph is one long run that reaches past the Size column. Measured on
      // that run and not on the whole left-hand text, because readRow hands back
      // the Alc% figure as well on a row with no size, vintage or price of its
      // own — which made "Domaine J.A. Ferret, Pouilly-Fuisse,   13.0" look like
      // a paragraph, so its name was thrown away and the priced row under it
      // dropped for having none.
      const runLength = (unstocked.rest.match(/^\S+(?: \S+)*/) ?? [''])[0].length
      const looksLikeProse = restStart + runLength >= anchors.size
      // The name is cut at the Size column, which is what drops that Alc%.
      const rest = unstocked.rest.slice(0, Math.max(0, anchors.size - restStart)).trimEnd()

      if (!rest) {
        // Nothing to the left of the cells: a centred cell row, a torn stock
        // fragment, or a Remark cell printed alone on its line.
        if (stock) {
          if (cur) { cur.stock.push(stock); prevLine = i } else heldStock.push(stock)
        } else if (!hasCells(cells) && cells.remark && RATING_RE.test(cells.remark)) {
          // Ratings are typeset centred on their product, so one can sit above
          // the name row and another below it. The row above takes it when that
          // row printed no Remark of its own; otherwise it belongs to the next.
          const prev = products[products.length - 1]
          if (prev && !prev.ownRemark) prev.remarks.push(cells.remark)
          else heldRemarks.push(cells.remark)
          continue
        }
        if (hasCells(cells)) gaps[products.length] = (gaps[products.length] ?? []).concat(cells)
        continue
      }

      const cell = classifyTypeCell(rest)

      if (cell.kind === 'matched') {
        const continuesCode: boolean = cell.rest === '' && cur !== null && cur.type === null && i === prevLine + 1
        const p: Product = continuesCode ? cur! : open()
        p.type = cell.type
        if (cell.rest === '') { p.codeAlone = true; p.tailTaken = false }
        if (cell.rest) p.nameParts.push(cell.rest)
        if (stock) p.stock.push(stock)
        p.ownLines.push(i)
        if (hasCells(cells)) p.own.push(cells)
        if (cells.remark) { p.remarks.push(cells.remark); p.ownRemark = true }
        cur = p
        prevLine = i
        continue
      }

      if (cell.kind === 'unknown') { matchType(rest); continue }

      // No Type cell: a banner, the tail of a wrapped product name, or prose.
      if (isBannerText(rest)) {
        // A region banner ends the table. A brand separator printed at column 0
        // (LA RIOJA ALTA, S.A. — RIOJA) only interrupts it.
        if (indent > 5) { flush(); applyBanner(ctx, bare, indent) }
        else { cur = null; prevLine = -99 }
        continue
      }

      // Producer prose runs out past the Size column and into the cell area; a
      // wrapped name fragment stops before it. That is the whole difference
      // between a paragraph and half a product name.
      if (looksLikeProse) { cur = null; prevLine = -99; continue }

      const continues: boolean = cur !== null && i === prevLine + 1 &&
        (cur.nameParts.length === 0 || (cur.codeAlone && !cur.tailTaken))
      const p: Product = continues ? cur! : open()
      if (p.codeAlone) p.tailTaken = true
      p.nameParts.push(rest)
      if (stock) p.stock.push(stock)
      p.ownLines.push(i)
      if (hasCells(cells)) p.own.push(cells)
      if (cells.remark) { p.remarks.push(cells.remark); p.ownRemark = true }
      cur = p
      prevLine = i
    }

    flush()
  }

  return items
}

// ─── Turning one producer's table into items ───────────────────────────────

function emitBlock(products: Product[], gaps: LineCells[][], out: ExtractedItem[]): void {
  const real = dropPhantoms(products, gaps)
  assignCentredRows(real.products, real.gaps)
  for (const p of real.products) out.push(...positionsOf(p))
}

// Some tables head a run of rows with a range label on its own line ("Reserva",
// "Grand Reserva", "Acrux"), and two producer paragraphs wrap far enough to
// reach a table block. Both read as a product with a name, no Type cell and no
// cells of its own — which can never become a position, and so must not take
// part in the centring either, or it competes for its neighbours' rows. Their
// gaps are merged, so the rows they sat between go to the products that printed
// them.
function dropPhantoms(products: Product[], gaps: LineCells[][]): { products: Product[]; gaps: LineCells[][] } {
  const keptProducts: Product[] = []
  const keptGaps: LineCells[][] = [gaps[0] ?? []]
  for (let i = 0; i < products.length; i++) {
    const p = products[i]
    if (p.type === null && p.own.length === 0) {
      keptGaps[keptGaps.length - 1] = keptGaps[keptGaps.length - 1].concat(gaps[i + 1] ?? [])
      continue
    }
    keptProducts.push(p)
    keptGaps.push(gaps[i + 1] ?? [])
  }
  return { products: keptProducts, gaps: keptGaps }
}

// ─── The centring rule, solved once for the whole table ────────────────────
//
// A cell typeset alone on its line is vertically centred and belongs to the
// adjacent rows that lack that cell. In the text layer the vertical gaps that
// say so are gone — a 5pt gap inside a cluster and a 14pt gap between products
// both come out as one newline — so the grouping has to be reconstructed from
// what the cells themselves say. Two things say it, and they are the whole rule:
//
//   1. a product's columns line up. Four vintages are printed against four
//      prices, or against exactly one price that serves them all. A split that
//      leaves three prices against four vintages is the wrong split.
//   2. a product's extra rows are centred on its own row, so they come as
//      evenly above and below as the count allows.
//
// Those two, in that order, reproduce the printed clusters everywhere they were
// checked against the PDF's own coordinates — including the cases that look like
// exceptions from the text alone: Goutorbe-Bouillot, where the row above is the
// one that lacks a size and price; Bussola's Recioto, where the row below
// already has both and still owns the cluster; and the Comtesse de Chérisey
// tables, where vintages and prices alternate across eight lines.
//
// Line distance is the last word only, for the handful of gaps where neither
// says anything.

type Cost = [mismatch: number, balance: number, distance: number]

const addCost = (a: Cost, b: Cost): Cost => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const cheaper = (a: Cost, b: Cost) => (a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) < 0

function clusterCost(p: Product, above: LineCells[], below: LineCells[]): Cost {
  const rows = [...above, ...p.own, ...below]
  const lengths = [
    rows.filter(r => r.size).length,
    rows.filter(r => r.vintage).length,
    rows.filter(r => r.price.kind !== 'none').length,
  ]
  const most = Math.max(...lengths)
  // A column may be printed once per row, or once per *group* of rows: a price
  // centred between two vintage rows serves both, so two prices against four
  // vintages is as regular as four against four. An empty column is simply
  // absent. What is irregular is a count that divides into none of it — three
  // prices against four vintages means a row went to the wrong product.
  const mismatch = lengths.reduce((sum, len) => sum + (len > 0 && most % len !== 0 ? 1 : 0), 0)

  const lines = p.ownLines.length ? p.ownLines : [rows[0]?.line ?? 0]
  const distance = [...above, ...below]
    .reduce((sum, r) => sum + Math.min(...lines.map(l => Math.abs(r.line - l))), 0)

  return [mismatch, Math.abs(above.length - below.length), distance]
}

// Exact: the gap between two products can only be split one way per product, so
// the choices chain and a left-to-right pass over them finds the best whole-table
// grouping. Tables have a handful of products and gaps of a few rows.
function assignCentredRows(products: Product[], gaps: LineCells[][]): void {
  const n = products.length
  const g: LineCells[][] = []
  for (let k = 0; k <= n; k++) g[k] = gaps[k] ?? []

  if (n === 0) {
    const stray = g.reduce((sum, rows) => sum + rows.length, 0)
    if (stray) console.warn(`[lovely] ${stray} centred cell rows in a table with no product rows — dropped`)
    return
  }

  // state[s] = best way to reach "s rows of the next gap given to this product"
  type State = { cost: Cost; splits: number[] } | undefined
  let layer: State[] = [{ cost: [0, 0, 0], splits: [0] }]

  for (let i = 0; i < n; i++) {
    const last = i === n - 1
    const next: State[] = []
    for (let taken = layer.length - 1; taken >= 0; taken--) {
      const state = layer[taken]
      if (!state) continue
      const above = g[i].slice(taken)
      // The gap after the last product has nobody else to go to.
      const choices = last ? [g[i + 1].length] : countDown(g[i + 1].length)
      for (const give of choices) {
        const cost = addCost(state.cost, clusterCost(products[i], above, g[i + 1].slice(0, give)))
        if (!next[give] || cheaper(cost, next[give]!.cost)) {
          next[give] = { cost, splits: [...state.splits, give] }
        }
      }
    }
    layer = next
  }

  const splits = layer.find(Boolean)!.splits
  for (let i = 0; i < n; i++) {
    products[i].above = g[i].slice(splits[i])
    products[i].below = g[i + 1].slice(0, splits[i + 1])
  }
}

// [k, k-1, ..., 0] — descending so that a tie hands the row to the product
// above, which is the side the catalog's own remark rule prefers too.
const countDown = (k: number) => Array.from({ length: k + 1 }, (_, i) => k - i)

function positionsOf(p: Product): ExtractedItem[] {
  const name = p.nameParts.join(' ').replace(/\s+/g, ' ').trim()
  if (!p.type) {
    if (name) console.warn(`[lovely] no Type cell ever arrived for ${JSON.stringify(name)} — position dropped`)
    return []
  }
  if (name.length < 4) {
    console.warn(`[lovely] product name too short to be real: ${JSON.stringify(name)} — position dropped; rows ${JSON.stringify([...p.above,...p.own,...p.below].map(r=>`${r.line}:${r.size}/${r.vintage}/${JSON.stringify(r.price)}`))}`)
    return []
  }

  const rows = [...p.above, ...p.own, ...p.below]
  const sizes = rows.filter(r => r.size).map(r => ({ line: r.line, value: r.size }))
  const years = rows.filter(r => r.vintage).map(r => ({ line: r.line, value: r.vintage }))
  const prices = rows.filter(r => r.price.kind !== 'none').map(r => ({ line: r.line, value: r.price }))
  const remarks = [...p.remarks, ...p.above.map(r => r.remark), ...p.below.map(r => r.remark)].filter(Boolean)

  // Where a cluster prints more vintages than prices, the text layer does not
  // record which year goes with which price — Yangarra's 'GSM' prints two
  // vintages against one price value. They are paired positionally and named
  // here, as a short list to check by eye against the PDF.
  if (prices.length >= 1 && years.length > prices.length) {
    const shown = prices.map(c => (c.value.kind === 'num' ? String(c.value.value) : 'pending')).join(', ')
    const listed = years.map(c => c.value).join(', ')
    console.warn(`[lovely] ambiguous cluster — ${years.length} vintages (${listed}) against ${prices.length} prices (${shown}): ${JSON.stringify(name)}`)
  }

  const n = Math.max(1, sizes.length, years.length, prices.length)

  const description = [
    p.type.note,
    p.stock.join(' ').replace(/\s+/g, ' ').trim(),
    ...remarks,
    p.prose,
  ].filter(Boolean).join(' · ') || null

  // The spine is the column with a value per position; the others are lined up
  // against it by the lines they were printed on. Vintage wins a tie because it
  // is the axis the catalog varies most often.
  const spine = [years, sizes, prices].find(list => list.length === n) ?? []
  const spineLines = spine.length ? spine.map(c => c.line) : [rows[0]?.line ?? 0]
  const yearAt = alignToSpine(spineLines, years)
  const priceAt = alignToSpine(spineLines, prices)
  const sizeAt = alignToSpine(spineLines, sizes)

  const items: ExtractedItem[] = []
  const seen = new Set<string>()
  for (let i = 0; i < n; i++) {
    const year = yearAt[i]
    const price = priceAt[i]
    const volume = sizeAt[i]
    const key = `${volume}|${year}|${price?.kind === 'num' ? price.value : null}`
    if (seen.has(key)) continue      // the text layer prints some rows twice
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
// Each cell goes to the spine slot it was printed closest to, keeping the
// printed order — which is what "paired positionally" has to mean once vintages
// and prices alternate line by line, as they do in the Comtesse de Chérisey
// tables. A slot left over then takes the nearest cell of that column, because
// a cell centred between two rows serves both: that is how one price covers two
// vintages, and how a bottle size on the name row reaches its vintage rows.
function alignToSpine<T>(spine: number[], cells: { line: number; value: T }[]): (T | null)[] {
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
      const take = best[i + 1][j + 1] + Math.abs(spine[i] - cells[j].line)
      best[i][j] = Math.min(skip, take)
    }
  }
  let j = 0
  for (let i = 0; i < spine.length && j < cells.length; i++) {
    const take = best[i + 1][j + 1] + Math.abs(spine[i] - cells[j].line)
    if (take <= best[i + 1][j]) { out[i] = cells[j].value; j++ }
  }

  // Slots no cell was assigned to take the nearest one.
  for (let i = 0; i < spine.length; i++) {
    if (out[i] !== null) continue
    let pick = cells[0]
    for (const c of cells) if (Math.abs(c.line - spine[i]) < Math.abs(pick.line - spine[i])) pick = c
    out[i] = pick.value
  }
  return out
}
