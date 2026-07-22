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
