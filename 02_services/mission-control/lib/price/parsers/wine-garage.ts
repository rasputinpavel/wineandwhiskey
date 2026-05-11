// Wine Garage — 45-page InDesign catalog with ~600+ wines + a few spirits.
//
// Layout is a strict table: TYPE | WINE | RATING/FARMING | BOTTLE | TRADE.
// The BOTTLE column is the bottle PHOTO, not a price; the TRADE column is
// the only visible price (the wholesale price to trade buyers — that's us).
//
// Quirk that bit us with pdftotext: the PDF text layer carries TWO numbers
// per row at almost identical (top,left) coordinates — the visible TRADE
// price and a hidden retail price stacked on top of each other. Reading
// the text layer naïvely yields the wrong price ~50% of the time depending
// on which fragment pdftotext emits first. We sidestep this by rendering
// each page to a JPEG and reading the catalog via Claude Vision — the
// model sees only what's actually printed.
//
// Section hierarchy (sticky):
//   ARGENTINA / AUSTRALIA / AUSTRIA / CHINA / CHILE / FRANCE / ...    ← country (center, red)
//   MENDOZA / WACHAU / SWARTLAND / BURGUNDY / ...                     ← sub-region (left, uppercase)
//   <Producer Name>  <farming> | <website>                            ← producer (red bold)
//
// TYPE codes (cell at the start of each row):
//   W  white       R  red         Ro rose        O  orange (skin contact)
//   Sk skin        Sp sparkling   Sw sweet       F  fortified
//   SV sous voile (vin jaune)     Ap aperitivo   C  cider
//   "Sp Ro" sparkling rose, "Sp R" sparkling red
//
// Iron Balls Distillery (THAILAND/BANGKOK, p.45) is the one spirits block:
// no vintage, name is "Gin 330ml" / "Gin 700ml". The OTHER section at the
// end of page 45 is glassware — skip.

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

const writeTemp = (buf: Buffer) => writeTempShared(buf, 'wgarage')

const SUPPLIER_NAME = 'Wine Garage'

type ProgressCb = (pct: number, phase?: string, itemCount?: number) => Promise<void> | void

// ─── Detection ─────────────────────────────────────────────────────────────

export async function isWineGarage(buf: Buffer, filename: string): Promise<boolean> {
  if (/wine[\s_-]*garage/i.test(filename)) return true
  const path = await writeTemp(buf)
  try {
    const text = await pdftotextLayout(path, 1, 4)
    return /WINEGARAGE|@WINEGARAGE|ORDER@WINEGARAGE|WINEGARAGEBANGKOK|winegarage\.asia/i.test(text)
  } catch {
    return false
  } finally {
    safeUnlink(path)
  }
}

// ─── Entry point ───────────────────────────────────────────────────────────

export async function parseWineGarage(
  buf: Buffer,
  filename: string,
  onProgress?: ProgressCb,
): Promise<ExtractionResult> {
  const totalPages = await getPageCount(buf)
  await onProgress?.(5, 'rendering pages')

  // Pages 1-4 are intro/highlights with no prices. Catalog body starts p.5.
  const START_PAGE = 5

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set in the environment')
  }

  const pdfPath = await writeTemp(buf)
  let pageImages: string[] = []
  let firstPageText = ''
  try {
    firstPageText = await pdftotextLayout(pdfPath, 1, 1)
    pageImages = await renderPagesToJpegs(pdfPath, START_PAGE, totalPages, 140)
  } finally {
    safeUnlink(pdfPath)
  }
  console.log(`[wine-garage] rendered ${pageImages.length} page images (p.${START_PAGE}–${totalPages})`)

  if (pageImages.length === 0) {
    throw new Error(`pdftoppm rendered 0 pages from a ${totalPages}-page PDF — check that poppler_utils is in the build image`)
  }

  const CHUNK = 2
  const PARALLEL = 5
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
          console.log(`[wine-garage] pages ${fromPg}-${toPg} → ${items.length} items`)
          return items
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          console.error(`[wine-garage] pages ${fromPg}-${toPg} failed:`, msg)
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

  // Fail loudly when every chunk errored — silently returning 0 items hides
  // misconfigured API keys, model outages, etc.
  if (allItems.length === 0 && chunkErrors.length > 0) {
    throw new Error(`All ${chunkErrors.length} chunks failed. First error: ${chunkErrors[0]}`)
  }

  await onProgress?.(95, 'inserting')
  const normalised = allItems.map(canonicaliseItem)
  return {
    supplier_name: SUPPLIER_NAME,
    price_list_date: parseDate(filename, firstPageText),
    currency: 'THB',
    items: dedupBy(
      normalised,
      it => `${(it.name || '').toLowerCase().trim()}|${it.year ?? ''}|${it.volume ?? ''}|${it.price ?? ''}`,
    ),
  }
}

// ─── Normalisation ─────────────────────────────────────────────────────────

// Section headers in the catalog are ALL CAPS; the model echoes them
// verbatim, yielding mixed "France"/"FRANCE" across batches. Canonicalise
// everything to one form so downstream dedup/joins behave.
const COUNTRY_CANON: Record<string, string> = {
  argentina: 'Argentina', australia: 'Australia', austria: 'Austria',
  china: 'China', chile: 'Chile', france: 'France', germany: 'Germany',
  georgia: 'Georgia', greece: 'Greece', hungary: 'Hungary', italy: 'Italy',
  'new zealand': 'New Zealand', portugal: 'Portugal',
  'south africa': 'South Africa', spain: 'Spain',
  'united states': 'USA', usa: 'USA', 'u.s.a.': 'USA',
  thailand: 'Thailand', other: 'Other',
}

// Armagnac is brandy; pisco, mezcal, calvados → brandy/other; etc.
const SPIRIT_CANON: Record<string, string> = {
  armagnac: 'brandy', calvados: 'brandy', cognac: 'cognac', brandy: 'brandy',
  whisky: 'whisky', whiskey: 'whisky', bourbon: 'whisky', rye: 'whisky',
  rum: 'rum', gin: 'gin', vodka: 'vodka', tequila: 'tequila', mezcal: 'tequila',
  grappa: 'grappa', pisco: 'brandy',
  liqueur: 'liqueur', amaro: 'amaro', vermouth: 'vermouth',
  aperitif: 'aperitif', aperitivo: 'aperitif', bitters: 'bitters',
  sake: 'sake', 'eau de vie': 'brandy', 'eaux de vie': 'brandy',
}

function canonicaliseItem(it: ExtractedItem): ExtractedItem {
  const out: ExtractedItem = { ...it }
  if (out.country) {
    const canon = COUNTRY_CANON[out.country.toLowerCase().trim()]
    if (canon) out.country = canon
  }
  if (out.category === 'spirits') {
    // Infer spirit_type from the name when the model left it null
    // (commonly happens for Armagnac, eau de vie, calvados sub-categories).
    const haystack = `${it.spirit_type ?? ''} ${it.name ?? ''}`.toLowerCase()
    for (const key of Object.keys(SPIRIT_CANON)) {
      if (haystack.includes(key)) { out.spirit_type = SPIRIT_CANON[key]; break }
    }
  }
  return out
}

// ─── Prompt ────────────────────────────────────────────────────────────────

const PROMPT = `You are reading pages from the Wine Garage Bangkok price list (May 2026).
Each page is a structured table with columns:
  TYPE | WINE | RATING/FARMING | BOTTLE (bottle photo, no text) | TRADE (price in THB)

Extract ONE item per row. The TRADE column contains the only price — IGNORE
any retail/bottle price (the BOTTLE column is just a bottle photo). If a row
shows "Rare & Limited" in place of a price, output the item with price=null.

Sticky context above each row block:
  • Country header — centered, red, ALL CAPS (ARGENTINA, AUSTRALIA, AUSTRIA,
    CHINA, CHILE, FRANCE, GERMANY, GEORGIA, GREECE, HUNGARY, ITALY,
    NEW ZEALAND, PORTUGAL, SOUTH AFRICA, SPAIN, UNITED STATES, THAILAND, OTHER).
  • Sub-region — left, uppercase (MENDOZA, WACHAU, SWARTLAND, BURGUNDY,
    ALSACE, BORDEAUX, RHÔNE, ...). Use as 'region'.
  • Producer header — red bold "<Name>  <farming> | <website>". Use as 'winery'.
    If the producer header is implied or missing, leave winery null.
  • A WHITE/RED/ROSÉ etc. sub-label may appear under a producer (e.g.
    Mullineux "WHITE, Swartland"). Treat it as a visual grouping, not a row.

TYPE codes (left column, ONE letter + optional space + colour icon):
  W  → white         R  → red          Ro → rose          O  → orange
  Sk → skin contact (treat as orange)
  Sp → sparkling     Sw → sweet        F  → fortified
  SV → sous voile (vin jaune) — wine_type=null, category=wine
  Ap → aperitivo (vermouth / amaro / aperitif) — category=spirits
  C  → cider — category=other
  "Sp Ro" → sparkling, rose colour
  "Sp R"  → sparkling, red colour

Row body shape:
  <TYPE>  <YEAR or NV>  <wine name + parenthetical notes>  <ratings/farming>  <price>

Year: 4-digit vintage or "NV" (non-vintage → year=null).
Name: include parenthetical notes about composition/style only if short
  (e.g. "Kloof Street Old Vine Chenin Blanc"). Drop very long descriptive
  tails. Preserve case as printed.
Volume: detect inline volume markers in the name:
  • "1.5L", "Magnum 1.5L", "Magnum"  → "1500ml"
  • "375ml", "500ml", "700ml", "330ml" → keep as written
  • otherwise default "750ml"

Ratings/farming column: extract any farming keyword (organic / biodynamic /
sustainable / natural / low intervention / biological / demeter biodynamic /
artisan) into 'description'. Also include any critic scores ("Vinous 92",
"RP 94", "JS 91", "JR 17", "FS 92", etc.) — short, comma-separated, ≤200 chars.

For each row return:
{
  "name": "<wine name as printed, no rating/farming text>",
  "winery": "<producer name from header, or null>",
  "country": "<from country header>",
  "region": "<from sub-region header, or null>",
  "grape_variety": "<grape if obvious from name parentheticals, otherwise null>",
  "year": <integer vintage or null for NV>,
  "price": <TRADE price as integer THB, or null if 'Rare & Limited'>,
  "volume": "<normalized volume, default '750ml'>",
  "wine_type": "red"|"white"|"rose"|"orange"|"sparkling"|null,
  "category": "wine"|"spirits"|"beer"|"other",
  "spirit_type": "<gin/vodka/whisky/rum/grappa/vermouth/amaro/aperitif/liqueur if category=spirits, else null>",
  "description": "<farming + critic scores, ≤200 chars>"
}

THAILAND / BANGKOK has Iron Balls Distillery (spirits, no vintage):
  rows like "Gin 330ml ... 780" and "Gin 700ml ... 1,400".
  → name "Iron Balls Gin", volume from the row, year null,
    category=spirits, spirit_type='gin', wine_type=null, country='Thailand'.

OTHER section (page 45 bottom) is GLASSWARE — Gabriel Glass, Kimura Glass,
The Parr Glass. Skip entirely. Do not output glassware items.

Skip pure marketing/profile pages with no price rows. If price is "Rare &
Limited", still emit the item with price=null so we know it exists.

Return ONLY JSON: {"items": [...]}.`

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseDate(filename: string, firstPageText: string): string | null {
  // Filename like "Wine garage may.pdf" → 2026-05-01
  const months: Record<string, string> = {
    january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',
    july:'07',august:'08',september:'09',october:'10',november:'11',december:'12',
    jan:'01',feb:'02',mar:'03',apr:'04',jun:'06',jul:'07',aug:'08',
    sep:'09',sept:'09',oct:'10',nov:'11',dec:'12',
  }
  const fnMatch = filename.toLowerCase().match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/)
  // Catalog title: "PRICE LIST MAY 2026"
  const titleMatch = firstPageText.match(/PRICE\s+LIST\s+([A-Z]+)\s+(\d{4})/i)
  const yearFromTitle = titleMatch ? titleMatch[2] : new Date().getFullYear().toString()
  const monthFromTitle = titleMatch ? months[titleMatch[1].toLowerCase()] : null
  const monthFromFn = fnMatch ? months[fnMatch[1]] : null
  const month = monthFromTitle ?? monthFromFn
  if (!month) return null
  return `${yearFromTitle}-${month}-01`
}

async function callWithImages(prompt: string, imagesBase64: string[]): Promise<string> {
  const blocks = imagesBase64.map(data => ({
    type: 'image' as const,
    source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data },
  }))
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 16384,
    messages: [{ role: 'user', content: [...blocks as unknown as Anthropic.TextBlockParam[], { type: 'text', text: prompt }] }],
  })
  return res.content[0].type === 'text' ? res.content[0].text : ''
}

async function renderPagesToJpegs(pdfPath: string, fromPage: number, toPage: number, scale: number): Promise<string[]> {
  const id = `wgarage_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const outPrefix = join(tmpdir(), id)
  try {
    await exec('pdftoppm', [
      '-jpeg', '-r', String(scale),
      '-f', String(fromPage), '-l', String(toPage),
      pdfPath, outPrefix,
    ], { maxBuffer: 64 * 1024 * 1024 })
  } catch (e) {
    console.error('[wine-garage] pdftoppm failed:', e instanceof Error ? e.message : e)
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
