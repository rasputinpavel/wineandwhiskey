// Enoteca (Thailand) Co., Ltd. — Bangkok-based wine importer with a
// dedicated HORECA channel. They publish two distinct PDFs each month:
//
//   1. HORECA PRICE LIST — the full B2B catalog (~68 pages, ~136 items).
//      Producer pages with country header, multiple wines per page, each
//      cell carrying a proper supplier SKU ("ITEM CODE: 0315800103NV"),
//      a "PRICE X,XXX THB" stamp, volume, and ABV.
//
//   2. Clearance Promotion — a 17-page sale flyer (~60 items). NO item
//      codes; cards show producer + wine + COUNTRY/YEAR with the regular
//      THB price struck out and a clearance THB price stamped below.
//      Items are tier-grouped ("BELOW 400 THB", "400–700 THB", …).
//
// We treat them as two parse modes of one supplier:
//   • HORECA → normal extraction with supplier_sku set from ITEM CODE.
//   • Clearance → use the clearance price as `price`, prepend
//     "CLEARANCE: was THB <regular>, carton <n>" to `description`, and
//     leave supplier_sku null (the user picked option A — clearance
//     becomes standalone records on the portal).
//
// Why vision: both layouts are Canva-designed cards with multi-line
// floating elements. pdftotext extracts the values but loses cell
// membership across columns; the model reading the page handles it
// uniformly across HORECA and Clearance without two separate text
// parsers.

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

const writeTemp = (buf: Buffer) => writeTempShared(buf, 'enoteca')

const SUPPLIER_NAME = 'Enoteca Thailand'

type ProgressCb = (pct: number, phase?: string, itemCount?: number) => Promise<void> | void

// ─── Detection ─────────────────────────────────────────────────────────────

export async function isEnoteca(buf: Buffer, filename: string): Promise<boolean> {
  if (/enotec[ak]/i.test(filename)) return true
  const path = await writeTemp(buf)
  try {
    const text = await pdftotextLayout(path, 1, 3)
    return /ENOTECA\s*\(?THAILAND\)?|enoteca\.co\.th|@enoteca[_ ]?Thailand|Enoteca\s*Thailand/i.test(text)
  } catch {
    return false
  } finally {
    safeUnlink(path)
  }
}

// ─── Entry point ───────────────────────────────────────────────────────────

export async function parseEnoteca(
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
  let mode: 'horeca' | 'clearance' = 'horeca'
  try {
    firstPageText = await pdftotextLayout(pdfPath, 1, 3)
    mode = detectMode(filename, firstPageText)
    const startPage = mode === 'horeca' ? 7 : 2  // skip TOC/cover
    pageImages = await renderPagesToJpegs(pdfPath, startPage, totalPages, 140)
    console.log(`[enoteca] mode=${mode}; rendered ${pageImages.length} pages (${startPage}–${totalPages})`)
  } finally {
    safeUnlink(pdfPath)
  }

  if (pageImages.length === 0) {
    throw new Error(`pdftoppm rendered 0 pages from a ${totalPages}-page PDF — check poppler_utils availability`)
  }

  const startPage = mode === 'horeca' ? 7 : 2
  const prompt = mode === 'horeca' ? PROMPT_HORECA : PROMPT_CLEARANCE
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
        const fromPg = startPage + c.offset
        const toPg = fromPg + c.images.length - 1
        try {
          const raw = await callWithImages(prompt, c.images)
          const parsed = parseJson<{ items: ExtractedItem[] }>(raw)
          const items = parsed?.items ?? []
          console.log(`[enoteca:${mode}] pages ${fromPg}-${toPg} → ${items.length} items`)
          return items
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          console.error(`[enoteca:${mode}] pages ${fromPg}-${toPg} failed:`, msg)
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
    price_list_date: parseDate(filename, firstPageText, mode),
    currency: 'THB',
    items: dedupBy(
      normalised,
      // HORECA has SKUs (use them as the dedup key); clearance has none,
      // fall back to producer+name+year+price.
      it => it.supplier_sku
        ? `sku:${it.supplier_sku}`
        : `name:${(it.name || '').toLowerCase().trim()}|${it.year ?? ''}|${it.price ?? ''}`,
    ),
  }
}

// ─── Mode detection ────────────────────────────────────────────────────────

function detectMode(filename: string, firstPageText: string): 'horeca' | 'clearance' {
  // Filename is the strongest signal — "promo" / "clearance" → clearance,
  // "price" / "horeca" → HORECA.
  if (/clearance|promo|sale/i.test(filename)) return 'clearance'
  if (/horeca|price/i.test(filename)) return 'horeca'
  // Fall back to body sniffing.
  if (/Clearance\s*Sale|Uncork\s*the\s*Savings|Limited.Time\s*Wine\s*Blowout|GREAT\s*TASTE\s*SMALL\s*PRICE/i.test(firstPageText)) return 'clearance'
  if (/HORECA\s*PRICE\s*LIST|TABLE\s*OF\s*CONTENTS|ITEM\s*CODE:/i.test(firstPageText)) return 'horeca'
  return 'horeca'  // default to the bigger, structured catalog
}

// ─── Normalisation ─────────────────────────────────────────────────────────

const COUNTRY_CANON: Record<string, string> = {
  argentina: 'Argentina', australia: 'Australia', austria: 'Austria',
  chile: 'Chile', france: 'France', germany: 'Germany', greece: 'Greece',
  italy: 'Italy', japan: 'Japan', 'new zealand': 'New Zealand',
  portugal: 'Portugal', 'south africa': 'South Africa', spain: 'Spain',
  usa: 'USA', 'united states': 'USA', 'u.s.a.': 'USA',
  thailand: 'Thailand',
}

function canonicaliseItem(it: ExtractedItem): ExtractedItem {
  const out: ExtractedItem = { ...it }
  if (out.country) {
    const canon = COUNTRY_CANON[out.country.toLowerCase().trim()]
    if (canon) out.country = canon
  }
  // Treat 0 / non-finite years as null (model occasionally emits 0 for NV).
  if (out.year === 0 || (out.year != null && !Number.isFinite(out.year))) out.year = null
  // Trim and uppercase ITEM CODEs.
  if (out.supplier_sku) {
    const trimmed = out.supplier_sku.trim().toUpperCase()
    out.supplier_sku = trimmed || null
  }
  return out
}

// ─── Prompts ───────────────────────────────────────────────────────────────

const PROMPT_HORECA = `You are reading pages from Enoteca Thailand's HORECA PRICE LIST (May 2026).

Each page shows one or more wines from a single producer. Sticky context:
  • Country header (top-right, ALL CAPS): FRANCE / ITALY / SPAIN / GERMANY /
    AUSTRALIA / NEW ZEALAND / ARGENTINA / CHILE / JAPAN / USA / etc.
  • Region/appellation label under producer name: "Champagne", "Bordeaux",
    "Burgundy", "Northern Rhône", "Tuscany", etc. → use as 'region'.
  • Producer block (large name + paragraph bio).

Each WINE CELL contains:
  • Producer name (top of cell, e.g. "Charles Heidsieck")
  • Cuvée name and vintage (e.g. "Brut Réserve NV", "Brut Millésimé 2013")
  • Critic scores list (e.g. "95 James Suckling", "92 Wine Advocate")
  • Wine type tag in a coloured pill: SPARKLING / ROSE / RED / WHITE /
    SWEET / DESSERT / SAKE etc.
  • Grape composition (e.g. "40% Pinot Noir", "100% Chardonnay")
  • Tasting notes paragraph
  • "PRICE  <N,NNN> THB    <volume>"
  • "ITEM CODE: <12-char alphanumeric>   Alc. <X.X>%"

Output ONE item per wine cell:

{
  "name": "<Producer + Cuvée + vintage, e.g. 'Charles Heidsieck Brut Réserve NV'>",
  "country": "<from country header>",
  "region": "<sub-region/appellation, e.g. 'Champagne', 'Burgundy', 'Tuscany'>",
  "grape_variety": "<comma-separated grapes if shown, e.g. 'Pinot Noir, Chardonnay, Meunier'. Use null if not stated>",
  "year": <integer vintage from the cuvée name, or null for 'NV'/non-vintage>,
  "price": <THB price as integer, e.g. "2,430 THB" → 2430>,
  "volume": "<bottle size as written: '750ml', '1500ml', '375ml', '500ml'>",
  "description": "<critic scores comma-separated + key style notes, ≤200 chars>",
  "category": "wine" | "spirits" | "other",
  "wine_type": "red" | "white" | "rose" | "sparkling" | "orange" | null,
  "spirit_type": null,
  "supplier_sku": "<the ITEM CODE verbatim, uppercase, e.g. '0315800103NV'>"
}

Wine type from the pill text: SPARKLING → "sparkling", ROSE → "rose",
RED → "red", WHITE → "white", SWEET/DESSERT → null (still category=wine).
Sake → category='other', wine_type=null.

SKIP rules:
  • Table-of-contents pages (just chapter titles + dotted leaders + page numbers).
  • Terms & Conditions / payment / contact pages.
  • Producer-only intro pages with no PRICE/ITEM CODE block.
  • Section divider pages ("ENTRY LEVEL", "TABLE OF CONTENTS", country lists).
  • Anything without a visible PRICE … THB line.

Return ONLY valid JSON: {"items": [ ... ]}.`

const PROMPT_CLEARANCE = `You are reading pages from Enoteca Thailand's "Clearance Sale Selection"
(May 2026) — a wine blowout list with discounted prices, NO item codes.

Each card shows:
  • Producer name (bold, 1 line)
  • Wine cuvée / variety (1–3 lines, e.g. "Cosecha Tardía / Tinto Dulce")
  • "COUNTRY, YEAR" (e.g. "ARGENTINA, 2022")
  • Original retail price (top THB number, e.g. "THB 555")
  • Carton info ("12 bottles/carton" or "6 bottles/carton")
  • Clearance price (BOTTOM THB number, larger and isolated, e.g. "THB 388")
    — THIS is the actual price to load.

Output ONE item per card with these fields:

{
  "name": "<Producer + cuvée, e.g. 'Bodega Norton Cosecha Tardía Tinto Dulce'>",
  "country": "<from the COUNTRY, YEAR line>",
  "region": null,
  "grape_variety": "<grape if obvious in cuvée name, else null>",
  "year": <integer vintage from the COUNTRY, YEAR line. If two years are listed (e.g. '2022, 2023'), use the EARLIEST>,
  "price": <CLEARANCE THB price as integer — the BOTTOM/large number, NOT the regular>,
  "volume": "750ml",
  "description": "CLEARANCE: was THB <regular price>, carton <N> bottles",
  "category": "wine",
  "wine_type": "red" | "white" | "rose" | "sparkling" | "orange" | null,
  "spirit_type": null,
  "supplier_sku": null
}

Wine type hints from the cuvée name (case-insensitive):
  • "rosé" / "rose" / "rosato" → "rose"
  • "tinto" / "rouge" / "red" / a known red grape (cabernet, merlot, malbec,
    pinot noir, syrah, shiraz, sangiovese, nebbiolo, …) → "red"
  • "blanco" / "blanc" / "bianco" / "white" / a known white grape (chardonnay,
    sauvignon blanc, riesling, viognier, pinot grigio/gris, torrontés, …) → "white"
  • "spumante" / "champagne" / "prosecco" / "cava" / "crémant" / "brut" / "sekt" → "sparkling"
  • otherwise null

SKIP:
  • Cover page (just bottles silhouette + "Clearance Sale Selection").
  • Tier-banner pages and decorative section headers ("BELOW 400 THB",
    "Discover approachable, easy-drinking wines …") — but DO extract any
    cards that appear on the same page below the banner.
  • Footer text "*Prices exclude 7% VAT", "*MOQ …".

Return ONLY valid JSON: {"items": [ ... ]}.`

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseDate(filename: string, firstPageText: string, mode: 'horeca' | 'clearance'): string | null {
  const months: Record<string, string> = {
    january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',
    july:'07',august:'08',september:'09',october:'10',november:'11',december:'12',
    jan:'01',feb:'02',mar:'03',apr:'04',jun:'06',jul:'07',aug:'08',
    sep:'09',sept:'09',oct:'10',nov:'11',dec:'12',
  }
  // HORECA filename: "Enoteca_price.pdf" — title says "PRICE LIST HORECA _May_2026"
  // (read from body since title isn't part of firstPageText).
  // Clearance filename: "Enoteca_promo.pdf" — title is "Clearance Promotion 8-5-26".
  if (mode === 'clearance') {
    // Title "8-5-26" → d-m-yy.
    const m = filename.match(/(\d{1,2})[-_](\d{1,2})[-_](\d{2,4})/)
    if (m) {
      const day = m[1].padStart(2, '0')
      const mo = m[2].padStart(2, '0')
      const yr = m[3].length === 2 ? `20${m[3]}` : m[3]
      return `${yr}-${mo}-${day}`
    }
  }
  const titleMatch = firstPageText.match(/HORECA\s+PRICE\s+LIST[^A-Za-z]*([A-Z][a-z]+)\s*(\d{4})/i)
                   ?? firstPageText.match(/PRICE\s+LIST[^A-Za-z]*([A-Z][a-z]+)\s*(\d{4})/i)
  if (titleMatch) {
    const mo = months[titleMatch[1].toLowerCase()]
    if (mo) return `${titleMatch[2]}-${mo}-01`
  }
  // Body "May 2026" line.
  const bodyMatch = firstPageText.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b\s+(\d{4})/i)
  if (bodyMatch) {
    const mo = months[bodyMatch[1].toLowerCase()]
    if (mo) return `${bodyMatch[2]}-${mo}-01`
  }
  return null
}

async function callWithImages(prompt: string, imagesBase64: string[]): Promise<string> {
  const blocks = imagesBase64.map(data => ({
    type: 'image' as const,
    source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data },
  }))
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
      const base = 1000 * Math.pow(2, attempt - 1)
      const jitter = base * (0.75 + Math.random() * 0.5)
      console.warn(`[enoteca] anthropic retry ${attempt}/${MAX_ATTEMPTS - 1} after ${Math.round(jitter)}ms (${describeErr(e)})`)
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
  const id = `enoteca_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const outPrefix = join(tmpdir(), id)
  try {
    await exec('pdftoppm', [
      '-jpeg', '-r', String(scale),
      '-f', String(fromPage), '-l', String(toPage),
      pdfPath, outPrefix,
    ], { maxBuffer: 64 * 1024 * 1024 })
  } catch (e) {
    console.error('[enoteca] pdftoppm failed:', e instanceof Error ? e.message : e)
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
