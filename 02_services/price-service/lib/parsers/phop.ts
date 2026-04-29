// P-HOPS (Phuket beverage importer) — image-based 27-page PDF (iOS Quartz).
//
// pdftotext returns ~1960 chars across all pages — almost everything is
// inside embedded JPEGs, so parsing relies on Claude Vision via the
// document API per 2-page chunk.
//
// Three layouts coexist in the catalog:
//   1. Brand table (page 5 Liefmans/Achouffe): brand header + row table
//      Name / ABV% / SIZE / TYPE / PRICE/UNIT / PRICE/CASE / PRICE/KEG
//   2. Single-product showcase (page 10 LaCroix, page 26 Brockman's Gin):
//      one product, big imagery, price per bottle or per case.
//   3. New-product cards (page 20): two products on page, each with ABV /
//      size+container / case / Brew location / PRICE.
//
// Pricing rule (user-confirmed): prefer per-UNIT price; fall back to
// per-CASE price and prepend "Case price" to description.
//
// Categories from content:
//   - Beer brands (most pages) → category='beer'
//   - Spirits (Gin/Whisky/etc) → category='spirits'
//   - Non-alcoholic (LaCroix sparkling water) → category='other'
//
// SKU is absent → dedup by (name, volume, price).

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

const SUPPLIER_NAME = 'P-HOPS'

type ProgressCb = (pct: number, phase?: string, itemCount?: number) => Promise<void> | void

// ─── Detection ─────────────────────────────────────────────────────────────

export async function isPhop(buf: Buffer, filename: string): Promise<boolean> {
  if (/p-?hops?|phop/i.test(filename)) return true
  const path = await writeTemp(buf)
  try {
    const text = await pdftotextLayout(path, 1, 3)
    return /\bP-HOPS\b/i.test(text) || /XJOBBIEX/i.test(text) || /Phuket\s+beverage/i.test(text)
  } catch {
    return false
  } finally {
    safeUnlink(path)
  }
}

// ─── Entry point ───────────────────────────────────────────────────────────

export async function parsePhop(
  buf: Buffer,
  _filename: string,
  onProgress?: ProgressCb,
): Promise<ExtractionResult> {
  const totalPages = await getPageCount(buf)
  await onProgress?.(5, 'reading PDF')

  // Skip the first 3 pages (cover + table-of-contents-like marketing).
  // Catalog content starts around page 4.
  const startPage = 4
  const CHUNK = 2
  const PARALLEL = 5
  const allItems: ExtractedItem[] = []

  const chunks: { from: number; to: number }[] = []
  for (let p = startPage; p <= totalPages; p += CHUNK) {
    chunks.push({ from: p, to: Math.min(p + CHUNK - 1, totalPages) })
  }

  await onProgress?.(10, 'extracting')
  let chunksDone = 0

  // pdf-lib can't reliably extract image-only pages from iOS Quartz PDFs
  // (Claude sees blank chunks). Render each page to JPEG via pdftoppm and
  // send as image content instead.
  const pdfPath = await writeTemp(buf)
  let pageImages: string[] = []
  try {
    pageImages = await renderPagesToJpegs(pdfPath, startPage, totalPages, 130)
  } finally {
    safeUnlink(pdfPath)
  }
  console.log(`[phop] rendered ${pageImages.length} page images`)

  // Re-chunk: each chunk is up to CHUNK page images.
  const imageChunks: { offset: number; images: string[] }[] = []
  for (let p = 0; p < pageImages.length; p += CHUNK) {
    imageChunks.push({ offset: p, images: pageImages.slice(p, p + CHUNK) })
  }

  for (let i = 0; i < imageChunks.length; i += PARALLEL) {
    const batch = imageChunks.slice(i, i + PARALLEL)
    const results = await Promise.all(
      batch.map(async (c) => {
        const fromPg = startPage + c.offset
        const toPg = fromPg + c.images.length - 1
        try {
          const raw = await callWithImages(PROMPT, c.images)
          const parsed = parseJson<{ items: ExtractedItem[] }>(raw)
          const items = parsed?.items ?? []
          console.log(`[phop] pages ${fromPg}-${toPg} → ${items.length} items`)
          return items
        } catch (e) {
          console.error(`[phop] pages ${fromPg}-${toPg} failed:`, e instanceof Error ? e.message : e)
          return []
        }
      })
    )
    results.forEach(items => allItems.push(...items))
    chunksDone += batch.length
    const pct = 10 + Math.round((chunksDone / imageChunks.length) * 80)
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

// ─── Prompt ─────────────────────────────────────────────────────────────────

const PROMPT = `This is the P-HOPS (Phuket beverage importer) catalog. Each page is an image — read it as a price list.

Three layouts coexist:

1. BRAND TABLE PAGE (e.g. Liefmans / Brasserie D'Achouffe / Brockmans):
   - Brand name big at top
   - Table with columns: ProductName | ABV% | SIZE (e.g. "330ml x 24") | TYPE | PRICE/UNIT | PRICE/CASE | PRICE/KEG
   - One row per product variant.

2. SINGLE-PRODUCT SHOWCASE (e.g. LaCroix sparkling water, Brockman's Gin):
   - Large product image
   - "Case Price : 1,080 THB" or "PRICE: 2,450.- THB BOTTLE"
   - Sometimes only case price is shown.

3. NEW-PRODUCT CARDS (e.g. Umbrewla, Hopzone):
   - Two products side by side
   - Each card: brand + product name + "ABV X.X% | 330ml bottle | 12 bottles/case" + "Brew in Thailand" + "PRICE : 135.-"

For EVERY product (regardless of layout) return ONE item:
{
  "name": "<full brand + product name, e.g. 'Liefmans Fruitesse on the Rocks' or 'La Chouffe Blond Ale' or 'Brockmans Intensely Smooth Gin'>",
  "winery": "<brand/brewery name>",
  "country": "<infer from brand: Belgian beers (La Chouffe/Liefmans) → Belgium; Brockmans/Sipsmith Gin → United Kingdom; LaCroix → USA; Thai craft (Umbrewla/Hopzone) → Thailand; etc.>",
  "region": null,
  "grape_variety": null,
  "year": null,
  "price": <number — PRICE/UNIT if shown, otherwise PRICE/CASE>,
  "volume": "<bottle/can size only, e.g. '330ml', '500ml', '750ml' — NOT the case size>",
  "wine_type": null,
  "category": "beer"|"spirits"|"other",
  "spirit_type": "<canonical: gin/whisky/vodka/rum/tequila/brandy/cognac/grappa/liqueur/sake/vermouth/aperitif/bitters — only when category=spirits>",
  "description": "<TYPE column value if present (e.g. 'Fruit Beer', 'Blond Ale'), plus 'Case price: N THB' if we used case price as price; max 200 chars>"
}

Category rules:
  - Beer (any ale/lager/pilsner/stout/IPA/fruit beer/wheat beer/sour) → "beer"
  - Spirits (gin/whisky/vodka/rum/tequila/brandy/cognac/liqueur) → "spirits"
  - Non-alcoholic (sparkling water like LaCroix, soft drinks) → "other"

Pricing: STRONGLY prefer the PRICE/UNIT (per-bottle) value. If only PRICE/CASE shown, divide by case quantity (e.g. 1,080 THB / 24 cans = 45 THB) ONLY when divisor is unambiguous; otherwise use the case price as-is and add "Case price (N THB / N units)" to description.

Skip pages that are pure marketing (cover, contact info, brand story without product table). Return ONLY JSON: {"items": [...]}.`

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
  const id = `phop_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const outPrefix = join(tmpdir(), id)
  try {
    await exec('pdftoppm', [
      '-jpeg', '-r', String(scale),
      '-f', String(fromPage), '-l', String(toPage),
      pdfPath, outPrefix,
    ], { maxBuffer: 64 * 1024 * 1024 })
  } catch (e) {
    console.error('[phop] pdftoppm failed:', e instanceof Error ? e.message : e)
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
  const path = join(tmpdir(), `phop_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`)
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
