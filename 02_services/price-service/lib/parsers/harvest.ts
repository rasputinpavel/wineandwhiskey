// Russian Wine Harvest — Russian-focused supplier (vodkas, gins, Russian wines).
//
// 19-page PDFium catalog where many pages put the brand name in raster
// imagery (e.g. "BARRISTER GIN" on page 5 is text in PNG, not extractable).
// Use Claude Vision per 2-page chunk like P-HOPS.
//
// Layouts in the catalog:
//   1. Single-product spirits showcase (Imperial Collection Gold, Czar's
//      Gold, Petroff Russian Vodka) — brand + 1L/0.7L pair of prices.
//   2. Variant grid (Barrister Gin) — one brand, multiple variants
//      (DRY ฿910, PINK / BLUE ฿990) with shared volume.
//   3. Two-product wine page (Vedernikov Winery) — winery name in script
//      typeface + 2 wines side by side with Region / Variety / Alc / notes.
//
// Each volume listing yields a separate item (1L and 0.7L of the same
// vodka are separate rows). Default country is Russia unless brand clearly
// says otherwise. SKU is absent → dedup by (name, volume, price).

import { writeFileSync, unlinkSync, readFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { PDFDocument } from 'pdf-lib'
import Anthropic from '@anthropic-ai/sdk'
import type { ExtractedItem, ExtractionResult } from '../claude'

const exec = promisify(execFile)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SUPPLIER_NAME = 'Russian Wine Harvest'

type ProgressCb = (pct: number, phase?: string, itemCount?: number) => Promise<void> | void

// ─── Detection ─────────────────────────────────────────────────────────────

export async function isHarvest(buf: Buffer, filename: string): Promise<boolean> {
  if (/harvest/i.test(filename)) return true
  const path = await writeTemp(buf)
  try {
    const text = await pdftotextLayout(path, 1, 5)
    return /Russian\s+Wine\s+Harvest/i.test(text)
        || /Imperial\s+Collection|LADOGA|Vedernikov\s+Winery|Czar'?s\s+Gold|Barrister\s+Gin/i.test(text)
  } catch {
    return false
  } finally {
    safeUnlink(path)
  }
}

// ─── Entry point ───────────────────────────────────────────────────────────

export async function parseHarvest(
  buf: Buffer,
  _filename: string,
  onProgress?: ProgressCb,
): Promise<ExtractionResult> {
  const totalPages = await getPageCount(buf)
  await onProgress?.(5, 'rendering pages')

  const pdfPath = await writeTemp(buf)
  let pageImages: string[] = []
  try {
    pageImages = await renderPagesToJpegs(pdfPath, 1, totalPages, 130)
  } finally {
    safeUnlink(pdfPath)
  }
  console.log(`[harvest] rendered ${pageImages.length} page images`)

  const CHUNK = 2
  const PARALLEL = 5
  const allItems: ExtractedItem[] = []

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
        const fromPg = c.offset + 1
        const toPg = fromPg + c.images.length - 1
        try {
          const raw = await callWithImages(PROMPT, c.images)
          const parsed = parseJson<{ items: ExtractedItem[] }>(raw)
          const items = parsed?.items ?? []
          console.log(`[harvest] pages ${fromPg}-${toPg} → ${items.length} items`)
          return items
        } catch (e) {
          console.error(`[harvest] pages ${fromPg}-${toPg} failed:`, e instanceof Error ? e.message : e)
          return []
        }
      })
    )
    results.forEach(items => allItems.push(...items))
    chunksDone += batch.length
    const pct = 15 + Math.round((chunksDone / imageChunks.length) * 75)
    await onProgress?.(pct, `extracting ${chunksDone}/${imageChunks.length}`, allItems.length)
  }

  await onProgress?.(95, 'inserting')
  return {
    supplier_name: SUPPLIER_NAME,
    price_list_date: null,
    currency: 'THB',
    items: dedup(allItems),
  }
}

// ─── Prompt ────────────────────────────────────────────────────────────────

const PROMPT = `This is the Russian Wine Harvest catalog. Each page is an image — read it as a price list.

The supplier focuses on Russian-made products: vodkas (Imperial Collection,
Czar's Gold, Petroff, Tundra), gins (Barrister), and Russian wines
(Vedernikov, Krasnostop, Sibirkovyi). Default country is Russia unless the
page clearly indicates otherwise.

Three layouts coexist:

1. SINGLE-PRODUCT SPIRITS SHOWCASE (e.g. "CZAR'S GOLD")
   - Brand name in big bold letters
   - "ALCOHOL BY VOLUME - 40%" or similar
   - Two prices for two volumes, e.g.
       1 L.    ฿1,185
       0.7 L.  ฿1,060
   → Output ONE item PER VOLUME (so 2 items for this page).

2. VARIANT GRID (e.g. "BARRISTER GIN")
   - Brand at top + shared "VOLIME - 0,7 L. ALCOHOL BY VOLUME - 40%"
   - List of variants and their prices:
       DRY       ฿910
       PINK / BLUE  ฿990
   → If a price line says "PINK / BLUE", output ONE item for each colour
     (Pink Gin ฿990, Blue Gin ฿990) at the shared volume.
   → Otherwise one item per variant.

3. TWO-PRODUCT WINE PAGE (e.g. "Vedernikov Winery")
   - Winery name in cursive at top
   - Two wines side by side, each with:
       Wine Name (CAPS)
       Price ฿N
       Region: <text>
       Variety: <grapes>
       Alcohol by volume: X%
       Tasting note paragraph
   → Output ONE item per wine.

For each item return:
{
  "name": "<full name; for spirits prepend brand if it's not in the variant name (e.g. 'Barrister Dry Gin' rather than 'Dry'); for wines prepend winery if missing (e.g. 'Vedernikov Sibirkovyi')>",
  "winery": "<brand or winery>",
  "country": "<canonical country, default 'Russia'>",
  "region": "<for wines, the Region field; null for spirits>",
  "grape_variety": "<for wines, the Variety field; null for spirits>",
  "year": <integer if a vintage is shown, otherwise null>,
  "price": <integer THB>,
  "volume": "<bottle size normalized: '700ml', '1000ml' (1L), '500ml', '50ml', etc.>",
  "wine_type": "red"|"white"|"rose"|"orange"|"sparkling"|null,
  "category": "wine"|"spirits"|"beer"|"other",
  "spirit_type": "<canonical: vodka/gin/whisky/rum/tequila/brandy/cognac/grappa/liqueur/sake/vermouth/aperitif/bitters — only when category=spirits>",
  "description": "<short note (origin/style/tasting), max 200 chars>"
}

Determine wine_type for wine pages from grape varieties + name + colour
hints (Krasnostop Rosé / "Rosé" → rose, white grapes / "white" → white,
red grapes / "red" → red, "sparkling/champagne" → sparkling).

Skip pages that are pure marketing or company info with no prices. Return
ONLY JSON: {"items": [...]}.`

// ─── Helpers ────────────────────────────────────────────────────────────────

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
  const id = `harvest_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const outPrefix = join(tmpdir(), id)
  try {
    await exec('pdftoppm', [
      '-jpeg', '-r', String(scale),
      '-f', String(fromPage), '-l', String(toPage),
      pdfPath, outPrefix,
    ], { maxBuffer: 64 * 1024 * 1024 })
  } catch (e) {
    console.error('[harvest] pdftoppm failed:', e instanceof Error ? e.message : e)
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

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()) as T
  } catch {
    return null
  }
}

async function getPageCount(buf: Buffer): Promise<number> {
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true })
  return doc.getPageCount()
}

function dedup(items: ExtractedItem[]): ExtractedItem[] {
  const seen = new Set<string>()
  return items.filter(it => {
    const key = `${(it.name || '').toLowerCase().trim()}|${it.volume ?? ''}|${it.price ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function writeTemp(buf: Buffer): Promise<string> {
  const path = join(tmpdir(), `harvest_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`)
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
