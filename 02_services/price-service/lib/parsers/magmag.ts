// MagmaG / G4 Food and Beverage parser.
//
// Two PDF formats from this supplier:
//   1. Promo: small (2 pages, ~11 items), tabular FileMaker output. We send
//      the entire PDF to Claude with a promo-specific prompt; the legend
//      (R=red, W=white, Spk=sparkling, ...) makes wine_type/spirit_type
//      extraction unambiguous.
//   2. Full catalog: 184 pages, magazine layout with one wine block per
//      column (Title / Grapes: / Aging: / Tasting Note: / Alcohol : / THB :).
//      We pre-parse the table-of-contents page for page→country mapping,
//      then send the PDF to Claude in 2-page chunks with that country as
//      a hint and a catalog-specific prompt.
//
// Both paths reuse our pipeline's `callWithPdf` helper from claude.ts.

import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PDFDocument } from 'pdf-lib'
import Anthropic from '@anthropic-ai/sdk'
import type { ExtractedItem, ExtractionResult } from '../claude'

const exec = promisify(execFile)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SUPPLIER_NAME = 'MagmaG Food and Beverage'

// ─── Detection ─────────────────────────────────────────────────────────────

export async function isMagMag(buf: Buffer, filename: string): Promise<boolean> {
  const fn = filename.toLowerCase()
  if (/magmag|mag\s*mag|gfour|g4\s*mag|g4\s+(mag|promo)/i.test(fn)) return true

  // Fallback: peek at first page text
  const path = await writeTemp(buf)
  try {
    const text = await pdftotextLayout(path, 1, 1)
    return /MagmaG\s+Food\s+and\s+Beverage|G4\s+(Food|Beverage)/i.test(text)
  } catch {
    return false
  } finally {
    safeUnlink(path)
  }
}

export async function parseMagMag(buf: Buffer, filename: string): Promise<ExtractionResult> {
  const totalPages = await getPageCount(buf)
  const isPromo = totalPages <= 5 || /promo/i.test(filename)

  if (isPromo) {
    console.log(`[magmag] promo path (${totalPages} pages)`)
    return parsePromo(buf)
  }

  console.log(`[magmag] catalog path (${totalPages} pages)`)
  return parseCatalog(buf, totalPages)
}

// ─── Promo: single Claude call ─────────────────────────────────────────────

const PROMO_PROMPT = `This is the MagmaG / G4 wine & spirits PROMO price list (FileMaker quotation form).

Each row has these fields, in order:
  item, Code, Description, Region, Year, item Size, Sp. (type marker), Vol. (alc%), Score, Special Price, notes, Label

The "Sp." column is a single-letter type code. Map it as follows:
  R   → wine, wine_type=red
  W   → wine, wine_type=white
  Ro  → wine, wine_type=rose
  Or  → wine, wine_type=orange
  Spk → wine, wine_type=sparkling
  Swr → wine, wine_type=red, description includes "sweet"
  Sww → wine, wine_type=white, description includes "sweet"
  Fw  → wine, wine_type=null, description includes "fortified"
  Gp  → spirits, spirit_type=grappa
  Spt → spirits, spirit_type=other (or guess from name)
  Br  → beer
  Mix, Ac → other

Extract every numbered item. For each, return:
{
  "name": "<full wine/spirit name from Description>",
  "supplier_sku": "<Code field, e.g. US622>",
  "country": "<from Region, e.g. U.S.A. or Italy>",
  "region": "<rest of Region after country, e.g. CALIFORNIA>",
  "year": <year as integer or null if NV>,
  "volume": "<Size in ml/L, e.g. 750ml or 0.75L>",
  "price": <Special Price as integer>,
  "category": "wine"|"spirits"|"beer"|"other",
  "wine_type": "red"|"white"|"rose"|"orange"|"sparkling"|null,
  "spirit_type": "<canonical from list>"|null,
  "grape_variety": "<grape varieties, e.g. 'Carmenere 100%'>",
  "description": "<combined notes (CONVENTIONAL/ORGANIC/SUSTAINABLE) + score if any>"
}

Return ONLY JSON: {"items": [...]}. No markdown, no explanation.`

async function parsePromo(buf: Buffer): Promise<ExtractionResult> {
  const base64 = buf.toString('base64')
  const raw = await callWithPdf(PROMO_PROMPT, base64)
  const parsed = parseJson<{ items: ExtractedItem[] }>(raw)
  const items = parsed?.items ?? []
  console.log(`[magmag] promo extracted ${items.length} items`)
  return {
    supplier_name: SUPPLIER_NAME,
    price_list_date: null,
    currency: 'THB',
    items: dedupBySku(items),
  }
}

// ─── Catalog: 2-page chunks with country hint ──────────────────────────────

type PageCountryMap = Map<number, string>

const CATALOG_PROMPT_TPL = (countryHint: string) => `This is the MagmaG / G4 wine & spirits CATALOG (magazine layout, ${countryHint ? `pages from ${countryHint}` : 'mixed countries'}).

Each wine block has this structure:
  TITLE - YEAR (e.g. "FINCA FLICHMAN GRAN RESERVA MALBEC - 2022")
  Grapes: <varieties, e.g. "Malbec 100%">
  Aging: <description>
  Tasting Note: <description>
  Alcohol : <X.X%> / <volume, e.g. 75 cl>
  THB : <price>          ← may have multiple THB lines for multi-vintage wines

Some pages are descriptive (winery introductions) and have NO wine blocks — return empty items array for those.

For each "THB :" line, output ONE item. If a wine has multiple THB lines (multi-vintage release), output one item per line and infer the year from context (the title or release order).

Country hint: ${countryHint || 'unknown — infer from winery/region/varieties'}.

Determine wine_type from grape varieties and any explicit hints (Champagne/Crémant/Prosecco → sparkling; "skin contact" / "qvevri" / "ramato" → orange; otherwise red/white/rose by grape).

Return ONLY JSON: {"items": [{
  "name": "<title without trailing year>",
  "country": "<canonical country>",
  "region": "<region/appellation if mentioned>",
  "grape_variety": "<from Grapes: line>",
  "year": <integer or null>,
  "volume": "<from cl, e.g. 750ml>",
  "price": <THB integer>,
  "wine_type": "red"|"white"|"rose"|"orange"|"sparkling"|null,
  "category": "wine"|"spirits"|"beer"|"other",
  "spirit_type": null,
  "description": "<short tasting note OR aging summary, max 200 chars>"
}, ...]}`

async function parseCatalog(buf: Buffer, totalPages: number): Promise<ExtractionResult> {
  // Build page→country map from contents page.
  const pageCountry = await buildPageCountryMap(buf)
  console.log(`[magmag] page→country mappings: ${pageCountry.size}`)

  // Process pages in 2-page chunks, parallel batches of 5 chunks.
  const CHUNK_SIZE = 2
  const PARALLEL = 5
  const allItems: ExtractedItem[] = []
  const startPage = 4 // skip cover, contents (1-3)

  const chunks: { from: number; to: number; country: string }[] = []
  for (let p = startPage; p <= totalPages; p += CHUNK_SIZE) {
    const from = p
    const to = Math.min(p + CHUNK_SIZE - 1, totalPages)
    const country = pageCountry.get(from) || pageCountry.get(to) || ''
    chunks.push({ from, to, country })
  }

  for (let i = 0; i < chunks.length; i += PARALLEL) {
    const batch = chunks.slice(i, i + PARALLEL)
    const results = await Promise.all(
      batch.map(async (c) => {
        try {
          const chunkBuf = await extractPdfPages(buf, c.from, c.to)
          const raw = await callWithPdf(CATALOG_PROMPT_TPL(c.country), chunkBuf.toString('base64'))
          const parsed = parseJson<{ items: ExtractedItem[] }>(raw)
          const items = (parsed?.items ?? []).map(it => ({
            ...it,
            country: it.country || c.country || null,
          }))
          console.log(`[magmag] pages ${c.from}-${c.to} (${c.country || '?'}) → ${items.length} items`)
          return items
        } catch (e) {
          console.error(`[magmag] pages ${c.from}-${c.to} failed:`, e instanceof Error ? e.message : e)
          return []
        }
      })
    )
    results.forEach(items => allItems.push(...items))
  }

  return {
    supplier_name: SUPPLIER_NAME,
    price_list_date: null,
    currency: 'THB',
    items: dedupByNameYear(allItems),
  }
}

// Parse the contents page (page 2) to build a page-number → country map.
async function buildPageCountryMap(buf: Buffer): Promise<PageCountryMap> {
  const path = await writeTemp(buf)
  try {
    const text = await pdftotextLayout(path, 2, 3)
    const m: PageCountryMap = new Map()
    // Lines like:                                           ARGENTINA        PAGE 4-5
    // Country group uses literal space (not \s) to avoid swallowing the
    // previous line's text across newlines.
    const re = /([A-Z][A-Z &]+?)\s+PAGE\s+(\d+)(?:\s*-\s*(\d+))?/g
    let match
    while ((match = re.exec(text)) !== null) {
      const country = normalizeCountryHeading(match[1].trim())
      if (!country) continue
      const from = parseInt(match[2], 10)
      const to = match[3] ? parseInt(match[3], 10) : from
      for (let p = from; p <= to; p++) m.set(p, country)
    }
    return m
  } catch {
    return new Map()
  } finally {
    safeUnlink(path)
  }
}

function normalizeCountryHeading(s: string): string | null {
  const t = s.trim()
  if (!t) return null
  // Skip non-country headings on contents page
  const SKIP = ['NATURAL', 'NO SULFITES ADDED', 'BIODYVIN', 'DEMETER', 'VEGAN', 'SUGAR FREE',
                'AB CERTIFIED', 'GUIDA BIO', 'VIGNOBLES', 'SUSTAINABLE', 'UNESCO', 'SUOLO',
                'VITIVINICOLTURA', 'VIVA LA', 'ISO', 'ITALIA']
  if (SKIP.some(k => t.startsWith(k))) return null
  if (t.length < 3 || t.length > 40) return null
  // Title-case. NEW ZEALAND, SOUTH AFRICA, USA stay as-is or canonicalize.
  if (t === 'USA') return 'USA'
  return t.split(/\s+/).map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')
}

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
  const indices = []
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

function dedupByNameYear(items: ExtractedItem[]): ExtractedItem[] {
  const seen = new Set<string>()
  return items.filter(it => {
    const key = `${(it.name || '').toLowerCase().trim()}|${it.year ?? ''}|${it.price ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function writeTemp(buf: Buffer): Promise<string> {
  const path = join(tmpdir(), `magmag_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`)
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
