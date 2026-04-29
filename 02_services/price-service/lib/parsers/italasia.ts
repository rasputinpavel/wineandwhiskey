// Italasia Group Thailand — three catalog formats from one supplier:
//
//   1. Wine Catalog (185 pages, Adobe InDesign)
//        Magazine layout, 4–5 wines per page. Each block has:
//        NAME (CAPS) / RED|WHITE|ROSE|SPARKLING / VINTAGE YYYY / ABV X% /
//        Grape / Code WXX-NNNL / N THB.
//        Sections by country: ITALY, FRANCE, SPAIN, PORTUGAL, GERMANY,
//        USA, ARGENTINA, CHILE, NEW ZEALAND, ...
//
//   2. Exclusive Wines (26 pages, Adobe InDesign)
//        3-column grid, 4–6 wines per page. Each cell:
//        SKU at top (WXX-NNNW-YYYY), name (multi-line), AOC, critics
//        scores, Stock N, N THB. Sections like BURGUNDY, BORDEAUX.
//
//   3. Spirits Catalog (115 pages, PowerPoint)
//        Magazine layout, 1–3 spirits per page. Each block:
//        BRAND + variant + N Baht + tasting note + SKU (SXX-NNN) +
//        700 ml + X% alc. Sections WHISKY/RUM/BRANDY/COGNAC/VODKA/...
//        crossed with country (SCOTLAND/JAPAN/SPAIN/...).
//
// All three share supplier_name "Italasia Group Thailand" and SKU format
// (W… for wine, S… for spirits) so we dedupe across uploads cleanly.

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

const SUPPLIER_NAME = 'Italasia Group Thailand'

type Variant = 'wine' | 'exclusive' | 'spirits'
type ProgressCb = (pct: number, phase?: string, itemCount?: number) => Promise<void> | void

// ─── Detection ─────────────────────────────────────────────────────────────

export async function isItalasia(buf: Buffer, filename: string): Promise<boolean> {
  const fn = filename.toLowerCase()
  if (/italasia|italasia[\s_-]?group/i.test(fn)) return true
  // The 3 known catalog filenames don't always contain "italasia"
  // (e.g. "2026 Spirits Catalog.pdf"). Scan first 3 pages: the brand mark
  // appears either in the cover footer (Wine Catalog) or in the table of
  // contents (Spirits Catalog has "CAMUS (SINGLE CASK ITALASIA 60th)").
  if (/(wine|spirits|exclusive)\s+catalog/i.test(fn) || /exclusive\s+wine/i.test(fn)) {
    const path = await writeTemp(buf)
    try {
      const text = await pdftotextLayout(path, 1, Math.min(3, await getPageCount(buf)))
      return /\bItalasia\b/i.test(text)
    } catch {
      return false
    } finally {
      safeUnlink(path)
    }
  }
  return false
}

function detectVariant(filename: string, firstPage: string): Variant {
  const fn = filename.toLowerCase()
  if (/exclusive/i.test(fn) || /EXCLUSIVE\s+WINE/i.test(firstPage)) return 'exclusive'
  if (/spirits/i.test(fn) || /SPIRITS\s+CATALOG/i.test(firstPage)) return 'spirits'
  return 'wine'
}

// ─── Entry point ───────────────────────────────────────────────────────────

export async function parseItalasia(
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
  console.log(`[italasia] ${variant} catalog (${totalPages} pages)`)
  await onProgress?.(5, `reading ${variant} catalog`)

  // All three follow the same per-2-page Claude pattern; only the prompt and
  // start-page differ.
  const startPage = variant === 'exclusive' ? 3 : variant === 'spirits' ? 4 : 3
  const items = await runChunked(buf, totalPages, startPage, variant, onProgress)

  await onProgress?.(95, 'inserting')
  return {
    supplier_name: SUPPLIER_NAME,
    price_list_date: parseDate(firstPage),
    currency: 'THB',
    items: dedupBySku(items),
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
          const prompt = promptFor(variant)
          const raw = await callWithPdf(prompt, chunkBuf.toString('base64'))
          const parsed = parseJson<{ items: ExtractedItem[] }>(raw)
          const items = parsed?.items ?? []
          console.log(`[italasia] ${variant} pages ${c.from}-${c.to} → ${items.length} items`)
          return items
        } catch (e) {
          console.error(`[italasia] ${variant} pages ${c.from}-${c.to} failed:`, e instanceof Error ? e.message : e)
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
  if (variant === 'wine') return WINE_PROMPT
  if (variant === 'exclusive') return EXCLUSIVE_PROMPT
  return SPIRITS_PROMPT
}

const WINE_PROMPT = `This is the Italasia WINE catalog (magazine layout, 4-5 wines per page).

Each wine block looks like:
  WINERY - REGION              ← section header (e.g. "DAMILANO - PIEMONTE")
  WINE NAME (CAPS)
                          RED|WHITE|ROSE|SPARKLING|DESSERT|FORTIFIED
                          VINTAGE 2020   (or "NV")
                          ABV 14.5%
  Grape variety            Code WDN-004R
                          1,945 THB

Section may also be a country header: ITALY / FRANCE / SPAIN / PORTUGAL /
GERMANY / USA / ARGENTINA / CHILE / NEW ZEALAND / SOUTH AFRICA / AUSTRALIA.

For each wine block return ONE item:
{
  "name": "<WINE NAME from CAPS title>",
  "supplier_sku": "<Code value, e.g. 'WDN-004R'>",
  "country": "<country from current country section>",
  "region": "<region from winery sub-header (e.g. 'PIEMONTE')>",
  "winery": "<winery part from sub-header (e.g. 'DAMILANO')>",
  "year": <vintage integer or null if NV>,
  "grape_variety": "<grape>",
  "price": <number from 'N THB'>,
  "volume": "750ml",
  "wine_type": "red"|"white"|"rose"|"orange"|"sparkling"|null,
  "category": "wine",
  "spirit_type": null,
  "description": "<ABV note if present, max 100 chars>"
}

Skip pages that are pure descriptive content (winery profiles, photos) with no Code/THB lines. Return ONLY JSON: {"items": [...]}.`

const EXCLUSIVE_PROMPT = `This is the Italasia EXCLUSIVE WINES catalog (3-column grid, 4-6 wines per page).

Each grid cell looks like:
  WJF-006W-2023               ← supplier_sku at top (W=wine, JF=Faiveley, 006=code, W=white, 2023=vintage)
  Corton-Charlemagne           ← multi-line wine name
  Grand cru Domaine
  Faiveley Blanc 2023
  AOC                          ← AOC marker (optional)

  James Suckling 98            ← critics scores (optional, may be empty)
  Robert Parker 94–96
  Wine Enthusiast
  Wine Spectator 95
  Vinous 91–93
  Inside Burgundy 93–96

  Stock 12                      ← stock count
  13,500 THB                    ← price

Country/region from section CAPS header (e.g. BURGUNDY → France/Burgundy,
BORDEAUX → France/Bordeaux, RHÔNE → France/Rhône, etc.).

The SKU encodes wine_type: 'W' = white, 'R' = red, 'RO' = rose, 'SP' = sparkling.
The trailing year in the SKU is the vintage.

For each cell return ONE item:
{
  "name": "<full wine name joined from multi-line, e.g. 'Corton-Charlemagne Grand Cru Domaine Faiveley Blanc 2023'>",
  "supplier_sku": "<full SKU including vintage, e.g. 'WJF-006W-2023'>",
  "country": "<inferred from section header (BURGUNDY/BORDEAUX/RHÔNE/CHAMPAGNE → France; TUSCANY/PIEMONTE → Italy; ...)>",
  "region": "<region from section header>",
  "winery": "<estate name extracted from name (e.g. 'Domaine Faiveley')>",
  "year": <integer vintage from SKU suffix, e.g. 2023>,
  "grape_variety": null,
  "price": <number from 'N THB'>,
  "volume": "750ml",
  "wine_type": "red"|"white"|"rose"|"orange"|"sparkling"|null,
  "category": "wine",
  "spirit_type": null,
  "description": "<top critic score if present, e.g. 'JS 98 / RP 94-96 / WS 95'>"
}

Return ONLY JSON: {"items": [...]}.`

const SPIRITS_PROMPT = `This is the Italasia SPIRITS catalog (magazine layout, 1-3 spirits per page).

Each spirit block looks like:
  BRAND NAME (CAPS)            ← e.g. "GLENFIDDICH 12 YEARS OLD"
  N Baht                        ← price
  Description: nose / taste / finish
  SKU                           ← e.g. "SGF-001"
  700 ml      40% alc.          ← volume + ABV

Sections crossed: TYPE × COUNTRY (e.g. "WHISKY > SCOTLAND > GLENFIDDICH",
"RUM > SAILOR JERRY", "BRANDY > VECCHIA ROMAGNA", "COGNAC > GODET",
"LIQUEURS & FLAVOURED > MIDORI", "VODKA", "GIN", "TEQUILA").

Map type/section into spirit_type:
  WHISKY/SINGLE MALT/BLENDED MALT/BLENDED WHISKY/SINGLE GRAIN → 'whisky'
  RUM → 'rum'
  BRANDY → 'brandy'
  COGNAC → 'cognac'
  LIQUEURS & FLAVOURED → 'liqueur'
  AMARO → 'amaro'
  VODKA → 'vodka'
  GIN → 'gin'
  TEQUILA → 'tequila'
  GRAPPA → 'grappa'
  VERMOUTH → 'vermouth'
  SAKE → 'sake'

Country from sub-section: SCOTLAND/JAPAN/SPAIN/FRANCE/ITALY/...

For each spirit block return ONE item:
{
  "name": "<full BRAND + variant joined, e.g. 'Glenfiddich 12 Years Old'>",
  "supplier_sku": "<SKU, e.g. 'SGF-001'>",
  "country": "<from sub-section>",
  "region": null,
  "winery": null,
  "year": null,
  "grape_variety": null,
  "price": <number from 'N Baht'>,
  "volume": "<from 'N ml', e.g. '700ml'>",
  "wine_type": null,
  "category": "spirits",
  "spirit_type": "<canonical from list above>",
  "description": "<short tasting note, max 200 chars>"
}

Skip pure descriptive pages (cocktail recipes, brand stories) with no SKU/Baht lines. Return ONLY JSON: {"items": [...]}.`

// ─── Helpers ────────────────────────────────────────────────────────────────

async function callWithPdf(prompt: string, pdfBase64: string): Promise<string> {
  const doc = { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: pdfBase64 } }
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
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

function dedupBySku(items: ExtractedItem[]): ExtractedItem[] {
  const seen = new Set<string>()
  return items.filter(it => {
    const key = (it.supplier_sku ?? `${it.name}|${it.year ?? ''}`).toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function parseDate(text: string): string | null {
  // "April 2026", "February 2026" — keep as null if no day, but normalise to first of month.
  const m = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i)
  if (!m) return null
  const months: Record<string, string> = {
    january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',
    july:'07',august:'08',september:'09',october:'10',november:'11',december:'12',
  }
  const mo = months[m[1].toLowerCase()]
  return mo ? `${m[2]}-${mo}-01` : null
}

async function writeTemp(buf: Buffer): Promise<string> {
  const path = join(tmpdir(), `italasia_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`)
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
