// Universal Fine Wine & Spirits Company Limited — three catalogs:
//
//   Fine Wine (66 pp, ~24K chars text)
//     3-cards-per-row premium vintages: Colgin / Opus One / Screaming Eagle
//     / Premier Cru Bordeaux (Cheval Blanc / Margaux / Latour) / Italy
//     (Masseto / Solaia / Pingus). Each card: brand + wine name + vintage
//     line, Region : ..., Product type : ..., Size : ..., price like
//     "26,000.-".
//
//   MAR Horeca (80 pp, ~66K chars)
//     Numbered list per row: "1 2020 Blazon Lodi Cabernet Sauvignon \n
//     Size : 750 ml. Region : California Product Type : Red \n 800.-"
//     Pages grouped by country with sub-section headers (Bordeaux,
//     Burgundy, Champagne, etc.). Vintage is the 4-digit year right
//     after the item number.
//
//   Spirits (19 pp, ~5K chars)
//     Same 3-cards-per-row layout as Fine Wine but for spirits (Gin,
//     Bourbon, Calvados, Armagnac, Mexican brands).
//
// All three use one supplier_name. Fine Wine uploads as kind='vip' via
// the filename->kind detector in route.ts; the other two are 'regular'.

import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { PDFDocument } from 'pdf-lib'
import Anthropic from '@anthropic-ai/sdk'
import type { ExtractedItem, ExtractionResult } from '../claude'

const exec = promisify(execFile)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SUPPLIER_NAME = 'Universal Fine Wine & Spirits Company Limited'

type Variant = 'fine_wine' | 'horeca' | 'spirits'
type ProgressCb = (pct: number, phase?: string, itemCount?: number) => Promise<void> | void

// ─── Detection ─────────────────────────────────────────────────────────────

export async function isUniversal(buf: Buffer, filename: string): Promise<boolean> {
  if (/universal/i.test(filename)) return true
  const path = await writeTemp(buf)
  try {
    const text = await pdftotextLayout(path, 1, 3)
    return /Universal\s+Fine\s+Wine/i.test(text)
        || /Universal\s+Spirits/i.test(text)
        || /MAR[\s_]?Horeca/i.test(text)
  } catch {
    return false
  } finally {
    safeUnlink(path)
  }
}

function detectVariant(filename: string, firstPage: string): Variant {
  const fn = filename.toLowerCase()
  if (/horeca|mar[\s_]?horeca/i.test(fn) || /Catalogue\s+2026/.test(firstPage)) return 'horeca'
  if (/spirits?|sprirts/i.test(fn) || /SPIRITS\s+CATALOGUE/.test(firstPage)) return 'spirits'
  return 'fine_wine'
}

// ─── Entry point ───────────────────────────────────────────────────────────

export async function parseUniversal(
  buf: Buffer,
  filename: string,
  onProgress?: ProgressCb,
): Promise<ExtractionResult> {
  const totalPages = await getPageCount(buf)
  const path = await writeTemp(buf)
  let firstPage = ''
  try {
    firstPage = await pdftotextLayout(path, 1, 1)
  } finally {
    safeUnlink(path)
  }

  const variant = detectVariant(filename, firstPage)
  console.log(`[universal] ${variant} catalog (${totalPages} pages)`)
  await onProgress?.(5, `reading ${variant}`)

  // Skip cover (page 1) and TOC (page 2). Fine Wine and Spirits both have
  // a 1-page cover before the TOC; MAR Horeca has cover page 1 and starts
  // products at page 3.
  const startPage = variant === 'horeca' ? 3 : variant === 'fine_wine' ? 2 : 3

  const items = await runChunked(buf, totalPages, startPage, variant, onProgress)

  await onProgress?.(95, 'inserting')
  return {
    supplier_name: SUPPLIER_NAME,
    price_list_date: null,
    currency: 'THB',
    items: dedup(items),
  }
}

// ─── Chunked extraction ────────────────────────────────────────────────────

async function runChunked(
  buf: Buffer,
  totalPages: number,
  startPage: number,
  variant: Variant,
  onProgress?: ProgressCb,
): Promise<ExtractedItem[]> {
  const CHUNK_SIZE = 2
  const PARALLEL = 5
  const allItems: ExtractedItem[] = []

  const chunks: { from: number; to: number }[] = []
  for (let p = startPage; p <= totalPages; p += CHUNK_SIZE) {
    chunks.push({ from: p, to: Math.min(p + CHUNK_SIZE - 1, totalPages) })
  }

  let chunksDone = 0
  await onProgress?.(10, 'extracting')

  for (let i = 0; i < chunks.length; i += PARALLEL) {
    const batch = chunks.slice(i, i + PARALLEL)
    const results = await Promise.all(
      batch.map(async (c) => {
        try {
          const chunkBuf = await extractPdfPages(buf, c.from, c.to)
          const raw = await callWithPdf(promptFor(variant), chunkBuf.toString('base64'))
          const parsed = parseJson<{ items: ExtractedItem[] }>(raw)
          const items = parsed?.items ?? []
          console.log(`[universal] ${variant} pages ${c.from}-${c.to} → ${items.length} items`)
          return items
        } catch (e) {
          console.error(`[universal] ${variant} pages ${c.from}-${c.to} failed:`, e instanceof Error ? e.message : e)
          return []
        }
      })
    )
    results.forEach(items => allItems.push(...items))
    chunksDone += batch.length
    const pct = 10 + Math.round((chunksDone / chunks.length) * 80)
    await onProgress?.(pct, `extracting ${chunksDone}/${chunks.length}`, allItems.length)
  }
  return allItems
}

// ─── Prompts ────────────────────────────────────────────────────────────────

function promptFor(variant: Variant): string {
  if (variant === 'fine_wine') return FINE_WINE_PROMPT
  if (variant === 'horeca') return HORECA_PROMPT
  return SPIRITS_PROMPT
}

const FINE_WINE_PROMPT = `This is the Universal FINE WINE catalog (premium vintages, 3-cards-per-row layout).

Each page has 3 product cards arranged horizontally. Each card looks like:
  Brand name (e.g. "Colgin", "Opus One", "Chateau Margaux")
  Wine sub-name + vintage (e.g. "IX Estate Red Wine 2012", "Pavillon Rouge 2018")
  Region : Napa Valley, USA   (or "Bordeaux, France", "Tuscany, Italy", etc.)
  Product type : Red | White | Rose | Sparkling | Champagne
  Size : 750 ml.
  PRICE (e.g. "26,000.-")

Section headers like "WINE", "WINE / Colgin" mark the brand block — every
card under it belongs to that brand until the next header.

For EACH card return ONE item:
{
  "name": "<full brand + wine name + vintage, e.g. 'Colgin IX Estate Red Wine 2012'>",
  "winery": "<brand from section header (e.g. 'Colgin', 'Chateau Margaux', 'Opus One')>",
  "country": "<from Region value, e.g. 'USA', 'France', 'Italy'>",
  "region": "<region portion, e.g. 'Napa Valley'>",
  "grape_variety": null,
  "year": <vintage integer or null>,
  "price": <integer THB from 'N.-' line>,
  "volume": "<from Size, normalized e.g. '750ml'>",
  "wine_type": "red"|"white"|"rose"|"orange"|"sparkling"|null,
  "category": "wine",
  "spirit_type": null,
  "description": null
}

Map Product type to wine_type: Red→red, White→white, Rose→rose, Sparkling/Champagne→sparkling.

Skip pages that are pure cover/TOC content (no product cards). Return ONLY JSON: {"items": [...]}.`

const HORECA_PROMPT = `This is the Universal MAR Horeca catalog (numbered list of wines).

Each page is grouped by country (header at top: USA, Australia, Chile, France, Germany, Italy, New Zealand, Spain). France pages have sub-section headers like "Bordeaux", "Burgundy", "Champagne", "Margaux", etc.

Item rows look like:
  1 2020 Blazon  Lodi Cabernet Sauvignon
       Size : 750 ml. Region : California Product Type : Red
            800.-

So each item begins with a 1-2 digit number, then a 4-digit vintage (or "NV"), then the brand/wine name. Below it the Size/Region/ProductType line, then the price "N.-".

For each numbered item return ONE item:
{
  "name": "<full brand + wine name (omit the leading number and vintage), e.g. 'Blazon Lodi Cabernet Sauvignon'>",
  "winery": "<brand portion only, first 1-2 words after the vintage, e.g. 'Blazon', 'Bogle', 'Mondavi'>",
  "country": "<from page country header (USA / Australia / Chile / France / Germany / Italy / New Zealand / Spain)>",
  "region": "<from Region: value, e.g. 'California', 'Lodi', 'Bordeaux'; if missing, use the sub-section header (Bordeaux/Burgundy/Margaux/...)>",
  "grape_variety": null,
  "year": <vintage integer or null if 'NV'>,
  "price": <integer THB from 'N.-' line>,
  "volume": "<from Size, normalized e.g. '750ml', '375ml', '3000ml' (3L Bota Box)>",
  "wine_type": "red"|"white"|"rose"|"orange"|"sparkling"|null,
  "category": "wine",
  "spirit_type": null,
  "description": null
}

Map Product Type to wine_type. Champagne → sparkling.

Skip pages that are pure TOC/cover. Return ONLY JSON: {"items": [...]}.`

const SPIRITS_PROMPT = `This is the Universal SPIRITS catalog (3-cards-per-row layout, similar to Fine Wine).

Each page has 3 cards. Each card:
  Brand name (e.g. "Tempus Two", "Glenfiddich")
  Variant + flavour (e.g. "Wild Botanical Gin", "Single Cask Bourbon")
  Region : Australia / France / USA / etc.
  Product : Type : Gin / Bourbon / Calvados / Armagnac / Tequila / Whisky / etc.
  Size : 700 ml.
  PRICE (e.g. "1,800.-")

Section headers ("SPIRITS / Tempus Two") indicate brand block.

For each card return ONE item:
{
  "name": "<full brand + variant, e.g. 'Tempus Two Wild Botanical Gin'>",
  "winery": "<brand from section header>",
  "country": "<from Region>",
  "region": null,
  "grape_variety": null,
  "year": null,
  "price": <integer THB>,
  "volume": "<from Size, normalized e.g. '700ml'>",
  "wine_type": null,
  "category": "spirits",
  "spirit_type": "<canonical: gin/whisky/vodka/rum/tequila/brandy/cognac/grappa/calvados/armagnac/liqueur/sake/vermouth/aperitif/bitters>",
  "description": null
}

Map Product Type to spirit_type:
  Gin → gin
  Bourbon / Whisky / Whiskey / Single Malt → whisky
  Vodka → vodka
  Calvados → calvados
  Armagnac → armagnac
  Cognac → cognac
  Brandy → brandy
  Tequila / Mezcal → tequila
  Rum → rum
  Liqueur → liqueur

Skip pages that are pure cover/TOC. Return ONLY JSON: {"items": [...]}.`

// ─── Helpers ────────────────────────────────────────────────────────────────

async function callWithPdf(prompt: string, pdfBase64: string): Promise<string> {
  const doc = { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: pdfBase64 } }
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 16384,
    messages: [{ role: 'user', content: [doc as unknown as Anthropic.TextBlockParam, { type: 'text', text: prompt }] }],
  })
  return res.content[0].type === 'text' ? res.content[0].text : ''
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

async function extractPdfPages(buf: Buffer, from: number, to: number): Promise<Buffer> {
  const src = await PDFDocument.load(buf, { ignoreEncryption: true })
  const out = await PDFDocument.create()
  const indices: number[] = []
  for (let i = from - 1; i < to; i++) indices.push(i)
  const pages = await out.copyPages(src, indices)
  pages.forEach(p => out.addPage(p))
  return Buffer.from(await out.save())
}

function dedup(items: ExtractedItem[]): ExtractedItem[] {
  const seen = new Set<string>()
  return items.filter(it => {
    const key = `${(it.name || '').toLowerCase().trim()}|${it.year ?? ''}|${it.volume ?? ''}|${it.price ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function writeTemp(buf: Buffer): Promise<string> {
  const path = join(tmpdir(), `universal_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`)
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
