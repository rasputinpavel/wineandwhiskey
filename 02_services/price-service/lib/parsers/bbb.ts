// BB&B (Bangkok Beer & Beverages) deterministic price-list parser.
//
// Why deterministic instead of Claude:
//   The PDF (Canva-generated, ~96 pages, ~2000 SKUs) has selectable text and a
//   stable column layout per category. `pdftotext -layout` returns clean rows
//   we can parse directly — no token limits, no JSON truncation, no dedup loss.
//
// Strategy:
//   1. Render layout text page-by-page via `pdftotext -layout -f N -l N`.
//   2. On each page, find the table header line (starts with "Code") and
//      record the x-position of every column word — that's our slicing grid.
//   3. Walk lines below the header; SKU-prefixed rows get sliced by columns,
//      ALL-CAPS / centered headings update the running context (category,
//      country, winery).
//
// Hard rules:
//   - We extract ONLY the SPIRITS section (pages 12-18) and the WINE section
//     (pages 27-95). Everything else (coffee/tea, beer, sake, accessories,
//     mineral water) is ignored.
//   - SKU is the dedup key (`supplier_sku`). Two rows with the same name but
//     different SKUs (e.g. /BOX, /350, different vintages) are kept separate.

import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ExtractedItem, ExtractionResult } from '../claude'
import { normalizeSpiritType } from '../classify'

const exec = promisify(execFile)

// Page ranges for sections we care about.
const SPIRITS_PAGES: [number, number] = [12, 18]
const WINE_PAGES: [number, number] = [27, 95]

// SKU pattern: 2 digits, 2-4 letters, digits, optional /suffix segments.
//   28ROC011265/BOX, 03CTS641667, 06DCA711093/700ML, 03MOU651672/10/1.5L
const SKU_RE = /^\d{2}[A-Z]{2,4}\d+(?:\/[A-Za-z0-9.\-]+)*$/

// Spirits sub-categories — used as wine_type=null, category="spirits".
const SPIRIT_CATEGORIES = new Set([
  'BRANDY', 'COGNAC', 'GRAPPA', 'VODKA', 'WHISKY', 'WHISKEY',
  'RICE SPIRIT', 'TEQUILA', 'GIN', 'SHOCHU', 'LIQUEURS', 'RUM',
  'ARMAGNAC', 'CALVADOS', 'EAU DE VIE', 'BITTERS', 'VERMOUTH', 'APERITIF',
])

// Wine sub-sections that aren't a country (handled before per-country pages).
const WINE_NON_COUNTRY_SECTIONS = new Set([
  'SPARKLING WINE', 'SPUMANTE AND LAMBRUSCO', 'CHAMPAGNE',
  'SWEET WINE / DESSERT WINES', 'PORT AND SWEET FORTIFIED WINES',
  'HALF BOTTLE AND SMALL SIZE', 'LARGE FORMAT',
])

// Country headings that introduce a per-country block on pages 34+.
const COUNTRY_HEADINGS = new Set([
  'ARGENTINA', 'AUSTRALIA', 'AUSTRIA', 'CHILE', 'CHINA', 'FRANCE',
  'GEORGIA', 'GERMANY', 'ITALY', 'JAPAN', 'NEW ZEALAND',
  'SPAIN & PORTUGAL', 'SPAIN', 'PORTUGAL', 'SOUTH AFRICA', 'USA',
])

type ColumnGrid = {
  // Map: column header word → starting x-position in the layout line.
  positions: { name: string; start: number }[]
  hasCountry: boolean
  hasRating: boolean
  hasSize: boolean // present on spirits, absent on wines
  hasAlc: boolean
  hasVintage: boolean
  hasType: boolean
  hasBrandOrWinery: 'Brand' | 'Winery' | null
}

type ParseContext = {
  section: 'spirits' | 'wine'
  category: string | null // BRANDY, WHISKY, SPARKLING WINE, CHAMPAGNE, ARGENTINA, etc.
  country: string | null // sticky from country-block headings
  winery: string | null // sticky from winery sub-headers
  region: string | null // parsed from winery line "(REGION)"
  lastCountry: string | null // last seen country in a row (for wraparound rows)
}

export async function isBBB(pdfBuffer: Buffer): Promise<boolean> {
  // Quick check: first page text contains the BB&B name.
  const path = await writeTemp(pdfBuffer)
  try {
    const text = await pdftotextLayout(path, 1, 1)
    return /BANGKOK BEER AND BEVERAGES/i.test(text) ||
           /BB&B Price List/i.test(text) ||
           /BB&B/i.test(text)
  } finally {
    safeUnlink(path)
  }
}

export async function parseBBB(pdfBuffer: Buffer): Promise<ExtractionResult> {
  const path = await writeTemp(pdfBuffer)
  try {
    const items: ExtractedItem[] = []
    const skuSeen = new Set<string>()

    // Detect price list date from page 1.
    const firstPage = await pdftotextLayout(path, 1, 1)
    const date = parseDate(firstPage)

    // Spirits: each section page has its own header; categories switch within page.
    const ctxSpirits: ParseContext = {
      section: 'spirits', category: null, country: null,
      winery: null, region: null, lastCountry: null,
    }
    for (let p = SPIRITS_PAGES[0]; p <= SPIRITS_PAGES[1]; p++) {
      const text = await pdftotextLayout(path, p, p)
      parsePage(text, ctxSpirits, items, skuSeen)
    }

    // Wine: pages 27-33 are non-country sections (Sparkling, Champagne,
    // Sweet, Port, Half Bottle, Large Format) which carry an explicit
    // Country column. Pages 34+ are per-country blocks where country
    // comes from the section heading.
    const ctxWine: ParseContext = {
      section: 'wine', category: null, country: null,
      winery: null, region: null, lastCountry: null,
    }
    for (let p = WINE_PAGES[0]; p <= WINE_PAGES[1]; p++) {
      const text = await pdftotextLayout(path, p, p)
      parsePage(text, ctxWine, items, skuSeen)
    }

    return {
      supplier_name: 'Bangkok Beer & Beverages',
      price_list_date: date,
      currency: 'THB',
      items,
    }
  } finally {
    safeUnlink(path)
  }
}

// ─── Page parsing ───────────────────────────────────────────────────────────

function parsePage(
  pageText: string,
  ctx: ParseContext,
  out: ExtractedItem[],
  skuSeen: Set<string>,
) {
  const lines = pageText.split('\n')
  let grid: ColumnGrid | null = null

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) continue
    if (/^\s*\d+\s*$/.test(line)) continue // page number
    if (isJustHeaderArtifact(line)) continue

    // Header row: contains "Code" as first non-empty word.
    if (isHeaderRow(line)) {
      grid = buildGrid(line)
      continue
    }

    // SKU row?
    const trimmed = line.trim()
    const firstToken = trimmed.split(/\s+/)[0]
    if (grid && SKU_RE.test(firstToken)) {
      const item = parseRow(line, grid, ctx)
      if (item && item.supplier_sku) {
        const key = item.supplier_sku.toLowerCase()
        if (!skuSeen.has(key)) {
          skuSeen.add(key)
          out.push(item)
        }
      }
      continue
    }

    // Heading: spirits sub-category, wine non-country section, or country.
    const heading = detectHeading(trimmed, ctx)
    if (heading) {
      applyHeading(heading, ctx)
      continue
    }

    // Winery / producer sub-header (e.g. "BODEGAS SALENTEIN (UCO VALLEY, MENDOZA)").
    const winery = detectWineryHeader(trimmed, ctx)
    if (winery) {
      ctx.winery = winery.name
      ctx.region = winery.region
      continue
    }
  }
}

// ─── Detection helpers ──────────────────────────────────────────────────────

function isHeaderRow(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.startsWith('Code')) return false
  // Should also contain "Price" near the end.
  return /\bPrice\b/.test(trimmed)
}

function isJustHeaderArtifact(line: string): boolean {
  const t = line.trim()
  if (!t) return true
  // Section banner words rendered solo above tables (e.g. "SPIRITS", "WINE")
  if (/^(SPIRITS|WINE|BEVERAGES|ACCESSORIES|CATALOG)$/i.test(t)) return true
  return false
}

function buildGrid(headerLine: string): ColumnGrid {
  const positions: { name: string; start: number }[] = []
  // Match each header word and its starting char position.
  const HEADER_WORDS = [
    'Code', 'Brand', 'Winery', 'Varieties', 'Country',
    'Rating', 'Type', 'Size', 'Alc.', 'Vintage', 'Price',
  ]
  for (const w of HEADER_WORDS) {
    // Word-boundary search in the line. For "Alc." match literally.
    const re = w === 'Alc.' ? /\bAlc\./ : new RegExp(`\\b${w}\\b`)
    const m = headerLine.match(re)
    if (m && m.index !== undefined) {
      positions.push({ name: w, start: m.index })
    }
  }
  positions.sort((a, b) => a.start - b.start)

  return {
    positions,
    hasCountry: positions.some(p => p.name === 'Country'),
    hasRating: positions.some(p => p.name === 'Rating'),
    hasSize: positions.some(p => p.name === 'Size'),
    hasAlc: positions.some(p => p.name === 'Alc.'),
    hasVintage: positions.some(p => p.name === 'Vintage'),
    hasType: positions.some(p => p.name === 'Type'),
    hasBrandOrWinery: positions.some(p => p.name === 'Brand') ? 'Brand'
      : positions.some(p => p.name === 'Winery') ? 'Winery' : null,
  }
}

function sliceColumn(line: string, grid: ColumnGrid, name: string): string {
  const idx = grid.positions.findIndex(p => p.name === name)
  if (idx < 0) return ''
  const start = grid.positions[idx].start
  const end = idx + 1 < grid.positions.length ? grid.positions[idx + 1].start : line.length
  // Pad if line shorter than column position (rare wraparound rows).
  const padded = line.length < end ? line.padEnd(end, ' ') : line
  return padded.slice(start, end).trim()
}

// Country dictionary used to validate / clean country values.
const COUNTRY_DICT: { canonical: string; patterns: RegExp[] }[] = [
  { canonical: 'France',       patterns: [/^France\b/i] },
  { canonical: 'Italy',        patterns: [/^Italy\b/i] },
  { canonical: 'Spain',        patterns: [/^Spain\b/i] },
  { canonical: 'Portugal',     patterns: [/^Portugal\b/i] },
  { canonical: 'Argentina',    patterns: [/^Argentina\b/i] },
  { canonical: 'Australia',    patterns: [/^Australia\b/i] },
  { canonical: 'Austria',      patterns: [/^Austria\b/i] },
  { canonical: 'Chile',        patterns: [/^Chile\b/i] },
  { canonical: 'China',        patterns: [/^China\b/i] },
  { canonical: 'Georgia',      patterns: [/^Georgia\b/i] },
  { canonical: 'Germany',      patterns: [/^Germany\b/i] },
  { canonical: 'Japan',        patterns: [/^Japan\b/i] },
  { canonical: 'New Zealand',  patterns: [/^New\s*Zealand\b/i, /^ew\s*Zealand\b/i] },
  { canonical: 'South Africa', patterns: [/^South\s*Africa\b/i] },
  { canonical: 'USA',          patterns: [/^USA\b/i, /^Usa\b/i, /^US\b/i] },
  { canonical: 'Mexico',       patterns: [/^Mexico\b/i] },
  { canonical: 'Scotland',     patterns: [/^Scotland\b/i] },
  { canonical: 'Ireland',      patterns: [/^Ireland\b/i] },
  { canonical: 'Sweden',       patterns: [/^Sweden\b/i] },
  { canonical: 'Siberia',      patterns: [/^Siberia\b/i] },
  { canonical: 'Thailand',     patterns: [/^Thailand\b/i] },
]

function matchCountry(s: string): string | null {
  const t = (s || '').trim()
  for (const { canonical, patterns } of COUNTRY_DICT) {
    if (patterns.some(p => p.test(t))) return canonical
  }
  return null
}

// Wine type word tokens recognized in the Type column.
const WINE_TYPE_RE = /^(Red|White|Ros[ée]|Sparkling|Champagne|Cr[ée]mant|Cremant|Prosecco|Spumante|Frizzante|Port|Sweet|Dessert|Sweet\s+fortified|Fortified)\b/i

// Vintage token: 4-digit year, NV, or slash-joined years (2020/2021).
const VINTAGE_RE = /^(NV|(?:19|20)\d{2}(?:\/(?:19|20)?\d{2,4})*)$/i

// Price token: number with optional commas/decimals, optional " In-vat" suffix.
const PRICE_RE = /^[\d,]+(?:\.\d+)?(?:\s*In[- ]?Vat)?$/i

// Volume token: e.g., "700 ml", "1,000 ml", "200 ml x 3"
const SIZE_RE = /^\d[\d,\.]*\s*(?:ml|L|liter|cl)\b/i

// Alc.: "40%", "46.2%"
const ALC_RE = /^\d+(?:\.\d+)?%$/

function detectHeading(line: string, ctx: ParseContext): string | null {
  // Section banner styles in BB&B are centered or left-padded all-caps text.
  // Examples: "SPARKLING WINE", "CHAMPAGNE", "ARGENTINA", "BRANDY",
  // "SPAIN & PORTUGAL", "PORT AND SWEET FORTIFIED WINES",
  // "HALF BOTTLE AND SMALL SIZE", "LARGE FORMAT".
  // Rules: all chars in [A-Z & / \s], at least one letter, no digits.
  if (!/^[A-Z][A-Z\s&\/'\.\-]*$/.test(line)) return null
  if (line.length < 3 || line.length > 60) return null

  // Strip "NEW!" suffix and similar markers
  const clean = line.replace(/\s+NEW!\s*$/, '').replace(/\s+RARE\s*$/, '').trim()

  // Match against known buckets
  if (SPIRIT_CATEGORIES.has(clean)) return clean
  if (WINE_NON_COUNTRY_SECTIONS.has(clean)) return clean
  if (COUNTRY_HEADINGS.has(clean)) return clean
  return null
}

function applyHeading(heading: string, ctx: ParseContext) {
  if (ctx.section === 'spirits') {
    if (SPIRIT_CATEGORIES.has(heading)) {
      ctx.category = heading
    }
    return
  }
  // wine
  if (WINE_NON_COUNTRY_SECTIONS.has(heading)) {
    ctx.category = heading
    ctx.country = null
    ctx.winery = null
    ctx.region = null
    return
  }
  if (COUNTRY_HEADINGS.has(heading)) {
    ctx.category = heading
    ctx.country = normalizeCountry(heading)
    ctx.winery = null
    ctx.region = null
  }
}

function normalizeCountry(c: string): string {
  if (c === 'SPAIN & PORTUGAL') return 'Spain' // mixed-block leader, refined per-row when possible
  if (c === 'USA') return 'USA'
  return c.toLowerCase().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function detectWineryHeader(line: string, ctx: ParseContext): { name: string; region: string | null } | null {
  if (ctx.section !== 'wine') return null
  if (line.length < 3 || line.length > 100) return null
  // Pattern: "WINERY NAME (REGION ...)" or "WINERY NAME"
  // All-caps name, optional "(...)" trailing, no digits at start.
  const m = line.match(/^([A-ZÀ-ÿ][A-ZÀ-ÿ\s&'\-\.]+?)(?:\s*\(([^)]+)\))?\s*$/)
  if (!m) return null
  const name = m[1].trim()
  // Avoid swallowing section/country headings (already handled).
  if (COUNTRY_HEADINGS.has(name) || WINE_NON_COUNTRY_SECTIONS.has(name)) return null
  if (SPIRIT_CATEGORIES.has(name)) return null
  // Must be at least 4 chars, contain at least one space OR be a known multi-word producer.
  if (name.length < 4) return null
  return { name: titleCase(name), region: m[2]?.trim() ?? null }
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-zà-ÿ])/g, c => c.toUpperCase())
}

// ─── Row parsing ────────────────────────────────────────────────────────────

function parseRow(line: string, grid: ColumnGrid, ctx: ParseContext): ExtractedItem | null {
  // SKU is the first whitespace-delimited word; everything after is column
  // data tokenized by 2+ spaces. (Splitting the whole line by 2+ spaces only
  // would merge SKU with winery when a single space separates them.)
  const trimmed = line.trim()
  const firstWordEnd = trimmed.search(/\s/)
  if (firstWordEnd <= 0) return null
  const sku = trimmed.slice(0, firstWordEnd)
  if (!SKU_RE.test(sku)) return null
  if (/^(soon|tba|n\/a|coming)$/i.test(sku)) return null

  const rest = trimmed.slice(firstWordEnd).replace(/^\s+/, '')
  const tokens = rest.split(/\s{2,}/).map(t => t.trim()).filter(Boolean)
  if (tokens.length === 0) return null
  // Prepend SKU as a synthetic token so existing logic stays consistent.
  tokens.unshift(sku)

  // ── Right-peel suffix tokens ──────────────────────────────────────────────
  // Strategy: pop from the end of `tokens` matching expected patterns. If a
  // single token holds a merged cluster (rare on dense rating rows), split it
  // by content with regex.
  const remain = tokens.slice() // we'll pop from the end
  let priceRaw: string | null = null
  let vintageRaw: string | null = null
  let typeRaw: string | null = null
  let ratingRaw: string | null = null
  let countryRaw: string | null = null
  let sizeRaw: string | null = null

  if (ctx.section === 'spirits') {
    // Schema: [..., Country, Size, Alc., Price]
    priceRaw = popMatch(remain, PRICE_RE)
    popMatch(remain, ALC_RE)
    sizeRaw = popMatch(remain, SIZE_RE)
    countryRaw = popCountry(remain)
  } else {
    // Wine. Schema variants:
    //   country pages:        [..., Type, Vintage, Price] (rating optional)
    //   non-country pages:    [..., Country, [Rating], Type, Vintage, Price]
    // Order matters: peel right-to-left exactly per schema.
    priceRaw = popMatch(remain, PRICE_RE)
    vintageRaw = popMatch(remain, VINTAGE_RE)
    typeRaw = popMatch(remain, WINE_TYPE_RE)
    // Optional Rating sits between Country and Type. Only peel if at least
    // 4 tokens remain so we don't accidentally pop the name when it contains
    // digits (e.g. "Nicolas Feuillatte Brut Réserve 375 ml").
    if (grid.hasRating && remain.length > 3) {
      const candidate = remain[remain.length - 1]
      if (candidate && !matchCountry(candidate) && !WINE_TYPE_RE.test(candidate) && !VINTAGE_RE.test(candidate) && !PRICE_RE.test(candidate)) {
        // Rating tokens look like "WS 94", "JS 92", "Jeb Dunnuck 95".
        if (/^[A-Z]{2,3}\s+\d{2,3}\b/.test(candidate) || /^[A-Z][a-zA-Z]+(\s+[A-Z][a-zA-Z]+)?\s+\d{2,3}\b/.test(candidate)) {
          ratingRaw = remain.pop() ?? null
        }
      }
    }
    if (grid.hasCountry) {
      // The country slot may hold either a clean country, or a merged
      // cluster like "France Jeb Dunnuck 95 Champagne NV" (where pdftotext
      // collapsed Country/Rating/Type/Vintage into a single token).
      const lastTok = remain.length > 0 ? remain[remain.length - 1] : ''
      if (lastTok && /\s/.test(lastTok) && matchCountry(lastTok)) {
        // Multi-word token starting with a country: try cluster decomposition.
        const cluster = decomposeCluster(lastTok)
        if (cluster && cluster.country && (cluster.rating || cluster.type || cluster.vintage)) {
          remain.pop()
          countryRaw = cluster.country
          if (!ratingRaw && cluster.rating) ratingRaw = cluster.rating
          if (!typeRaw && cluster.type) typeRaw = cluster.type
          if (!vintageRaw && cluster.vintage) vintageRaw = cluster.vintage
        } else {
          // Plain multi-word country (e.g. "New Zealand", "South Africa").
          countryRaw = remain.pop() ?? null
        }
      } else if (lastTok && matchCountry(lastTok)) {
        // Single-word country.
        countryRaw = remain.pop() ?? null
      }
    }
  }

  // Fallback: if some right-side fields are still missing, the last remaining
  // token may be a fully merged "Name ... Type Vintage Price" cluster (single
  // spaces throughout). Peel from its tail.
  if (remain.length > 0 && (priceRaw === null || vintageRaw === null || typeRaw === null)) {
    const last = remain[remain.length - 1]
    const tail = peelTail(last, { needPrice: priceRaw === null, needVintage: vintageRaw === null, needType: typeRaw === null })
    if (tail) {
      if (tail.priceRaw && !priceRaw) priceRaw = tail.priceRaw
      if (tail.vintageRaw && !vintageRaw) vintageRaw = tail.vintageRaw
      if (tail.typeRaw && !typeRaw) typeRaw = tail.typeRaw
      // Replace the last token with the trimmed remainder.
      remain[remain.length - 1] = tail.head
      if (!remain[remain.length - 1]) remain.pop()
    }
  }

  // Whatever is left should be: [SKU, Brand/Winery, Varieties...] possibly
  // collapsed if separators were single spaces. tokens[0] = SKU was already
  // included in `remain`; pop it so we work with name parts only.
  // (We didn't pop SKU from remain yet.)
  if (remain[0] === sku) remain.shift()

  const nameParts = remain.join(' ').replace(/\s+/g, ' ').trim()

  // Try to split brand/winery from varieties using the sticky winery context.
  let brandOrWinery = ''
  let varieties = nameParts
  if (ctx.winery) {
    const w = ctx.winery
    const wLower = w.toLowerCase()
    if (nameParts.toLowerCase().startsWith(wLower)) {
      brandOrWinery = nameParts.slice(0, w.length)
      varieties = nameParts.slice(w.length).trim()
    }
  }
  // Fallback: assume the first 1-3 words are winery if no context.
  if (!brandOrWinery && remain.length >= 2) {
    // remain may have collapsed brand+varieties into one token; in that case
    // we keep nameParts as the full name and leave brand empty.
    if (remain.length >= 2 && !remain[0].includes(' ')) {
      // Heuristic: if first remaining token has 1-3 words it's likely brand
      // (e.g., "Lanson", "Marie Brizard", "Jacob's Creek"). Take first token
      // as brand, rest as varieties.
      brandOrWinery = remain[0]
      varieties = remain.slice(1).join(' ')
    }
  }

  // ── Resolve country ───────────────────────────────────────────────────────
  let resolvedCountry: string | null = null
  if (countryRaw) {
    resolvedCountry = matchCountry(countryRaw) || cleanCell(countryRaw) || null
  }
  if (!resolvedCountry) {
    // Try sticky country from previous row (handles wraparound) or section.
    if (ctx.country) resolvedCountry = ctx.country
    else if (ctx.lastCountry) resolvedCountry = ctx.lastCountry
  }
  if (resolvedCountry) ctx.lastCountry = resolvedCountry

  // ── Build item ────────────────────────────────────────────────────────────
  const price = parsePrice(priceRaw || '')
  const year = parseYear(vintageRaw || '')
  const volume = parseVolume(sizeRaw || '', varieties, sku)
  const wineType: ExtractedItem['wine_type'] =
    ctx.section === 'wine' ? mapWineType((typeRaw || '') + ' ' + (ctx.category || '')) : null
  const category: ExtractedItem['category'] = ctx.section === 'spirits' ? 'spirits' : 'wine'
  const spiritType = ctx.section === 'spirits' && ctx.category
    ? normalizeSpiritType(ctx.category)
    : null

  const descParts: string[] = []
  if (ratingRaw) descParts.push(ratingRaw)
  if (ctx.section === 'wine' && ctx.winery && brandOrWinery && ctx.winery.toLowerCase() !== brandOrWinery.toLowerCase()) {
    descParts.push(ctx.winery)
  }

  const name = composeName(brandOrWinery, varieties || nameParts)
  if (!name) return null

  return {
    name,
    country: resolvedCountry,
    region: ctx.section === 'wine' ? ctx.region : null,
    grape_variety: extractGrapesFromVarieties(varieties),
    price,
    year,
    volume,
    description: descParts.length ? descParts.join(' • ') : null,
    category,
    wine_type: wineType,
    spirit_type: spiritType,
    supplier_sku: sku,
  } as ExtractedItem & { supplier_sku: string }
}

// Pop the last token from `tokens` if it matches the regex; else return null.
function popMatch(tokens: string[], re: RegExp): string | null {
  if (tokens.length === 0) return null
  const last = tokens[tokens.length - 1]
  if (re.test(last)) {
    tokens.pop()
    return last
  }
  return null
}

// Pop the last token if it matches a known country.
function popCountry(tokens: string[]): string | null {
  if (tokens.length === 0) return null
  const last = tokens[tokens.length - 1]
  if (matchCountry(last)) {
    tokens.pop()
    return last
  }
  return null
}

// Peel price/vintage/type from the right end of a merged token, returning
// what's left as `head`. Used when pdftotext joined trailing columns into
// a single token with single spaces (e.g. "Côtes du Rhône Rouge Red 2021/2022/2023 680").
function peelTail(s: string, want: { needPrice: boolean; needVintage: boolean; needType: boolean }): {
  head: string
  priceRaw: string | null
  vintageRaw: string | null
  typeRaw: string | null
} | null {
  if (!s) return null
  let head = s
  let priceRaw: string | null = null
  let vintageRaw: string | null = null
  let typeRaw: string | null = null

  if (want.needPrice) {
    const m = head.match(/(?:^|\s)([\d,]+(?:\.\d+)?)(?:\s*In[- ]?Vat)?\s*$/i)
    if (m) {
      priceRaw = m[1]
      head = head.slice(0, m.index! + (m[0].startsWith(' ') ? 1 : 0)).trimEnd()
    }
  }
  if (want.needVintage) {
    const m = head.match(/(?:^|\s)(NV|(?:19|20)\d{2}(?:\/(?:19|20)?\d{2,4})*)\s*$/i)
    if (m) {
      vintageRaw = m[1]
      head = head.slice(0, m.index! + (m[0].startsWith(' ') ? 1 : 0)).trimEnd()
    }
  }
  if (want.needType) {
    const m = head.match(/(?:^|\s)(Sweet\s+fortified|Sweet|Dessert|Fortified|Port|Champagne|Sparkling|Cr[ée]mant|Prosecco|Spumante|Frizzante|Red|White|Ros[ée])\s*$/i)
    if (m) {
      typeRaw = m[1]
      head = head.slice(0, m.index! + (m[0].startsWith(' ') ? 1 : 0)).trimEnd()
    }
  }

  if (!priceRaw && !vintageRaw && !typeRaw) return null
  return { head: head.trim(), priceRaw, vintageRaw, typeRaw }
}

// Decompose a merged cluster like "France Jeb Dunnuck 95 Champagne NV" into
// {country, rating, type, vintage}. Used when pdftotext joined adjacent
// columns with single spaces.
function decomposeCluster(s: string): {
  country: string | null
  rating: string | null
  type: string | null
  vintage: string | null
} | null {
  // Find country at start.
  const cMatch = COUNTRY_DICT.find(({ patterns }) => patterns.some(p => p.test(s)))
  if (!cMatch) return null
  const countryWord = cMatch.canonical
  let rest = s.replace(cMatch.patterns.find(p => p.test(s))!, '').trim()

  // Find vintage at end.
  let vintage: string | null = null
  const vMatch = rest.match(/(NV|(?:19|20)\d{2}(?:\/(?:19|20)?\d{2,4})*)\s*$/i)
  if (vMatch) {
    vintage = vMatch[1]
    rest = rest.slice(0, vMatch.index).trim()
  }

  // Find type word (greedy: prefer "Sweet fortified" over "Sweet").
  let type: string | null = null
  const tMatch = rest.match(/(Sweet\s+fortified|Sweet|Dessert|Fortified|Port|Champagne|Sparkling|Cr[ée]mant|Prosecco|Spumante|Frizzante|Red|White|Ros[ée])\s*$/i)
  if (tMatch) {
    type = tMatch[1]
    rest = rest.slice(0, tMatch.index).trim()
  }

  const rating = rest.length > 0 ? rest : null
  return { country: countryWord, rating, type, vintage }
}

function composeName(brand: string, varieties: string): string {
  const b = cleanCell(brand)
  const v = cleanCell(varieties).replace(/\s+NEW!?\s*$/, '').trim()
  if (!b && !v) return ''
  if (!b) return v
  if (!v) return b
  // Avoid duplicating brand inside varieties (e.g. "Marie Brizard" + "Triple Sec")
  return `${b} ${v}`.replace(/\s+/g, ' ').trim()
}

function cleanCell(s: string): string {
  return (s || '').replace(/\s+/g, ' ').trim()
}

function parsePrice(s: string): number | null {
  const cleaned = (s || '').replace(/in[- ]?vat/gi, '').replace(/[^\d.,]/g, '').replace(/,/g, '')
  if (!cleaned) return null
  const n = parseFloat(cleaned)
  return isFinite(n) ? n : null
}

function parseYear(s: string): number | null {
  const m = (s || '').match(/(19|20)\d{2}/)
  return m ? parseInt(m[0], 10) : null
}

function parseVolume(sizeCol: string, varieties: string, sku: string): string | null {
  // 1) Size column (e.g., "700 ml", "1,000 ml", "200 ml x 3")
  if (sizeCol) {
    const m = sizeCol.match(/(\d[\d,\.]*)\s*(ml|l|liter|cl)\b/i)
    if (m) {
      const n = m[1].replace(/,/g, '')
      const unit = m[2].toLowerCase()
      return `${n}${unit === 'l' || unit === 'liter' ? 'L' : unit === 'cl' ? 'cl' : 'ml'}`
    }
    return cleanCell(sizeCol) || null
  }
  // 2) From varieties description (wine columns rarely have size)
  const v = varieties || ''
  const m = v.match(/(\d[\d,\.]*)\s*(ml|L)\b/)
  if (m) return `${m[1].replace(/,/g, '')}${m[2].toUpperCase() === 'L' ? 'L' : 'ml'}`
  // 3) From SKU suffix (/375, /1.5L, /6L, /187, /200)
  const skuM = sku.match(/\/(\d+(?:\.\d+)?)(L|ML)?$/i)
  if (skuM) {
    const n = skuM[1]
    const unit = (skuM[2] || '').toUpperCase()
    if (unit === 'L') return `${n}L`
    if (unit === 'ML') return `${n}ml`
    // Bare number suffix → assume ml
    return `${n}ml`
  }
  return '750ml' // default for wine
}

function mapWineType(s: string): ExtractedItem['wine_type'] {
  const t = s.toLowerCase()
  if (/orange|skin[\s-]?contact|qvevri|kvevri|amphora|ramato/.test(t)) return 'orange'
  if (/red/.test(t)) return 'red'
  if (/white/.test(t)) return 'white'
  if (/ros[ée]/.test(t)) return 'rose'
  if (/sparkling|champagne|cr[ée]mant|prosecco|spumante|frizzante|cava/.test(t)) return 'sparkling'
  return null
}

function extractGrapesFromVarieties(varieties: string): string | null {
  // Varieties text often contains "(Chardonnay, Pinot noir)" — pull from parens.
  const m = varieties.match(/\(([^)]+)\)/)
  if (m) return m[1].trim()
  return null
}

function parseDate(text: string): string | null {
  // "Effective Date: 15th January 2026"
  const m = text.match(/Effective Date:\s*(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})/i)
  if (!m) return null
  const months: Record<string, string> = {
    january: '01', february: '02', march: '03', april: '04',
    may: '05', june: '06', july: '07', august: '08',
    september: '09', october: '10', november: '11', december: '12',
  }
  const mo = months[m[2].toLowerCase()]
  if (!mo) return null
  return `${m[3]}-${mo}-${m[1].padStart(2, '0')}`
}

// ─── Shell helpers ──────────────────────────────────────────────────────────

async function writeTemp(buf: Buffer): Promise<string> {
  const path = join(tmpdir(), `bbb_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`)
  writeFileSync(path, buf)
  return path
}

function safeUnlink(path: string) {
  try { unlinkSync(path) } catch { /* ok */ }
}

async function pdftotextLayout(path: string, fromPage: number, toPage: number): Promise<string> {
  const { stdout } = await exec('pdftotext', [
    '-layout', '-f', String(fromPage), '-l', String(toPage), path, '-',
  ], { maxBuffer: 32 * 1024 * 1024 })
  return stdout
}
