// Boozia Distribution Co., Ltd. — Bangkok + Phuket beverage wholesaler.
// They publish one large "BEVERAGE CATALOGUE" PDF (~125 A4 pages) covering
// spirits AND wine, with a Canva-designed card per product:
//
//   • Section header at the top of each card: category (VODKA / WHISKY /
//     GIN / RUM / TEQUILA / BRANDY / LIQUEUR / APERITIF / WINE / SPARKLING /
//     CHAMPAGNE) on the first line, COUNTRY on the second.
//   • Spirits card: producer/name, "Alc.: 40%", "Size: 70 cl bottle",
//     a bio + "TASTING NOTES" paragraph, and a bare "THB <price>" stamp.
//   • Wine card: producer + cuvée, "Alc.: 14%", "Vintage: 2019",
//     "Grapes: Grenache 50%, Mourvèdre 50%", "TASTING NOTES", "THB <price>".
//     Wine pages sometimes stack TWO cards vertically → two items per page.
//
// There are NO supplier item codes anywhere in the catalog, so supplier_sku
// stays null (same as Enoteca's clearance mode / Richly). Price lists are
// versioned snapshots, so a missing SKU doesn't block re-uploads — the diff
// falls back to producer+name+vintage.
//
// All prices are exclusive of 7% VAT ("All prices are exclusive of VAT.");
// we store the printed THB number verbatim, matching every other parser.
//
// Why vision: the cards are free-floating Canva layouts. pdftotext recovers
// the values but loses which value belongs to which card on 2-up wine pages,
// so the model reads the rendered page instead.

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

const writeTemp = (buf: Buffer) => writeTempShared(buf, 'boozia')

const SUPPLIER_NAME = 'Boozia Distribution'

// Pages 1–2 are the cover + brand tagline; products start on PDF page 3.
const START_PAGE = 3

type ProgressCb = (pct: number, phase?: string, itemCount?: number) => Promise<void> | void

// ─── Detection ─────────────────────────────────────────────────────────────

export async function isBoozia(buf: Buffer, filename: string): Promise<boolean> {
  if (/boozia/i.test(filename)) return true
  const path = await writeTemp(buf)
  try {
    const text = await pdftotextLayout(path, 1, 3)
    return /BOOZIA\s*DISTRIBUTION|booziathailand\.com/i.test(text)
  } catch {
    return false
  } finally {
    safeUnlink(path)
  }
}

// ─── Entry point ───────────────────────────────────────────────────────────

export async function parseBoozia(
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
    firstPageText = await pdftotextLayout(pdfPath, 1, 3)
    pageImages = await renderPagesToJpegs(pdfPath, START_PAGE, totalPages, 140)
    console.log(`[boozia] rendered ${pageImages.length} pages (${START_PAGE}–${totalPages})`)
  } finally {
    safeUnlink(pdfPath)
  }

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
        const fromPg = START_PAGE + c.offset
        const toPg = fromPg + c.images.length - 1
        try {
          const raw = await callWithImages(PROMPT, c.images)
          const parsed = parseJson<{ items: ExtractedItem[] }>(raw)
          const items = parsed?.items ?? []
          console.log(`[boozia] pages ${fromPg}-${toPg} → ${items.length} items`)
          return items
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          console.error(`[boozia] pages ${fromPg}-${toPg} failed:`, msg)
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
    // No SKUs — dedup on producer+name+vintage+price+volume.
    items: dedupBy(
      normalised,
      it => `name:${(it.name || '').toLowerCase().trim()}|${it.year ?? ''}|${it.price ?? ''}|${it.volume ?? ''}`,
    ),
  }
}

// ─── Normalisation ─────────────────────────────────────────────────────────

const COUNTRY_CANON: Record<string, string> = {
  argentina: 'Argentina', australia: 'Australia', austria: 'Austria',
  chile: 'Chile', france: 'France', germany: 'Germany', greece: 'Greece',
  ireland: 'Ireland', italy: 'Italy', japan: 'Japan', mexico: 'Mexico',
  'new zealand': 'New Zealand', portugal: 'Portugal', scotland: 'Scotland',
  'south africa': 'South Africa', spain: 'Spain', 'united kingdom': 'United Kingdom',
  uk: 'United Kingdom', usa: 'USA', 'united states': 'USA', 'u.s.a.': 'USA',
  thailand: 'Thailand',
}

function canonicaliseItem(it: ExtractedItem): ExtractedItem {
  const out: ExtractedItem = { ...it }
  if (out.country) {
    const canon = COUNTRY_CANON[out.country.toLowerCase().trim()]
    if (canon) out.country = canon
  }
  // Treat 0 / non-finite years as null (NV spirits, model quirks).
  if (out.year === 0 || (out.year != null && !Number.isFinite(out.year))) out.year = null
  // Boozia has no supplier codes.
  out.supplier_sku = null
  return out
}

// ─── Prompt ────────────────────────────────────────────────────────────────

const PROMPT = `You are reading pages from Boozia Distribution's BEVERAGE CATALOGUE — a
wholesale spirits AND wine catalog. Each page holds ONE or TWO product cards
(wine pages sometimes stack two cards vertically).

STICKY SECTION HEADER (top of the card, ALL CAPS, two lines):
  • Line 1 = category: VODKA / WHISKY / WHISKEY / GIN / RUM / TEQUILA /
    BRANDY / COGNAC / LIQUEUR / APERITIF / WINE / SPARKLING / CHAMPAGNE.
  • Line 2 = COUNTRY (e.g. AUSTRALIA, SPAIN, FRANCE, JAPAN).
When a page has two cards, the header may appear once — apply it to both
unless a card clearly shows its own header.

EACH CARD contains:
  • Product name (producer + expression/cuvée, may span 1–2 lines).
  • "Alc.: <N>%"
  • Spirits: "Size: <N> cl bottle".  Wine: "Vintage: <YYYY>" and
    "Grapes: <grape list>".
  • A bio paragraph and a "TASTING NOTES" paragraph.
  • A "THB" label with the price on the line(s) below (e.g. "THB" then
    "2,190" → 2190). This is the price to load. Ignore "Limited Stock" or
    similar badges.

Output ONE item per card:

{
  "name": "<producer + expression/cuvée, e.g. 'Nordés Gin', 'Famille Jaume Clos des Echalas'>",
  "country": "<from the COUNTRY header line>",
  "region": "<wine appellation/region if stated (e.g. AOP name), else null>",
  "grape_variety": "<wine 'Grapes:' list verbatim, e.g. 'Grenache 50%, Mourvèdre 50%'. null for spirits>",
  "year": <wine 'Vintage:' as integer, e.g. 2019. null for spirits and non-vintage>,
  "price": <THB price as integer, e.g. "2,190" → 2190>,
  "volume": "<bottle size in ml. Convert 'Size: 70 cl' → '700ml', '75 cl' → '750ml', '100 cl' → '1000ml'. Wine defaults to '750ml' if size not shown>",
  "description": "<'Alc. <N>%' + condensed tasting notes, ≤200 chars>",
  "category": "wine" | "spirits" | "other",
  "wine_type": "red" | "white" | "rose" | "sparkling" | null,
  "spirit_type": "<lowercased spirit category for spirits: 'vodka' | 'whisky' | 'gin' | 'rum' | 'tequila' | 'brandy' | 'cognac' | 'liqueur' | 'aperitif'. null for wine>",
  "supplier_sku": null
}

CATEGORY MAPPING from the header:
  • VODKA/WHISKY/WHISKEY/GIN/RUM/TEQUILA/BRANDY/COGNAC/LIQUEUR/APERITIF
    → category="spirits", spirit_type=<that word lowercased>, wine_type=null.
  • WINE → category="wine", spirit_type=null. Infer wine_type from the
    grape/cuvée/colour: red grapes (cabernet, merlot, malbec, grenache,
    syrah/shiraz, sangiovese, nebbiolo, pinot noir, mourvèdre, …) → "red";
    white grapes (chardonnay, sauvignon blanc, riesling, viognier, pinot
    grigio/gris, albariño, …) → "white"; rosé/rosato → "rose"; if unclear
    use null.
  • SPARKLING/CHAMPAGNE → category="wine", wine_type="sparkling",
    spirit_type=null.

SKIP (return no item for these):
  • The cover page and brand-tagline page.
  • Section divider / table-of-contents pages (just a category word, no
    Alc./THB block).
  • The final contact/terms page.
  • Any card with no visible "THB" price.

Return ONLY valid JSON: {"items": [ ... ]}.`

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseDate(filename: string, firstPageText: string): string | null {
  const months: Record<string, string> = {
    january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',
    july:'07',august:'08',september:'09',october:'10',november:'11',december:'12',
    jan:'01',feb:'02',mar:'03',apr:'04',jun:'06',jul:'07',aug:'08',
    sep:'09',sept:'09',oct:'10',nov:'11',dec:'12',
  }
  // Filename: "Catalog_Apr_2026_v1.pdf" → month + year. Use explicit
  // separators, not \b — underscores are word chars so \b won't match "_Apr_".
  const fnMatch = filename.match(/(?:^|[._ -])(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[._ -]+(\d{4})(?=[._ -]|$)/i)
  if (fnMatch) {
    const mo = months[fnMatch[1].toLowerCase()]
    if (mo) return `${fnMatch[2]}-${mo}-01`
  }
  // Footer version stamp, e.g. "JAN2026V3".
  const stamp = firstPageText.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{4})V\d+\b/i)
  if (stamp) {
    const mo = months[stamp[1].toLowerCase()]
    if (mo) return `${stamp[2]}-${mo}-01`
  }
  // Bare year on the cover ("BEVERAGE CATALOGUE 2026").
  const yr = firstPageText.match(/\b(20\d{2})\b/)
  if (yr) return `${yr[1]}-01-01`
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
      console.warn(`[boozia] anthropic retry ${attempt}/${MAX_ATTEMPTS - 1} after ${Math.round(jitter)}ms (${describeErr(e)})`)
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
  const id = `boozia_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const outPrefix = join(tmpdir(), id)
  try {
    await exec('pdftoppm', [
      '-jpeg', '-r', String(scale),
      '-f', String(fromPage), '-l', String(toPage),
      pdfPath, outPrefix,
    ], { maxBuffer: 64 * 1024 * 1024 })
  } catch (e) {
    console.error('[boozia] pdftoppm failed:', e instanceof Error ? e.message : e)
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
