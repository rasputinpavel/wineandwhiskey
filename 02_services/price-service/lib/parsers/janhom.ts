// Janhom Classic Limited Partnership — magazine-style 46-page PDF.
//
//   Pages 1-2:    cover + TOC
//   Catalog 1-34: wine cards (3 per row), grouped by producer block, each
//                 with: name + vintage / Region / Grape Variety / Alc. /
//                 Tasting Notes / "560.-" price / optional rating like 4.0
//   Catalog 35-39: spirits in a tabular DESCRIPTION/UNIT/ALC/Price layout
//   Catalog 40-41: beer in same tabular layout
//   Catalog 42-44: POSM (point-of-sale materials, skipped)
//
// PDF page = catalog page + 2.
//
// SKU is absent — items are deduped by (name, year, price).

import type { ExtractedItem, ExtractionResult } from '../claude'
import {
  writeTemp as writeTempShared, safeUnlink, pdftotextLayout,
  getPageCount, extractPdfPages, parseJson, callWithPdf, dedupBy,
} from './_shared'

const writeTemp = (buf: Buffer) => writeTempShared(buf, 'janhom')

const SUPPLIER_NAME = 'Janhom Classic Limited Partnership'

// PDF pages 1-2 are the cover + TOC. Catalog page N → PDF page N + 2.
const PDF_OFFSET = 2

type Variant = 'wine' | 'spirits' | 'beer'
type ProgressCb = (pct: number, phase?: string, itemCount?: number) => Promise<void> | void

// ─── Detection ─────────────────────────────────────────────────────────────

export async function isJanhom(buf: Buffer, filename: string): Promise<boolean> {
  if (/janhom/i.test(filename)) return true
  const path = await writeTemp(buf)
  try {
    const text = await pdftotextLayout(path, 1, 1)
    return /JANHOM\s+CLASSIC\s+LIMITED\s+PARTNERSHIP/i.test(text)
        || /phukettopwine/i.test(text)
  } catch {
    return false
  } finally {
    safeUnlink(path)
  }
}

// ─── Entry point ───────────────────────────────────────────────────────────

export async function parseJanhom(
  buf: Buffer,
  _filename: string,
  onProgress?: ProgressCb,
): Promise<ExtractionResult> {
  const totalPdfPages = await getPageCount(buf)
  await onProgress?.(5, 'reading TOC')

  // Parse TOC for catalog-page → country and section ranges.
  const toc = await parseToc(buf)
  console.log(`[janhom] TOC ranges: wines=${toc.wineRanges.length}, spirits=${toc.spiritsRange?.from}-${toc.spiritsRange?.to}, beer=${toc.beerRange?.from}-${toc.beerRange?.to}`)

  // Build chunk plan. We process 2 catalog pages at a time. Each chunk knows
  // its variant (wine / spirits / beer) so we pick the right prompt, plus a
  // country hint for wine chunks.
  const chunks: { from: number; to: number; variant: Variant; country: string }[] = []
  const lastCatalogPage = totalPdfPages - PDF_OFFSET // POSM ends here
  const wineEnd = toc.spiritsRange ? toc.spiritsRange.from - 1 : 34
  const spiritsEnd = toc.beerRange ? toc.beerRange.from - 1 : (toc.spiritsRange?.to ?? 39)
  const beerEnd = toc.beerRange?.to ?? 41
  const skipFromCatalog = toc.posmRange?.from ?? Math.max(beerEnd + 1, 42)

  for (let p = 1; p <= lastCatalogPage; p += 2) {
    const from = p
    const to = Math.min(p + 1, lastCatalogPage)
    if (from >= skipFromCatalog) break
    const variant: Variant = from <= wineEnd ? 'wine'
      : from <= spiritsEnd ? 'spirits'
      : from <= beerEnd ? 'beer'
      : 'wine' // fallback — shouldn't hit
    const country = variant === 'wine' ? (toc.pageCountry.get(from) || toc.pageCountry.get(to) || '') : ''
    chunks.push({ from, to, variant, country })
  }

  console.log(`[janhom] ${chunks.length} chunks queued`)
  await onProgress?.(10, 'extracting')

  const PARALLEL = 5
  const allItems: ExtractedItem[] = []
  let chunksDone = 0

  for (let i = 0; i < chunks.length; i += PARALLEL) {
    const batch = chunks.slice(i, i + PARALLEL)
    const results = await Promise.all(
      batch.map(async (c) => {
        try {
          const pdfFrom = c.from + PDF_OFFSET
          const pdfTo = c.to + PDF_OFFSET
          const chunkBuf = await extractPdfPages(buf, pdfFrom, pdfTo)
          const prompt = promptFor(c.variant, c.country)
          const raw = await callWithPdf(prompt, chunkBuf.toString('base64'))
          const parsed = parseJson<{ items: ExtractedItem[] }>(raw)
          const items = (parsed?.items ?? []).map(it => ({
            ...it,
            country: it.country || c.country || null,
          }))
          console.log(`[janhom] ${c.variant} catalog ${c.from}-${c.to} (${c.country || '?'}) → ${items.length} items`)
          return items
        } catch (e) {
          console.error(`[janhom] catalog ${c.from}-${c.to} failed:`, e instanceof Error ? e.message : e)
          return []
        }
      })
    )
    results.forEach(items => allItems.push(...items))
    chunksDone += batch.length
    const pct = 10 + Math.round((chunksDone / chunks.length) * 80)
    await onProgress?.(pct, `extracting ${chunksDone}/${chunks.length}`, allItems.length)
  }

  await onProgress?.(95, 'inserting')
  return {
    supplier_name: SUPPLIER_NAME,
    price_list_date: null,
    currency: 'THB',
    items: dedupBy(allItems, it => `${(it.name || '').toLowerCase().trim()}|${it.year ?? ''}|${it.price ?? ''}`),
  }
}

// ─── TOC parsing ────────────────────────────────────────────────────────────

type Toc = {
  pageCountry: Map<number, string>
  wineRanges: { country: string; from: number; to: number }[]
  spiritsRange: { from: number; to: number } | null
  beerRange: { from: number; to: number } | null
  posmRange: { from: number; to: number } | null
}

const COUNTRY_TOKENS = new Set([
  'Italy', 'Austria', 'German', 'Germany', 'Swiss', 'Switzerland', 'France',
  'Spain', 'South Africa', 'Chile', 'Argentina', 'Australia', 'Portugal', 'USA',
  'New Zealand',
])

const COUNTRY_NORM: Record<string, string> = {
  'German': 'Germany', 'Swiss': 'Switzerland',
}

async function parseToc(buf: Buffer): Promise<Toc> {
  const path = await writeTemp(buf)
  try {
    const text = await pdftotextLayout(path, 2, 2)
    const lines = text.split('\n').map(l => l.replace(/\s+$/, ''))
    const result: Toc = {
      pageCountry: new Map(),
      wineRanges: [],
      spiritsRange: null,
      beerRange: null,
      posmRange: null,
    }

    // Walk lines tracking which country block we're in. The TOC is in two
    // physical columns side-by-side, but pdftotext -layout interleaves them
    // into a single line per row. We parse by first finding country headers
    // and then attaching the next bullet rows to that country.
    let currentCountry: string | null = null
    let currentCountryRangeStart: number | null = null
    let currentCountryRangeEnd: number | null = null
    const flushCountry = () => {
      if (currentCountry && currentCountryRangeStart != null && currentCountryRangeEnd != null) {
        result.wineRanges.push({
          country: COUNTRY_NORM[currentCountry] ?? currentCountry,
          from: currentCountryRangeStart,
          to: currentCountryRangeEnd,
        })
      }
      currentCountry = null
      currentCountryRangeStart = null
      currentCountryRangeEnd = null
    }

    for (const raw of lines) {
      const line = raw.trim()
      if (!line) continue
      // Section markers (Spirits / Beer / POSM) — at the right column with a page range.
      const secM = line.match(/(Spirits|Beer|POSM)\s+(\d+)(?:\s*-\s*(\d+))?$/i)
      if (secM) {
        const sec = secM[1].toLowerCase()
        const from = parseInt(secM[2], 10)
        const to = secM[3] ? parseInt(secM[3], 10) : from
        if (sec === 'spirits') result.spiritsRange = { from, to }
        else if (sec === 'beer') result.beerRange = { from, to }
        else if (sec === 'posm') result.posmRange = { from, to }
      }

      // Bullet rows: "    ●  Producer Name    pageRange"
      const rowM = line.match(/●\s+(.+?)\s+(\d+)(?:\s*-\s*(\d+))?(?:\s|$)/g)
      if (rowM) {
        for (const r of rowM) {
          const m = r.match(/●\s+(.+?)\s+(\d+)(?:\s*-\s*(\d+))?$/)
          if (!m) continue
          const from = parseInt(m[2], 10)
          const to = m[3] ? parseInt(m[3], 10) : from
          // Map the page → country if we have current country context.
          // (We assume left/right columns map to most-recent country header
          // on either side; the simpler rule of "last seen" is good enough
          // because TOC headers list countries top-down with no cross-talk.)
          const country = currentCountry ?? null
          if (country) {
            for (let p = from; p <= to; p++) result.pageCountry.set(p, COUNTRY_NORM[country] ?? country)
            if (currentCountryRangeStart === null) currentCountryRangeStart = from
            currentCountryRangeEnd = Math.max(currentCountryRangeEnd ?? from, to)
          }
        }
        continue
      }

      // Country header: a line that contains a known country name as a
      // standalone token (not in a bullet row).
      const tokens = line.split(/\s{2,}/).map(t => t.trim()).filter(Boolean)
      for (const t of tokens) {
        if (COUNTRY_TOKENS.has(t)) {
          flushCountry()
          currentCountry = t
        }
      }
    }
    flushCountry()
    return result
  } finally {
    safeUnlink(path)
  }
}

// ─── Prompts ────────────────────────────────────────────────────────────────

function promptFor(variant: Variant, country: string): string {
  if (variant === 'wine') return WINE_PROMPT(country)
  if (variant === 'spirits') return SPIRITS_PROMPT
  return BEER_PROMPT
}

const WINE_PROMPT = (countryHint: string) => `This is the Janhom wine catalog (${countryHint || 'mixed'}, magazine layout).

Each producer block has a winery sub-header (e.g. "Cantine Lenotti"), an
"Winery Rating X.X" near the right margin, sometimes a description
paragraph, and 3 wine cards per row. Each card looks like:

  Wine Name (sometimes with quotes/IGT/DOC) - Vintage YYYY
  Region :Veneto
  Grape Variety: <varieties>
  Alc.: 12.5%
  Tasting Notes : <text>
  560.-                <- price line, sometimes with rating "4.0" near it

Country hint: ${countryHint || 'infer from winery'}.

For EACH wine card return ONE item:
{
  "name": "<full wine name including vintage if present in title; prepend winery if name is short, e.g. 'Quintarelli Bianco Secco' for the Quintarelli block>",
  "winery": "<producer block name>",
  "country": "<canonical country>",
  "region": "<value of 'Region :' line>",
  "grape_variety": "<from 'Grape Variety:'>",
  "year": <vintage integer or null if NV>,
  "price": <number from "N.-" line, e.g. 560>,
  "volume": "750ml",
  "wine_type": "red"|"white"|"rose"|"orange"|"sparkling"|null,
  "category": "wine",
  "spirit_type": null,
  "description": "<short tasting note, max 200 chars>"
}

Determine wine_type from grape varieties + name hints (Champagne/Spumante/Prosecco → sparkling, "Rose"/"Chiaretto" → rose, skin-contact/orange → orange, white grape → white, red grape → red).

Skip pages that are pure descriptive content (winery profiles with no price card). Return ONLY JSON: {"items": [...]}.`

const SPIRITS_PROMPT = `This is the Janhom spirits catalog (tabular).

Each block has a producer header, a description paragraph, then a table:
  DESCRIPTION                       UNIT/INFO                        ALC Volume        Price/Bottle
  Escape 7 London Dry Gin           0.7L / 6 Bottles / box           40.0%             990 THB
  Feel! Munich Dry Gin              0.5L / 6 Bottles / box           45.0%             1,740 THB

For each row return ONE item:
{
  "name": "<full DESCRIPTION value, prepend producer if not present>",
  "winery": "<producer block name (if any)>",
  "country": "<infer from producer or null>",
  "region": null,
  "grape_variety": null,
  "year": null,
  "price": <integer THB>,
  "volume": "<from UNIT/INFO, normalized like '700ml' or '500ml'>",
  "wine_type": null,
  "category": "spirits",
  "spirit_type": "<canonical: whisky/vodka/gin/rum/tequila/brandy/cognac/grappa/liqueur/shochu/sake/vermouth/aperitif/bitters/amaro>",
  "description": "<short tasting note, max 150 chars>"
}

Skip pure descriptive pages with no table rows. Return ONLY JSON: {"items": [...]}.`

const BEER_PROMPT = `This is the Janhom beer catalog (tabular).

Format mirrors spirits: DESCRIPTION / UNIT/INFO / ALC Volume / Price/Bottle.

For each row return ONE item:
{
  "name": "<DESCRIPTION>",
  "winery": "<brewery name (if shown)>",
  "country": "<infer or null>",
  "region": null,
  "grape_variety": null,
  "year": null,
  "price": <integer THB>,
  "volume": "<normalized e.g. '330ml' or '500ml'>",
  "wine_type": null,
  "category": "beer",
  "spirit_type": null,
  "description": "<short note>"
}

Return ONLY JSON: {"items": [...]}.`

