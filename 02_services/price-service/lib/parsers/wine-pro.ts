// Wine Pro — Bangkok-based importer/wholesaler with branches in Hua Hin,
// Phuket (Chalong + Cherngtalay), Samui and Pattaya. Their F&B price list
// is a 21-page designer catalog with FOUR distinct layouts:
//
//   1. WINE grid — 3×2 cells per page (pages 1-16). Each cell:
//        <NAME>            ← brand, 1-2 lines
//        <Sub-name>        ← appellation/style
//        <Country>
//        <tasting notes / ratings>
//        <ABV>%
//        [PROMO badge]     ← optional red circle: "XXX THB (PROMO)"
//        <SKU> <vintage> <price>
//   2. SPIRITS table — single-column rows (page 17):
//        CODE | NAME | TYPE | COUNTRY | ABV% | SIZE | PRICE
//   3. CIDER 2-col grid — name + price stacked with SKU on its own line.
//   4. MINERAL WATER + GLASSWARE — single-cell layout, glassware has no
//      price (pre-order only); we skip those.
//
// SKUs encode category + country + colour: `WI<CC>-<T><nnn>`
//   WI=wine, SP=spirits, CI=cider, WO=water
//   CC: AR/AT/AU/CH/FR/GR/IT/NZ/PO/SA/SP/US/UK/PR
//   T (wines): S=sparkling, R=red, W=white, O=rose
// The model also sees the section header band ("CHAMPAGNE & SPARKLING WINES",
// "ROSE WINES", "RED & WHITE WINES" with the country printed on the right),
// which is the most reliable source for country on wine pages.
//
// PROMO handling per the user's instruction: keep the BASE price in `price`,
// and put a short "PROMO: 399 THB until …" note in `description`. We don't
// store promo prices in a separate field because the data model doesn't
// have one.
//
// Why vision instead of pdftotext: pdftotext gives us SKUs+prices cleanly,
// but each cell's NAME spans 1-3 lines stacked above the price row, and the
// three cells share the same y-range — column-aware extraction would
// duplicate the layout logic. Letting the model read the rendered page is
// simpler and handles the SPIRITS/CIDER/WATER pages without separate code.

import { unlinkSync, readFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Anthropic from '@anthropic-ai/sdk'
import type { ExtractedItem, ExtractionResult } from '../claude'
import {
  exec, anthropic,
  writeTemp as writeTempShared, safeUnlink, pdftotextLayout,
  getPageCount, parseJson, dedupBy,
} from './_shared'

const writeTemp = (buf: Buffer) => writeTempShared(buf, 'winepro')

const SUPPLIER_NAME = 'Wine Pro'

type ProgressCb = (pct: number, phase?: string, itemCount?: number) => Promise<void> | void

// ─── Detection ─────────────────────────────────────────────────────────────

export async function isWinePro(buf: Buffer, filename: string): Promise<boolean> {
  if (/wine[\s_-]*pro/i.test(filename)) return true
  const path = await writeTemp(buf)
  try {
    const text = await pdftotextLayout(path, 1, 3)
    return /WINE\s*PRO\s*CO\.?,?\s*LTD|winepro\.co\.th|WINE\s*PRO\s*(HUA\s*HIN|PHUKET|SAMUI|PATTAYA|CHERNGTALAY|CHALONG)\s*BRANCH/i.test(text)
  } catch {
    return false
  } finally {
    safeUnlink(path)
  }
}

// ─── Entry point ───────────────────────────────────────────────────────────

export async function parseWinePro(
  buf: Buffer,
  filename: string,
  onProgress?: ProgressCb,
): Promise<ExtractionResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set in the environment')
  }

  const totalPages = await getPageCount(buf)
  await onProgress?.(5, 'rendering pages')

  const pdfPath = await writeTemp(buf)
  let pageImages: string[] = []
  let firstPageText = ''
  try {
    firstPageText = await pdftotextLayout(pdfPath, 1, 2)
    pageImages = await renderPagesToJpegs(pdfPath, 1, totalPages, 140)
  } finally {
    safeUnlink(pdfPath)
  }
  console.log(`[wine-pro] rendered ${pageImages.length} page images (1–${totalPages})`)

  if (pageImages.length === 0) {
    throw new Error(`pdftoppm rendered 0 pages from a ${totalPages}-page PDF — check poppler_utils availability`)
  }

  const CHUNK = 2
  const PARALLEL = 3
  const allItems: ExtractedItem[] = []
  const chunkErrors: string[] = []

  const imageChunks: { offset: number; images: string[] }[] = []
  for (let p = 0; p < pageImages.length; p += CHUNK) {
    imageChunks.push({ offset: p, images: pageImages.slice(p, p + CHUNK) })
  }

  await onProgress?.(15, 'extracting')
  let chunksDone = 0

  for (let i = 0; i < imageChunks.length; i += PARALLEL) {
    const batch = imageChunks.slice(i, i + PARALLEL)
    const results = await Promise.all(
      batch.map(async (c) => {
        const fromPg = 1 + c.offset
        const toPg = fromPg + c.images.length - 1
        try {
          const raw = await callWithImages(PROMPT, c.images)
          const parsed = parseJson<{ items: ExtractedItem[] }>(raw)
          const items = parsed?.items ?? []
          console.log(`[wine-pro] pages ${fromPg}-${toPg} → ${items.length} items`)
          return items
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          console.error(`[wine-pro] pages ${fromPg}-${toPg} failed:`, msg)
          chunkErrors.push(`p.${fromPg}-${toPg}: ${msg}`)
          return []
        }
      })
    )
    results.forEach(items => allItems.push(...items))
    chunksDone += batch.length
    const pct = 15 + Math.round((chunksDone / imageChunks.length) * 75)
    await onProgress?.(pct, `extracting ${chunksDone}/${imageChunks.length}`, allItems.length)
  }

  if (allItems.length === 0 && chunkErrors.length > 0) {
    throw new Error(`All ${chunkErrors.length} chunks failed. First error: ${chunkErrors[0]}`)
  }

  await onProgress?.(95, 'inserting')
  const normalised = allItems.map(canonicaliseItem).filter(it => it.name && it.name.trim().length > 0)
  return {
    supplier_name: SUPPLIER_NAME,
    price_list_date: parseDate(filename, firstPageText),
    currency: 'THB',
    items: dedupBy(
      normalised,
      it => `${it.supplier_sku ?? ''}|${(it.name || '').toLowerCase().trim()}|${it.year ?? ''}|${it.volume ?? ''}`,
    ),
  }
}

// ─── Normalisation ─────────────────────────────────────────────────────────

const COUNTRY_CANON: Record<string, string> = {
  argentina: 'Argentina', australia: 'Australia', austria: 'Austria',
  chile: 'Chile', france: 'France', greece: 'Greece', italy: 'Italy',
  'new zealand': 'New Zealand', portugal: 'Portugal',
  'south africa': 'South Africa', spain: 'Spain', peru: 'Peru',
  ukraine: 'Ukraine', england: 'England', scotland: 'Scotland',
  united_states: 'USA', 'united states': 'USA', usa: 'USA',
  thailand: 'Thailand',
}

// SKU country prefix → country name. Used as a fallback when the model's
// country field is empty or contradicts the SKU.
const SKU_COUNTRY: Record<string, string> = {
  AR: 'Argentina', AT: 'Austria', AU: 'Australia', CH: 'Chile',
  FR: 'France',    GR: 'Greece',  IT: 'Italy',     NZ: 'New Zealand',
  PO: 'Portugal',  SA: 'South Africa', SP: 'Spain', US: 'USA',
  UK: 'Ukraine', PR: 'Peru',
}

const SKU_WINE_TYPE: Record<string, ExtractedItem['wine_type']> = {
  S: 'sparkling', R: 'red', W: 'white', O: 'rose',
}

const SPIRIT_CANON: Record<string, string> = {
  gin: 'gin', vodka: 'vodka', whisky: 'whisky', whiskey: 'whisky',
  rum: 'rum', tequila: 'tequila', cognac: 'cognac', brandy: 'brandy',
  calvados: 'brandy', pisco: 'brandy', grappa: 'grappa',
  pastis: 'liqueur', liquore: 'liqueur', liqueur: 'liqueur',
  'eaux de vie': 'brandy', 'eau de vie': 'brandy',
}

function canonicaliseItem(it: ExtractedItem): ExtractedItem {
  const out: ExtractedItem = { ...it }

  // Fill in country/wine_type from the SKU when the model left them empty.
  const sku = (out.supplier_sku || '').toUpperCase()
  const m = sku.match(/^([A-Z]{2})([A-Z]{2})-([A-Z])\d+/)
  if (m) {
    const [, cat, cc, t] = m
    if (!out.country && SKU_COUNTRY[cc]) out.country = SKU_COUNTRY[cc]
    if (cat === 'WI' && !out.wine_type && SKU_WINE_TYPE[t]) out.wine_type = SKU_WINE_TYPE[t]
    if (cat === 'WI' && !out.category) out.category = 'wine'
    if (cat === 'SP' && !out.category) out.category = 'spirits'
    if (cat === 'CI' && !out.category) out.category = 'other'
    if (cat === 'WO' && !out.category) out.category = 'other'
  }

  if (out.country) {
    const canon = COUNTRY_CANON[out.country.toLowerCase().trim()]
    if (canon) out.country = canon
  }
  if (out.category === 'spirits' && !out.spirit_type) {
    const haystack = `${it.spirit_type ?? ''} ${it.name ?? ''} ${it.description ?? ''}`.toLowerCase()
    for (const key of Object.keys(SPIRIT_CANON)) {
      if (haystack.includes(key)) { out.spirit_type = SPIRIT_CANON[key]; break }
    }
  }
  // Spirits and ciders are non-vintage by convention even if model emits 0.
  if ((out.category === 'spirits' || out.category === 'other') && out.year === 0) out.year = null

  return out
}

// ─── Prompt ────────────────────────────────────────────────────────────────

const PROMPT = `You are reading pages from the WINE PRO F&B price list (May 2026).

This catalog has four distinct layouts. Identify the layout per page, then
extract every product cell on every page.

LAYOUT A — WINE GRID (3 columns × 2 rows; most pages).
  Each cell shows:
    NAME (1-2 lines, brand in larger font)
    Sub-name (appellation / style)
    Country (the word, e.g. "Italy", "France")
    Tasting notes (colour / nose / palate)
    ABV (e.g. "12% ABV")
    [Optional red PROMO badge: "XXX THB (PROMO)" — a discounted price]
    Bottom row: SKU  VINTAGE  PRICE
  Examples of SKU lines:
    "WIIT-S024  N/V  399"
    "WIFR-R325  2015  ฿650"
    "WIIT-R157  2022/24  490"

LAYOUT B — SPIRITS TABLE (typically page 17 only).
  Single-column rows with columns: CODE | NAME | TYPE | COUNTRY | ABV% | SIZE | PRICE.
  Example row: "SPFR-SL008  London Dry Gin IMPERIAL SILVER  Gin  France  37.5%  70cl  490"

LAYOUT C — CIDER 2-COLUMN GRID.
  Two cells per row. Each cell: NAME + PRICE on the first line, sub-name,
  SKU (e.g. "CIFR-003"), country, ABV.

LAYOUT D — MINERAL WATER / GLASSWARE.
  Single product with floating elements ("SAN BERNARDO Sparkling Mineral
  Water (1000ml)  WOIT-WA004  Italy"). Extract the water but SKIP all
  Churchill glassware / tableware (no price, pre-order only).

EXTRACTION RULES

Per cell, output exactly one item with these fields:

{
  "name": "<brand + sub-name as printed, e.g. 'GRAZIOSA Spumante Rose Demi-Sec'>",
  "country": "<the country printed in the cell or the SKU prefix>",
  "region": null,
  "grape_variety": "<grape if obvious from the sub-name, else null>",
  "year": <integer vintage, or null for 'N/V'. For ranges like '2022/24' use the FIRST year (2022)>,
  "price": <BASE price in THB (the small number next to the SKU), as integer — NOT the PROMO price>,
  "volume": "<bottle size; default '750ml'. If a different size is printed (e.g. '1500cl', '150cl', '375ml', '70cl', '100cl') normalize to ml>",
  "description": "<see rules below>",
  "category": "wine" | "spirits" | "other",
  "wine_type": "red" | "white" | "rose" | "sparkling" | null,
  "spirit_type": "<gin/vodka/whisky/rum/cognac/brandy/grappa/liqueur if spirits, else null>",
  "supplier_sku": "<the supplier code, e.g. 'WIIT-S024' — uppercase, dash preserved>"
}

PRICE rules:
  • Strip the ฿ symbol and commas: "1,950" → 1950, "฿720" → 720.
  • If a PROMO red badge appears in the cell, the BASE price (next to the
    SKU in the bottom row) is still the price field. The promo price goes
    into description.
  • If the cell has no price visible at all (rare; only for "pre-order"
    items), set price=null.

VOLUME rules:
  • Default 750ml when not stated.
  • "(150cl)" or "1.5L" → "1500ml"
  • "(75cl)" → "750ml"
  • "(50cl)" → "500ml"
  • "(1000ml)" → "1000ml"
  • Spirits sizes "70 cl" → "700ml", "100cl" → "1000ml", "37.5cl" → "375ml".

DESCRIPTION rules:
  • If a PROMO badge is shown in the cell, prepend "PROMO: <N> THB. " then
    add the appellation/style sub-name.
  • Otherwise just the appellation/style sub-name (e.g. "Spumante Rose
    Demi-Sec, Italy"), short and ≤200 chars.
  • Include critic scores if printed in the cell (e.g. "Wine Enthusiast
    90", "JS 92", "Luca Maroni 92") — short, comma-separated.

SKU rules:
  • Always capture the supplier_sku verbatim — it's the join key.
  • SKU prefixes encode country and colour:
      WI<CC>-<T>...  → wine; T=S sparkling, R red, W white, O rosé
      SP<CC>-<X>...  → spirit (use the TYPE column for spirit_type)
      CI<CC>-...     → cider (category='other')
      WO<CC>-...     → water (category='other')
    Country codes: AR Argentina, AT Austria, AU Australia, CH Chile,
    FR France, GR Greece, IT Italy, NZ New Zealand, PO Portugal,
    SA South Africa, SP Spain, US USA, UK Ukraine, PR Peru.

SKIP rules:
  • Skip the cover page, the contents page, the "SALES & DELIVERY
    CONDITIONS" page, and the "CONTACT US" page.
  • Skip any Churchill / glassware / tableware blocks (pre-order only).
  • Skip pure marketing/profile paragraphs (no SKU).
  • Skip section header bands like "CHAMPAGNE & SPARKLING WINES" /
    "RED & WHITE WINES / FRANCE" — these are visual headers, not items.

Return ONLY valid JSON: {"items": [ ... ]}.`

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseDate(filename: string, firstPageText: string): string | null {
  const months: Record<string, string> = {
    january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',
    july:'07',august:'08',september:'09',october:'10',november:'11',december:'12',
    jan:'01',feb:'02',mar:'03',apr:'04',jun:'06',jul:'07',aug:'08',
    sep:'09',sept:'09',oct:'10',nov:'11',dec:'12',
  }
  // Catalog cover prints "PRICE LIST MAY 2026" or "[MAY2026]" in PDF metadata
  // and a "Last updated on <dd> <MMM>, <yyyy>" line in the body.
  const titleMatch = firstPageText.match(/PRICE\s+LIST\s+([A-Z]+)\s+(\d{4})/i)
  if (titleMatch) {
    const mo = months[titleMatch[1].toLowerCase()]
    if (mo) return `${titleMatch[2]}-${mo}-01`
  }
  const updMatch = firstPageText.match(/Last\s+updated\s+on\s+(\d{1,2})\s*(?:st|nd|rd|th)?\s*([A-Z]+)[,\s]+(\d{4})/i)
  if (updMatch) {
    const mo = months[updMatch[2].toLowerCase()]
    if (mo) return `${updMatch[3]}-${mo}-${updMatch[1].padStart(2, '0')}`
  }
  const fnMatch = filename.toLowerCase().match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/)
  if (fnMatch) {
    const mo = months[fnMatch[1]]
    if (mo) return `${new Date().getFullYear()}-${mo}-01`
  }
  return null
}

async function callWithImages(prompt: string, imagesBase64: string[]): Promise<string> {
  const blocks = imagesBase64.map(data => ({
    type: 'image' as const,
    source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data },
  }))
  // Retry on transient Anthropic capacity errors (529 overloaded, 503,
  // 429 rate-limit). Without this, a brief upstream blip while we're
  // fanning out 3 parallel requests fails every chunk simultaneously.
  const MAX_ATTEMPTS = 5
  let lastErr: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 16384,
        messages: [{ role: 'user', content: [...blocks as unknown as Anthropic.TextBlockParam[], { type: 'text', text: prompt }] }],
      })
      return res.content[0].type === 'text' ? res.content[0].text : ''
    } catch (e) {
      lastErr = e
      if (!isRetryable(e) || attempt === MAX_ATTEMPTS) throw e
      // Backoff: 1s, 2s, 4s, 8s, with ±25% jitter to desynchronise parallel callers.
      const base = 1000 * Math.pow(2, attempt - 1)
      const jitter = base * (0.75 + Math.random() * 0.5)
      console.warn(`[wine-pro] anthropic retry ${attempt}/${MAX_ATTEMPTS - 1} after ${Math.round(jitter)}ms (${describeErr(e)})`)
      await new Promise(r => setTimeout(r, jitter))
    }
  }
  throw lastErr
}

function isRetryable(e: unknown): boolean {
  const status = (e as { status?: number; statusCode?: number })?.status
              ?? (e as { statusCode?: number })?.statusCode
  if (status === 429 || status === 503 || status === 529) return true
  const msg = e instanceof Error ? e.message : String(e)
  return /overloaded_error|rate.?limit|529|503/i.test(msg)
}

function describeErr(e: unknown): string {
  const status = (e as { status?: number })?.status
  const msg = e instanceof Error ? e.message : String(e)
  return status ? `${status} ${msg.slice(0, 80)}` : msg.slice(0, 100)
}

async function renderPagesToJpegs(pdfPath: string, fromPage: number, toPage: number, scale: number): Promise<string[]> {
  const id = `winepro_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const outPrefix = join(tmpdir(), id)
  try {
    await exec('pdftoppm', [
      '-jpeg', '-r', String(scale),
      '-f', String(fromPage), '-l', String(toPage),
      pdfPath, outPrefix,
    ], { maxBuffer: 64 * 1024 * 1024 })
  } catch (e) {
    console.error('[wine-pro] pdftoppm failed:', e instanceof Error ? e.message : e)
    return []
  }
  const dir = tmpdir()
  const files = readdirSync(dir)
    .filter(f => f.startsWith(id) && f.endsWith('.jpg'))
    .sort((a, b) => {
      const na = parseInt(a.replace(id + '-', '').replace('.jpg', ''))
      const nb = parseInt(b.replace(id + '-', '').replace('.jpg', ''))
      return na - nb
    })
  const images = files.map(f => readFileSync(join(dir, f)).toString('base64'))
  files.forEach(f => { try { unlinkSync(join(dir, f)) } catch { /* ok */ } })
  return images
}
