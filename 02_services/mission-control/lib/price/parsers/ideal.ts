// iDeal Distribution (Bangkok) — 99-page Adobe InDesign HO.RE.CA wine
// catalogue. Layout is exceptionally regular: each wine is a card with
// labelled fields (Region / Variety / Alcohol by volume / Tasting notes)
// anchored by a 4-letter producer-derived SKU like RENA-001 / PRSA-006.
//
// Cards are arranged 1 (hero), 2 (top/bottom or left/right), or 4
// (2-column × 2-row grid) per page. Field positions and labels never
// vary across the catalogue, so we read the PDF positionally via
// `pdftohtml -xml` and cluster text fragments around each SKU.
//
// Layout per card (positions are stable inside any column):
//   <Wine name in CAPS, may span 1-4 lines>   ← font 0/1, large
//   VIVINO N.N/5                              ← optional rating
//   ฿N,NNN                                    ← price
//                              SKU            ← italic label
//                          XXXX-NNN           ← SKU code (font 4)
//   Region                                    ← bold label
//   <region>, <country>                       ← italic value
//   Variety
//   <grape composition>
//   Alcohol by volume
//   N%
//   Tasting notes
//   <multi-line paragraph>
//
// Page 1 is cover, page 2 is table of contents, pages 97-99 are
// scoring guide + company address. Parsing pages 3-96 covers all wines.

import { unlinkSync } from 'fs'
import type { ExtractedItem, ExtractionResult } from '../claude'
import {
  exec, writeTemp as writeTempShared, safeUnlink, pdftotextLayout,
  getPageCount,
} from './_shared'
import { tmpdir } from 'os'
import { join } from 'path'
import { readFileSync } from 'fs'

const writeTemp = (buf: Buffer) => writeTempShared(buf, 'ideal')

const SUPPLIER_NAME = 'iDeal Distribution'
const SKU_RE = /^[A-Z]{3,5}-\d{3}$/
const VINTAGE_RE = /\b(19\d{2}|20\d{2})\b/
const PRICE_RE = /^[\d,]+$/

type ProgressCb = (pct: number, phase?: string, itemCount?: number) => Promise<void> | void

// ─── Detection ─────────────────────────────────────────────────────────────

export async function isIdeal(buf: Buffer, filename: string): Promise<boolean> {
  if (/ideal[-\s_]?wine|ideal[-\s_]?distribut|iDeal[-\s_]?wine/i.test(filename)) return true
  const path = await writeTemp(buf)
  try {
    const text = await pdftotextLayout(path, 1, 3)
    if (/HO\.RE\.CA\s+WINE\s+Catalogue/i.test(text)) return true
    // Trailing page has the legal entity name
    const tail = await pdftotextLayout(path, Math.max(1, await getPageCount(buf) - 1), 0)
    return /IDEAL\s+DISTRIBUTION/i.test(tail)
  } catch {
    return false
  } finally {
    safeUnlink(path)
  }
}

// ─── XML representation ────────────────────────────────────────────────────

type TextEl = {
  top: number
  left: number
  width: number
  height: number
  font: number
  text: string
}

type Page = {
  number: number
  width: number
  height: number
  texts: TextEl[]
}

// `pdftohtml -xml` emits a single `pdf2xml` document. Parse with regex —
// the format is flat and predictable so a real XML parser is overkill.
function parsePdf2Xml(xml: string): Page[] {
  const pages: Page[] = []
  const pageRe = /<page\s+number="(\d+)"[^>]*height="([\d.]+)"\s+width="([\d.]+)"[^>]*>([\s\S]*?)<\/page>/g
  const textRe = /<text\s+top="([\d.-]+)"\s+left="([\d.-]+)"\s+width="([\d.-]+)"\s+height="([\d.-]+)"\s+font="(\d+)">([\s\S]*?)<\/text>/g
  let pm: RegExpExecArray | null
  while ((pm = pageRe.exec(xml)) !== null) {
    const pageNum = parseInt(pm[1], 10)
    const pageH = parseFloat(pm[2])
    const pageW = parseFloat(pm[3])
    const body = pm[4]
    const texts: TextEl[] = []
    let tm: RegExpExecArray | null
    textRe.lastIndex = 0
    while ((tm = textRe.exec(body)) !== null) {
      const raw = tm[6]
      // strip <b>, <i> nesting and decode the handful of entities pdftohtml emits
      const text = raw
        .replace(/<\/?[bi]>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
      texts.push({
        top: parseFloat(tm[1]),
        left: parseFloat(tm[2]),
        width: parseFloat(tm[3]),
        height: parseFloat(tm[4]),
        font: parseInt(tm[5], 10),
        text,
      })
    }
    pages.push({ number: pageNum, width: pageW, height: pageH, texts })
  }
  return pages
}

async function runPdfToXml(pdfPath: string): Promise<string> {
  // pdftohtml writes to "<prefix>.xml" — we ask for "-stdout" by piping.
  // The `-i` flag drops embedded images so the XML stays clean.
  const id = `ideal_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const outPrefix = join(tmpdir(), id)
  await exec('pdftohtml', ['-xml', '-i', '-q', pdfPath, outPrefix], { maxBuffer: 256 * 1024 * 1024 })
  const xmlPath = `${outPrefix}.xml`
  try {
    return readFileSync(xmlPath, 'utf8')
  } finally {
    try { unlinkSync(xmlPath) } catch { /* ok */ }
  }
}

// ─── Entry point ───────────────────────────────────────────────────────────

export async function parseIdeal(
  buf: Buffer,
  _filename: string,
  onProgress?: ProgressCb,
): Promise<ExtractionResult> {
  const path = await writeTemp(buf)
  try {
    await onProgress?.(5, 'reading PDF')
    const xml = await runPdfToXml(path)
    const pages = parsePdf2Xml(xml)
    await onProgress?.(20, 'parsing pages')

    const items: ExtractedItem[] = []
    const skuSeen = new Set<string>()

    // Skip cover (p.1), TOC (p.2), and the scoring/contact appendix (p.97+).
    const productPages = pages.filter(p => p.number >= 3 && p.number <= 96)

    for (let i = 0; i < productPages.length; i++) {
      const pg = productPages[i]
      const cards = extractCardsFromPage(pg)
      for (const card of cards) {
        if (!card.sku || skuSeen.has(card.sku)) continue
        skuSeen.add(card.sku)
        items.push(card.item)
      }
      if (i % 8 === 0 || i === productPages.length - 1) {
        const pct = 20 + Math.round(((i + 1) / productPages.length) * 70)
        await onProgress?.(pct, 'parsing', items.length)
      }
    }

    await onProgress?.(95, 'inserting')
    return {
      supplier_name: SUPPLIER_NAME,
      price_list_date: deriveDate(pages),
      currency: 'THB',
      items,
    }
  } finally {
    safeUnlink(path)
  }
}

// ─── Card extraction ───────────────────────────────────────────────────────

type Card = { sku: string | null; item: ExtractedItem }

function extractCardsFromPage(pg: Page): Card[] {
  // SKU anchors: any fragment that matches the code shape. Font IDs are
  // assigned per page by pdftohtml so we can't rely on a fixed id.
  const skuEls = pg.texts.filter(t => SKU_RE.test(t.text.trim()))
  if (skuEls.length === 0) return []

  // Each card has exactly one "Region" label at its true left edge.
  // (Variety/Alcohol/Tasting labels sometimes sit at a different X on
  // wide single-card-per-row layouts, so we don't use them for column
  // discovery.) Cluster the Region X positions into distinct columns.
  const regionLefts: number[] = []
  for (const t of pg.texts) {
    if (/^Region\s*$/.test(t.text.trim())) regionLefts.push(t.left)
  }
  if (regionLefts.length === 0) return []
  const columns: number[] = []
  for (const x of regionLefts.sort((a, b) => a - b)) {
    if (columns.length === 0 || x - columns[columns.length - 1] > 80) columns.push(x)
  }

  // Group SKUs by their nearest Region-column.
  type SkuAnchor = { sku: string; el: TextEl; cardLeft: number }
  const anchors: SkuAnchor[] = skuEls.map(el => {
    const cardLeft = columns.reduce((best, c) => Math.abs(c - el.left) < Math.abs(best - el.left) ? c : best, columns[0])
    return { sku: el.text.trim(), el, cardLeft }
  })

  const allSkusByTop = [...anchors].sort((x, y) => x.el.top - y.el.top)

  const cards: Card[] = []
  for (const a of anchors) {
    const cardLeft = a.cardLeft
    // Single-column pages (Laura Hartwig style) span the full page width
    // — the price and Tasting-notes paragraph live on the far right.
    // Multi-column pages get capped at the midpoint to the next column.
    const nextColumn = columns.find(c => c > cardLeft)
    const boxRight = nextColumn !== undefined ? nextColumn - 10 : pg.width

    // Card name + price block sits ≤ 220 px above the SKU on every
    // layout we've seen. Capping there keeps the previous card's
    // tasting-notes paragraph out of this card's name field.
    const top = Math.max(0, a.el.top - 220)
    // Box bottom is the next SKU strictly BELOW this one (top > +100
    // excludes row-siblings). Cards arranged in alternating left/right
    // columns still stack vertically, so we must look across all SKUs.
    const nextBelow = allSkusByTop.find(s => s.el.top > a.el.top + 100)
    const nextTop = nextBelow ? nextBelow.el.top - 60 : pg.height
    const box = {
      left: cardLeft - 30,
      right: boxRight,
      top,
      bottom: nextTop,
    }
    const inBox = pg.texts.filter(t =>
      t.left >= box.left && t.left < box.right &&
      t.top >= box.top && t.top < box.bottom,
    )
    // Y-bucket then sort: bold and regular fragments on the visual
    // same line differ by ~1px in `top` (different baselines), but
    // belong to the same row. Round to a 6px grid so the secondary
    // sort by `left` produces left-to-right reading order.
    inBox.sort((x, y) => Math.floor(x.top / 6) - Math.floor(y.top / 6) || x.left - y.left)
    cards.push(buildCard(a.sku, inBox, cardLeft))
  }
  return cards
}

function buildCard(sku: string, inBox: TextEl[], cardLeft: number): Card {
  // Field map: walk top-to-bottom, when we hit a label collect the value
  // fragments below it that share roughly the same x-coordinate, until
  // the next label fires.
  const labels = ['Region', 'Variety', 'Alcohol by volume', 'Tasting notes']
  const fields: Record<string, string[]> = {
    Region: [], Variety: [], 'Alcohol by volume': [], 'Tasting notes': [],
  }
  // Anything above the first field label is the wine name + rating + price.
  const headerEls: TextEl[] = []
  let active: string | null = null
  let activeLeft = cardLeft

  for (const t of inBox) {
    const txt = t.text.replace(/\s+/g, ' ').trim()
    if (!txt) continue
    if (labels.includes(txt)) {
      active = txt
      activeLeft = t.left
      continue
    }
    if (active === null) {
      headerEls.push(t)
      continue
    }
    // Value fragments under a label tend to be italic (font 6). They
    // share roughly the same x as the label; ignore distant fragments
    // (badges, footnotes) by clamping to ±30px from the label x.
    if (Math.abs(t.left - activeLeft) > 60) continue
    fields[active].push(txt)
  }

  const headerText = headerEls.map(t => t.text.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const { name, year, price, rating } = parseHeader(headerText)

  const regionFull = fields.Region.join(' ').replace(/\s+/g, ' ').trim()
  const variety = fields.Variety.join(' ').replace(/\s+/g, ' ').trim() || null
  const abvRaw = fields['Alcohol by volume'].join(' ').replace(/\s+/g, ' ').trim()
  const abvMatch = abvRaw.match(/(\d+(?:\.\d+)?)\s*%/)
  const tasting = fields['Tasting notes'].join(' ').replace(/\s+/g, ' ').trim()

  const { region, country } = splitRegionAndCountry(regionFull)

  const wineType = inferWineType(name, variety, tasting)
  const volume = inferVolume(name) ?? '750ml'

  const descBits: string[] = []
  if (rating) descBits.push(`Vivino ${rating}`)
  if (abvMatch) descBits.push(`ABV ${abvMatch[1]}%`)
  if (tasting) descBits.push(tasting)

  const item: ExtractedItem = {
    name,
    country: canoniseCountry(country),
    region,
    grape_variety: variety,
    price,
    year,
    volume,
    description: descBits.join(' • ').slice(0, 300) || null,
    category: 'wine',
    wine_type: wineType,
    spirit_type: null,
    supplier_sku: sku,
  }
  return { sku, item }
}

// ─── Header parsing (name, vintage, price, rating) ─────────────────────────

function parseHeader(lines: string[]): { name: string; year: number | null; price: number | null; rating: string | null } {
  // The header block of a card contains, in some order:
  //   - 1-4 lines of wine name (some bold, some not)
  //   - optional VIVINO rating: "VIVINO" + "4.4/5"
  //   - price: "฿" + digits (rendered as separate fragments by InDesign)
  //   - "SKU" label and the code itself (already stripped before we get here)
  //   - optionally "SOLD OUT" badge
  let rating: string | null = null
  let price: number | null = null
  let priceSeen = false
  const nameParts: string[] = []

  for (const raw of lines) {
    const s = raw.trim()
    if (!s) continue
    if (/^SKU$/i.test(s)) continue
    if (SKU_RE.test(s)) continue // the code itself
    if (/^SOLD\s*OUT$/i.test(s)) continue
    if (/^VIVINO$/i.test(s)) continue
    // Combined "VIVINO 4.4/5" fragment
    const vm = s.match(/(?:VIVINO\s+)?(\d+(?:\.\d+)?)\s*\/\s*5\b/i)
    if (vm && !rating) { rating = `${vm[1]}/5`; continue }
    // Standalone "4.4/5"
    if (/^\d+(?:\.\d+)?\/5$/.test(s)) { if (!rating) rating = s; continue }
    if (s === '฿') { priceSeen = true; continue }
    // Price after ฿, or "฿2,350" combined fragment
    if (priceSeen && PRICE_RE.test(s) && price === null) {
      price = parsePrice(s); priceSeen = false; continue
    }
    const pm = s.match(/^฿\s*([\d,]+)$/)
    if (pm && price === null) { price = parsePrice(pm[1]); continue }
    // Critic scores leak in as 1-3 digit fragments (92, 98, 100). 4-digit
    // standalone numbers are vintages — those we want to keep.
    if (/^\d{1,3}(?:[.,]\d+)?$/.test(s)) continue
    // Letter-spaced headline artefacts: "S E L E C C I ó N" → collapse
    // back to one word so the name reads naturally.
    if (/^(?:[A-Za-zÀ-ÿ]\s){3,}[A-Za-zÀ-ÿ]\s*$/.test(s)) {
      nameParts.push(s.replace(/\s+/g, ''))
      continue
    }
    // Otherwise it's a name fragment.
    nameParts.push(s)
  }

  const rawName = nameParts.join(' ').replace(/\s+/g, ' ').trim()
  // Pull a trailing vintage out of the name. Champagnes / blends are often NV.
  const vmatch = rawName.match(VINTAGE_RE)
  const year = vmatch ? parseInt(vmatch[0], 10) : null
  // Title-case the name only when it's entirely uppercase (InDesign renders
  // many headlines that way) — otherwise preserve mixed case.
  const name = rawName.length > 0 && rawName === rawName.toUpperCase()
    ? rawName.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).replace(/\bNv\b/g, 'NV')
    : rawName
  return { name, year, price, rating }
}

function parsePrice(s: string): number | null {
  const n = parseInt(s.replace(/,/g, ''), 10)
  return Number.isFinite(n) ? n : null
}

// ─── Inference helpers ─────────────────────────────────────────────────────

function inferWineType(name: string, variety: string | null, _tasting: string): ExtractedItem['wine_type'] {
  // Decide from name + variety only — tasting notes mention colour terms
  // ("ruby red", "rose petal aromas", "orange peel") that throw off the
  // heuristic.
  const haystack = `${name} ${variety ?? ''}`.toLowerCase()
  if (/\b(champagne|sparkling|spumante|prosecco|cava|cremant|crémant|sekt|pet\s*nat|pétillant|frizzante|blanc de blancs|brut|extra brut|demi-sec|millesime|millésime)\b/.test(haystack)) {
    return 'sparkling'
  }
  if (/\bros[eé]\b|\brosato\b/.test(haystack)) return 'rose'
  if (/\borange\s+wine\b|skin[\s-]?contact/.test(haystack)) return 'orange'
  if (/\bred\b|\brosso\b/.test(name)) return 'red'
  if (/\bwhite\b|\bbianco\b|\bblanc\b(?!\s+de\s+blancs)/.test(name)) return 'white'
  // From variety
  if (variety) {
    const v = variety.toLowerCase()
    const reds = /malbec|cabernet|merlot|syrah|shiraz|pinot\s*noir|nebbiolo|sangiovese|tempranillo|grenache|montepulciano|aglianico|nero d|primitivo|tannat|carmenere|barbera|corvina|valpolicella|negroamaro|saperavi/
    const whites = /chardonnay|sauvignon\s*blanc|riesling|pinot\s*grigio|pinot\s*gris|gewurztraminer|gewürztraminer|viognier|albari[ñn]o|verdejo|vermentino|trebbiano|garganega|cortese|fiano|falanghina|moscato|gr[uü]ner|chenin|semillon|sémillon|s[ae]millon|grillo/
    if (reds.test(v)) return 'red'
    if (whites.test(v)) return 'white'
  }
  return null
}

function inferVolume(name: string): string | null {
  const m = name.match(/(\d+(?:[.,]\d+)?)\s*(L|ml|cl)\b/i)
  if (!m) return null
  const n = m[1].replace(',', '.')
  const u = m[2].toLowerCase()
  if (u === 'l') return `${parseFloat(n) * 1000}ml`
  if (u === 'cl') return `${parseFloat(n) * 10}ml`
  return `${n}ml`
}

// iDeal writes country names cleanly already, but a couple of region fields
// hide them in non-canonical forms ("U.S.A." → USA, "South-Africa" → ...).
const COUNTRY_CANON: Record<string, string> = {
  argentina: 'Argentina', australia: 'Australia', austria: 'Austria',
  chile: 'Chile', china: 'China', france: 'France', germany: 'Germany',
  georgia: 'Georgia', greece: 'Greece', hungary: 'Hungary', italy: 'Italy',
  'new zealand': 'New Zealand', portugal: 'Portugal',
  'south africa': 'South Africa', spain: 'Spain', thailand: 'Thailand',
  usa: 'USA', 'u.s.a.': 'USA', 'united states': 'USA',
}

// Find a country name at the end of the region string when there's no
// comma to split on (iDeal sometimes writes "South East Australia" with
// no separator).
function splitRegionAndCountry(s: string): { region: string | null; country: string | null } {
  if (!s) return { region: null, country: null }
  const trimmed = s.trim()
  const commaParts = trimmed.split(',').map(x => x.trim()).filter(Boolean)
  if (commaParts.length >= 2) {
    const last = commaParts[commaParts.length - 1]
    return {
      region: commaParts.slice(0, -1).join(', '),
      country: canoniseCountry(last),
    }
  }
  // No comma — try to peel a country off the end. Match longest country
  // name first so "South Africa" wins over "Africa".
  const known = Object.keys(COUNTRY_CANON)
    .sort((a, b) => b.length - a.length)
    .map(k => ({ k, canon: COUNTRY_CANON[k] }))
  for (const { k, canon } of known) {
    const re = new RegExp(`(?:^|\\s)${k.replace(/\./g, '\\.')}\\s*$`, 'i')
    if (re.test(trimmed)) {
      const region = trimmed.replace(re, '').trim()
      return { region: region || null, country: canon }
    }
  }
  // Single token that doesn't end in a known country — treat as country only
  // (iDeal occasionally writes just "Italy" for a generic listing).
  if (/^[A-Z][A-Za-z .-]+$/.test(trimmed) && trimmed.split(/\s+/).length <= 2) {
    return { region: null, country: canoniseCountry(trimmed) }
  }
  return { region: trimmed, country: null }
}

function canoniseCountry(s: string | null): string | null {
  if (!s) return null
  const k = s.toLowerCase().trim()
  return COUNTRY_CANON[k] ?? s.trim()
}

// ─── Date inference ────────────────────────────────────────────────────────

function deriveDate(pages: Page[]): string | null {
  // Cover page (p.1) prints the month, e.g. "MAY".
  const first = pages.find(p => p.number === 1)
  if (!first) return null
  const monthNames: Record<string, string> = {
    january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',
    july:'07',august:'08',september:'09',october:'10',november:'11',december:'12',
  }
  for (const t of first.texts) {
    const m = t.text.trim().match(/^(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)$/i)
    if (m) {
      const mo = monthNames[m[1].toLowerCase()]
      const year = new Date().getUTCFullYear()
      return `${year}-${mo}-01`
    }
  }
  return null
}
