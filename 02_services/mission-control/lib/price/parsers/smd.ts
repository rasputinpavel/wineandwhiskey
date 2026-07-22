// SMD (Smiling Dark Horse) — two magazine-grid brochures, one supplier:
//
//   WINE  (SMD_BROCHURE_WINE_JUL26.pdf, 14 pp) — "DARK HORSE POURING" pouring
//          wines. ~4 cards per row band; each card:
//          COUNTRY / PRODUCER (multiline) / appellation / grape composition /
//          YEAR / ABV% / PRICE (e.g. 330, 360, 410 THB).
//   GCC1855 (SMD_BROCHURE_GCC1855.pdf, 11 pp) — Grand Cru Classé 1855 Bordeaux.
//          Cover on p.1. Cards: CHÂTEAU / appellation / YEAR / PRICE (e.g.
//          9,400 → 9400). Section headers like "Second Growth".
//
// pdftotext -layout interleaves the grid columns, so we let Claude read each
// 2-page chunk of the PDF natively (callWithPdf) and reconstruct the cards.
// SKU is absent — items are deduped by (name, year, price).

import type { ExtractedItem, ExtractionResult } from '../claude'
import {
  writeTemp as writeTempShared, safeUnlink, pdftotextLayout,
  getPageCount, extractPdfPages, parseJson, callWithPdf, dedupBy,
} from './_shared'

const writeTemp = (buf: Buffer) => writeTempShared(buf, 'smd')

const SUPPLIER_NAME = 'SMD'

export type Variant = 'wine' | 'gcc1855'
type ProgressCb = (pct: number, phase?: string, itemCount?: number) => Promise<void> | void

const FILENAME_RE = /smd|dark[\s_-]?horse|gcc\s?1855/i
const CONTENT_RE = /SMILING\s+DARK\s+HORSE|DARK\s+HORSE\s+POURING|GRAND\s+CRU\s+CLASS[EÉ]\s+1855/i

// ─── Detection ─────────────────────────────────────────────────────────────

export async function isSMD(buf: Buffer, filename: string): Promise<boolean> {
  if (FILENAME_RE.test(filename)) return true
  const path = await writeTemp(buf)
  try {
    const text = await pdftotextLayout(path, 1, 1)
    return CONTENT_RE.test(text)
  } catch {
    return false
  } finally {
    safeUnlink(path)
  }
}

export function detectVariant(filename: string, firstPageText: string): Variant {
  if (/gcc|1855|grand\s+cru/i.test(filename) || /GRAND\s+CRU\s+CLASS[EÉ]\s+1855/i.test(firstPageText)) {
    return 'gcc1855'
  }
  return 'wine'
}

// ─── Helpers ───────────────────────────────────────────────────────────────

// Prices print as "410" or "9,400"; coerce to a bare integer THB.
export function toIntPrice(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null
  if (typeof v === 'string') {
    const digits = v.replace(/[^\d]/g, '')
    if (!digits) return null
    const n = parseInt(digits, 10)
    return Number.isFinite(n) ? n : null
  }
  return null
}

// ─── Entry point ───────────────────────────────────────────────────────────

export async function parseSMD(
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
  console.log(`[smd] ${variant} brochure (${totalPages} pages)`)
  await onProgress?.(5, `reading ${variant}`)

  const prompt = variant === 'gcc1855' ? GCC_PROMPT : WINE_PROMPT

  // 2 PDF pages per chunk. Cover / section-only pages yield [] via the prompt,
  // so we chunk from page 1 without guessing a start page.
  const chunks: { from: number; to: number }[] = []
  for (let p = 1; p <= totalPages; p += 2) {
    chunks.push({ from: p, to: Math.min(p + 1, totalPages) })
  }

  const PARALLEL = 5
  const all: ExtractedItem[] = []
  let done = 0

  for (let i = 0; i < chunks.length; i += PARALLEL) {
    const batch = chunks.slice(i, i + PARALLEL)
    const results = await Promise.all(
      batch.map(async (c) => {
        try {
          const chunkBuf = await extractPdfPages(buf, c.from, c.to)
          const raw = await callWithPdf(prompt, chunkBuf.toString('base64'))
          const parsed = parseJson<{ items: ExtractedItem[] }>(raw)
          const items = (parsed?.items ?? []).map((it) => ({
            ...it,
            price: toIntPrice(it.price),
            volume: it.volume || '750ml',
            category: 'wine' as const,
          }))
          console.log(`[smd] pages ${c.from}-${c.to} → ${items.length} items`)
          return items
        } catch (e) {
          console.error(`[smd] pages ${c.from}-${c.to} failed:`, e instanceof Error ? e.message : e)
          return [] as ExtractedItem[]
        }
      }),
    )
    results.forEach((items) => all.push(...items))
    done += batch.length
    const pct = 5 + Math.round((done / chunks.length) * 90)
    await onProgress?.(pct, `extracting ${done}/${chunks.length}`, all.length)
  }

  await onProgress?.(95, 'inserting')
  return {
    supplier_name: SUPPLIER_NAME,
    price_list_date: null,
    currency: 'THB',
    items: dedupBy(all, (it) => `${(it.name || '').toLowerCase().trim()}|${it.year ?? ''}|${it.volume ?? ''}|${it.price ?? ''}`),
  }
}

// ─── Prompts ───────────────────────────────────────────────────────────────

const WINE_PROMPT = `This is 1-2 pages of the SMD "DARK HORSE POURING" wine brochure — a
magazine grid of ~4 wine cards per row band. Each card is a vertical stack:

  COUNTRY            (e.g. AUSTRALIA, FRANCE, ITALY, PORTUGAL)
  PRODUCER / WINE    (one or more lines — brand then wine name)
  appellation/type   (e.g. BORDEAUX, CHIANTI DOCG, VIN DE FRANCE, WHITE/RED)
  grape composition  (e.g. "60% MERLOT, 40% CABERNET SAUVIGNON" or "PINOT GRIGIO")
  YEAR               (4-digit vintage, or absent for NV)
  ABV%               (e.g. 13.0%)
  PRICE              (a bare number like 330, 360, 410 — THB per bottle, VAT-exclusive)

For EACH card return ONE item:
{
  "name": "<producer + wine name joined, e.g. 'Grand Louis Bordeaux White'>",
  "country": "<canonical country from the card>",
  "region": "<appellation line, e.g. 'Bordeaux', 'Chianti DOCG', or null>",
  "grape_variety": "<the grape composition line, or null>",
  "year": <vintage integer, or null if NV>,
  "price": <integer THB from the price number>,
  "volume": "<bottle size if the card prints one (e.g. '1,000 ML' -> '1000ml'), else '750ml'>",
  "wine_type": "red"|"white"|"rose"|"orange"|"sparkling"|null,
  "category": "wine",
  "spirit_type": null,
  "description": "<ABV if useful, max 120 chars, or null>"
}

Infer wine_type: sparkling for Spumante/Prosecco/Champagne/"Gran Cuvee"/"Extra Dry";
rose for "Rosé"/"Rosato"; white for white grapes or "WHITE"; red for red grapes or "RED".
Skip cover pages, section dividers, and any page with no price cards.
Most cards are 750ml and print no size; only emit a different volume when a size like "1,000 ML" is printed on the card. A "100%" inside a grape composition is NOT a price or a volume.
Return ONLY JSON: {"items": [...]}.`

const GCC_PROMPT = `This is 1-2 pages of the SMD "Grand Cru Classé 1855" fine-Bordeaux brochure —
a magazine grid of cards. Some pages are cover or section dividers (e.g.
"SECOND GROWTH / DEUXIÈME GRAND CRU CLASSÉ") with no prices — skip those.

Each priced card is a vertical stack:

  CHÂTEAU <name>      (may span multiple lines)
  appellation         (e.g. ST.JULIEN, PAUILLAC, MARGAUX, ST.ESTÈPHE)
  YEAR                (4-digit vintage)
  PRICE               (a number like 9,400 or 5,500 — THB per bottle, VAT-exclusive)

For EACH priced card return ONE item:
{
  "name": "<full château name, e.g. 'Château Ducru-Beaucaillou'>",
  "country": "France",
  "region": "<appellation, e.g. 'Saint-Julien', 'Pauillac', 'Margaux', 'Saint-Estèphe'>",
  "grape_variety": null,
  "year": <vintage integer>,
  "price": <integer THB, thousands separators removed (9,400 -> 9400)>,
  "volume": "750ml",
  "wine_type": "red",
  "category": "wine",
  "spirit_type": null,
  "description": "<growth classification if shown on the page, e.g. 'Second Growth', else null>"
}

Nearly all are red; use "white" only if the card clearly says a white wine.
A single card may list MULTIPLE vintage/price pairs (e.g. "2022 / 4,200" and "2015 / 4,500"). Emit ONE item per pair, matching each year to the price printed on its own line.
Return ONLY JSON: {"items": [...]}.`
