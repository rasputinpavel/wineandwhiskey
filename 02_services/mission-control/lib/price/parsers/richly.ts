// Richly Phuket (บริษัท ริชลี่ ภูเก็ต) — spirits wholesaler in Phuket.
// Price list is an Excel-generated PDF with a single 6-column table that
// repeats on every page. Trivial layout → deterministic parsing on the
// pdftotext output is more than enough; no LLM needed.
//
// Columns:
//   ประเภทสินค้า    section header (Whisky / Vodka / Gin / Liqueurs /
//                  Tequila / Rum / RTD Spirits / Single Malt / Other - MH)
//   สินค้า          product name (free text)
//   ขนาด CL        bottle size in centilitres (70 → 700ml, 75 → 750ml, 37.5 → 375ml…)
//   ขนาด บรรจุ/ลัง  bottles per case
//   ราคา / ขวด ก่อน VAT  per-bottle price excl. VAT — what we store as `price`
//   VAT 7 %        VAT amount (ignored)
//   ราคา / ขวด รวม VAT   per-bottle price incl. VAT
//
// Out-of-stock rows print "N/A" in the three price columns → price=null.
// "Special Releases Set Collection (N SKUs)" rows are bundle headers — N
// follow-up product rows have a price but no case count. We emit the
// individual items and skip the bundle header.

import type { ExtractedItem, ExtractionResult } from '../claude'
import { writeTemp as writeTempShared, safeUnlink, pdftotextLayout } from './_shared'

const writeTemp = (buf: Buffer) => writeTempShared(buf, 'richly')

const SUPPLIER_NAME = 'Richly Phuket'

type ProgressCb = (pct: number, phase?: string, itemCount?: number) => Promise<void> | void

// ─── Detection ─────────────────────────────────────────────────────────────

export async function isRichly(buf: Buffer, filename: string): Promise<boolean> {
  if (/richly|ริชลี/i.test(filename)) return true
  const path = await writeTemp(buf)
  try {
    const text = await pdftotextLayout(path, 1, 1)
    return /ริชลี่\s*ภูเก็ต|Richlyphuket|richlyphuket/i.test(text)
  } catch {
    return false
  } finally {
    safeUnlink(path)
  }
}

// ─── Section → category/spirit_type mapping ────────────────────────────────

type Section = {
  name: string
  category: ExtractedItem['category']
  spiritType: string | null
  defaultCountry: string | null
  defaultWineType?: ExtractedItem['wine_type']
}

const SECTIONS: Record<string, Section> = {
  whisky:        { name: 'Whisky',        category: 'spirits', spiritType: 'whisky',  defaultCountry: 'Scotland' },
  'single malt': { name: 'Single Malt',   category: 'spirits', spiritType: 'whisky',  defaultCountry: 'Scotland' },
  vodka:         { name: 'Vodka',         category: 'spirits', spiritType: 'vodka',   defaultCountry: null },
  gin:           { name: 'Gin',           category: 'spirits', spiritType: 'gin',     defaultCountry: null },
  liqueurs:      { name: 'Liqueurs',      category: 'spirits', spiritType: 'liqueur', defaultCountry: null },
  liqueur:       { name: 'Liqueurs',      category: 'spirits', spiritType: 'liqueur', defaultCountry: null },
  tequila:       { name: 'Tequila',       category: 'spirits', spiritType: 'tequila', defaultCountry: 'Mexico' },
  rum:           { name: 'Rum',           category: 'spirits', spiritType: 'rum',     defaultCountry: null },
  'rtd spirits': { name: 'RTD Spirits',   category: 'other',   spiritType: null,      defaultCountry: null },
  'other - mh':  { name: 'Other - MH',    category: 'spirits', spiritType: null,      defaultCountry: 'France' },
}

// Brand-derived overrides: when the section default is wrong for a
// specific brand, this picks the right spirit_type/country/category.
const BRAND_OVERRIDES: Array<{ re: RegExp; patch: Partial<ExtractedItem> }> = [
  { re: /\bMoet\b/i,                          patch: { category: 'wine', spirit_type: null, wine_type: 'sparkling', country: 'France' } },
  { re: /\bHennessy\b/i,                      patch: { category: 'spirits', spirit_type: 'cognac', country: 'France' } },
  { re: /\bBulleit\b/i,                       patch: { country: 'USA' } },
  { re: /\bJ&B\b/i,                           patch: { country: 'Scotland' } },
  { re: /\b(JW|Johnnie\s*Walker|Walker\s*&\s*Sons)\b/i, patch: { country: 'Scotland' } },
  { re: /\b(Cardhu|Cragganmore|Dalwhinnie|Glenkinchie|Lagavulin|Mortlach|Oban|Talisker|Singleton|Royal\s*Lochnagar|Caol\s*Ila|Roseisle|Clynelish|Glendullan|Glenkinchi|Dailuaine|Teaninich|Pittyvaich|Glen\s*Ord)\b/i, patch: { country: 'Scotland' } },
  { re: /\bCaptain\s*Morgan\b/i,              patch: { country: 'Jamaica' } },
  { re: /\bPampero\b/i,                       patch: { country: 'Venezuela' } },
  { re: /\bZacapa\b/i,                        patch: { country: 'Guatemala' } },
  { re: /\bSmirnoff\b/i,                      patch: { country: 'Russia' } },
  { re: /\bAbsolut\b/i,                       patch: { country: 'Sweden' } },
  { re: /\bGrey\s*Goose\b/i,                  patch: { country: 'France' } },
  { re: /\bTanqueray\b/i,                     patch: { country: 'England' } },
  { re: /\bBombay\b/i,                        patch: { country: 'England' } },
  { re: /\bGordon'?s\b/i,                     patch: { country: 'Scotland' } },
  { re: /\bHendrick'?s\b/i,                   patch: { country: 'Scotland' } },
  { re: /\bBaileys\b/i,                       patch: { country: 'Ireland' } },
  { re: /\bKahlua\b/i,                        patch: { country: 'Mexico' } },
  { re: /\bDon\s*Julio\b/i,                   patch: { country: 'Mexico' } },
  { re: /\bJose\s*Cuervo\b/i,                 patch: { country: 'Mexico' } },
  { re: /\bRTD\b/i,                           patch: { category: 'other', spirit_type: null } },
]

// ─── Row regex ─────────────────────────────────────────────────────────────

// Each product row, after stripping the section indentation, looks like:
//   "<name>   <size>   <pack>   <price1>   <vat>   <price2>"
// Sizes can be decimal: 37.5 / 24.5 / 27.5. Pack may be missing on
// bundle sub-rows. Prices may be "N/A".
//
//   group 1 — full name (greedy, allows internal spaces / punctuation)
//   group 2 — size cl
//   group 3 — pack count (may be empty)
//   group 4 — pre-VAT price OR "N/A"
const NUM = String.raw`[\d,]+(?:\.\d+)?`
const PRICE = `(?:${NUM}|N\\/A)`
const ROW_RE = new RegExp(
  String.raw`^\s+(.+?)\s{2,}` +                          // name (trailing 2+ spaces)
  String.raw`(\d+(?:\.\d+)?)\s+` +                       // size cl
  String.raw`(\d+)?\s*` +                                // optional pack
  `(${PRICE})\\s+` +                                     // pre-VAT
  `(${PRICE})\\s+` +                                     // VAT
  `(${PRICE})\\s*$`,                                     // incl-VAT
)

// Bundle header: "Special Releases Set Collection (N SKUs)" — has only
// size + pack on the right, no prices. Skip these as standalone items
// (the follow-up rows have the real prices).
const BUNDLE_HEADER_RE = /\((?:\d+)\s+SKUs\)/i

// Header-row text from the table caption ("ประเภทสินค้า ... ก่อน VAT").
// We don't anchor on the Thai because pdftotext occasionally splits the
// Thai across multiple lines.
const HEADER_KEYWORDS_RE = /ประเภทสินค้า|ราคา\s*\/\s*ขวด|ก่อน\s*VAT|รวม\s*VAT|^\s*CL\s*$|^\s*ล\s*ัง\s*$/

// ─── Entry point ───────────────────────────────────────────────────────────

export async function parseRichly(
  buf: Buffer,
  filename: string,
  onProgress?: ProgressCb,
): Promise<ExtractionResult> {
  const path = await writeTemp(buf)
  try {
    await onProgress?.(5, 'reading PDF')
    const text = await pdftotextLayout(path, 1, 0)
    await onProgress?.(20, 'parsing')

    const lines = text.split('\n')
    const items: ExtractedItem[] = []
    let currentSection: Section | null = null
    let lastReport = 0

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]
      const trimmed = raw.trim()
      if (!trimmed) continue
      if (HEADER_KEYWORDS_RE.test(trimmed)) continue
      // Thai company/contact lines on page 1: skip.
      if (/บริษัท|Tel\.|Email:|Tax\s*ID|Fax\.|^Email|ID\s*Line/.test(trimmed)) continue

      // Section header: line starts at column 0 and is plain Latin text.
      const indent = raw.search(/\S/)
      if (indent === 0 && /^[A-Z][A-Za-z& \-]*$/.test(trimmed) && trimmed.length < 30) {
        const key = trimmed.toLowerCase()
        const sec = SECTIONS[key]
        if (sec) {
          currentSection = sec
          continue
        }
      }

      // Bundle header → record context but don't emit.
      if (BUNDLE_HEADER_RE.test(trimmed)) continue

      // Product row.
      const m = raw.match(ROW_RE)
      if (m && currentSection) {
        const item = buildItem(m, currentSection)
        if (item) items.push(item)
      }

      if (i - lastReport > 50) {
        lastReport = i
        await onProgress?.(20 + Math.round((i / lines.length) * 70), 'parsing', items.length)
      }
    }

    await onProgress?.(95, 'inserting')
    return {
      supplier_name: SUPPLIER_NAME,
      price_list_date: deriveDate(text),
      currency: 'THB',
      items,
    }
  } finally {
    safeUnlink(path)
  }
}

// ─── Row → ExtractedItem ───────────────────────────────────────────────────

function buildItem(
  m: RegExpMatchArray,
  section: Section,
): ExtractedItem | null {
  const [, rawName, sizeStr, _pack, preVatStr] = m
  const name = rawName.trim()
  if (!name) return null

  const sizeCl = parseFloat(sizeStr)
  const volume = formatVolumeFromCl(sizeCl)
  const price = preVatStr === 'N/A' ? null : parsePrice(preVatStr)

  let item: ExtractedItem = {
    name,
    country: section.defaultCountry,
    region: null,
    grape_variety: null,
    price,
    year: null,
    volume,
    description: null,
    category: section.category,
    wine_type: section.defaultWineType ?? null,
    spirit_type: section.spiritType,
    supplier_sku: null,
  }

  // Brand overrides — e.g. Moet under "Other - MH" should be sparkling wine.
  for (const { re, patch } of BRAND_OVERRIDES) {
    if (re.test(name)) {
      item = { ...item, ...patch }
      break
    }
  }
  return item
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function parsePrice(s: string): number | null {
  const n = parseFloat(s.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

function formatVolumeFromCl(cl: number): string {
  // Whole-number CL like 70 → 700ml, 75 → 750ml, 100 → 1000ml.
  // Decimal CL like 37.5 → 375ml, 27.5 → 275ml.
  const ml = Math.round(cl * 10)
  return `${ml}ml`
}

function deriveDate(text: string): string | null {
  // Catalog prints "เดือน <Thai month> <BE year>" near the top.
  // Thai Buddhist Era year - 543 → Gregorian.
  const thaiMonths: Record<string, string> = {
    'มกราคม': '01', 'กุมภาพันธ์': '02', 'มีนาคม': '03', 'เมษายน': '04',
    'พฤษภาคม': '05', 'มิถุนายน': '06', 'กรกฎาคม': '07', 'สิงหาคม': '08',
    'กันยายน': '09', 'ตุลาคม': '10', 'พฤศจิกายน': '11', 'ธันวาคม': '12',
  }
  const m = text.match(/เดือน\s+(\S+)\s+(\d{4})/)
  if (m) {
    const mo = thaiMonths[m[1]]
    const beYear = parseInt(m[2], 10)
    if (mo && Number.isFinite(beYear)) {
      const greg = beYear - 543
      return `${greg}-${mo}-01`
    }
  }
  return null
}
