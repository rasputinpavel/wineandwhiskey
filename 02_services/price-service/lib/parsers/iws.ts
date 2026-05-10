// Independent Wine & Spirit (Thailand) — IWS Horeca price list.
//
// Excel-generated PDF (~64 pages, ~825 SKUs). Layout is unusually regular:
// every product block is preceded by a 8-column header
//   CODE | NAME | APPELLATION | VINTAGE | RATING | UNIT | PACK | PRICE
// followed by sub-type rows (Red/White/Rose/Sparkling/Champagne/Sweet/...)
// and SKU-anchored data rows. Section context comes from country headers
// (FRANCE/ITALY/AUSTRALIA/...) and an explicit "SPIRIT" section break.
//
// SKU encodes useful structure: e.g. W-FRML-004372022 →
//   W      = wine (W/A=wine, S=spirit, L=liqueur)
//   FR     = country code
//   ML     = brand mnemonic
//   00437  = item code
//   2022   = vintage suffix (last 4 digits)
// We keep the full SKU as supplier_sku and parse fields from the columns
// directly, falling back to SKU only when a column is missing.

import type { ExtractedItem, ExtractionResult } from '../claude'
import { writeTemp as writeTempShared, safeUnlink, pdftotextLayout } from './_shared'

const writeTemp = (buf: Buffer) => writeTempShared(buf, 'iws')

const SUPPLIER_NAME = 'Independent Wine & Spirit (Thailand) Co., Ltd.'

// SKU shape: prefix-letter, country code, brand code, alphanumeric tail.
// Prefixes observed in IWS: W=wine, A=aperitif/sparkling, L=liqueur,
// S=Scotch whisky, H=US whisky/bourbon, V=vodka, T=tequila, R=rum, G=gin,
// B=brandy, D=cider/RTD.
const SKU_RE = /^[WASLHVTRGBD]-[A-Z]{2,5}-[A-Z0-9]+$/

// Default spirit_type when section context didn't fire (e.g. early SKUs
// before the first sub-header in the spirits area).
const PREFIX_SPIRIT_TYPE: Record<string, string> = {
  S: 'whisky', H: 'whisky', V: 'vodka', T: 'tequila',
  R: 'rum', G: 'gin', B: 'brandy', L: 'liqueur',
}

// Prefix → category. W/A always wine; D is "other" (cider/RTD).
const PREFIX_CATEGORY: Record<string, ExtractedItem['category']> = {
  W: 'wine', A: 'wine',
  S: 'spirits', H: 'spirits', V: 'spirits', T: 'spirits',
  R: 'spirits', G: 'spirits', B: 'spirits', L: 'spirits',
  D: 'other',
}

const COUNTRY_HEADINGS: Record<string, string> = {
  FRANCE: 'France', ITALY: 'Italy', AUSTRALIA: 'Australia', CHILE: 'Chile',
  ARGENTINA: 'Argentina', URUGUAY: 'Uruguay', SPAIN: 'Spain', USA: 'USA',
  GERMANY: 'Germany', AUSTRIA: 'Austria', PORTUGAL: 'Portugal',
  SWITZERLAND: 'Switzerland', 'SOUTH AFRICA': 'South Africa', 'NEW ZEALAND': 'New Zealand',
  // Common misspellings observed in the source's broken word-wraps:
  ARGENTIN: 'Argentina', AUSTRI: 'Austria', PORTUGA: 'Portugal',
}

// Country-code (2 letters in SKU) → canonical name. Used as a fallback if
// the country section header was missed (e.g. start of doc).
const SKU_COUNTRY: Record<string, string> = {
  FR: 'France', IT: 'Italy', AU: 'Australia', CL: 'Chile', AG: 'Argentina',
  UY: 'Uruguay', SP: 'Spain', US: 'USA', DE: 'Germany', GM: 'Germany',
  AT: 'Austria', PT: 'Portugal', CH: 'Switzerland', ZA: 'South Africa',
  SF: 'South Africa', NZ: 'New Zealand', SC: 'Scotland', JP: 'Japan',
  IE: 'Ireland', RU: 'Russia', NT: 'Netherlands', TH: 'Thailand',
  PH: 'Philippines', MX: 'Mexico', TD: 'Trinidad & Tobago',
  IN: 'India', VN: 'Vietnam', LV: 'Latvia', PL: 'Poland', VE: 'Venezuela',
  UK: 'United Kingdom', GB: 'United Kingdom',
}

const WINE_TYPE_SUBS: Record<string, ExtractedItem['wine_type']> = {
  Red: 'red', White: 'white', Rose: 'rose', Rosé: 'rose',
  Sparkling: 'sparkling', Champagne: 'sparkling', Prosecco: 'sparkling',
  Sweet: null, Dessert: null, Sherry: null, Port: null, Fortified: null,
}

const SPIRIT_SUBS: Record<string, string> = {
  Whisky: 'whisky', Whiskey: 'whisky', Bourbon: 'whisky', Brandy: 'brandy',
  Cognac: 'cognac', Liqueur: 'liqueur', Liqueurs: 'liqueur', Vodka: 'vodka',
  Rum: 'rum', Gin: 'gin', Sake: 'sake', Vermouth: 'vermouth',
  Tequila: 'tequila', Bitter: 'bitters', Bitters: 'bitters', Pisco: 'other',
  Cider: 'other', RTD: 'other', Syrup: 'other',
}

// ─── Detection ─────────────────────────────────────────────────────────────

export async function isIWS(buf: Buffer, filename: string): Promise<boolean> {
  if (/iws/i.test(filename)) return true
  const path = await writeTemp(buf)
  try {
    const text = await pdftotextLayout(path, 1, 1)
    return /\bIWS\s+(Bangkok|Phuket|Samui|Krabi|Hua\s*Hin|Pa ?ya|Chiang\s*Mai)\b/i.test(text)
        || /iws\.co\.th/i.test(text)
        || /Independent\s+Wine\s+&\s+Spirit/i.test(text)
  } catch {
    return false
  } finally {
    safeUnlink(path)
  }
}

// ─── Entry point ───────────────────────────────────────────────────────────

type ProgressCb = (pct: number, phase?: string, itemCount?: number) => Promise<void> | void

type Ctx = {
  section: 'wine' | 'spirit'
  country: string | null
  winery: string | null
  wineType: ExtractedItem['wine_type']
  spiritType: string | null
}

export async function parseIWS(
  buf: Buffer,
  _filename: string,
  onProgress?: ProgressCb,
): Promise<ExtractionResult> {
  const path = await writeTemp(buf)
  try {
    await onProgress?.(5, 'reading PDF')
    const text = await pdftotextLayout(path, 1, 0) // all pages
    await onProgress?.(15, 'parsing')

    const items: ExtractedItem[] = []
    const skuSeen = new Set<string>()
    const ctx: Ctx = { section: 'wine', country: null, winery: null, wineType: null, spiritType: null }

    const lines = text.split('\n')
    const total = lines.length
    let lastReport = 0
    // Buffer of recent non-empty / non-context lines so we can recover a
    // name that landed on the previous line (Maison Bouey gift-box rows
    // have NAME on the line ABOVE the SKU row).
    const prevLines: string[] = []

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].replace(/\s+$/, '')
      const trimmed = raw.trim()
      if (!trimmed) continue

      // Section / context detection (cheap to try first).
      if (detectSpiritSection(trimmed)) {
        ctx.section = 'spirit'
        ctx.spiritType = null
        ctx.wineType = null
        ctx.country = null // re-derive per spirit sub-section / SKU
        ctx.winery = null
        prevLines.length = 0
        continue
      }
      const country = detectCountryHeading(trimmed)
      if (country) {
        ctx.country = country
        ctx.winery = null
        prevLines.length = 0
        continue
      }
      // CODE header row anchor — also the moment to capture the producer
      // block's winery from the lines immediately above it. Many wineries
      // (Domaine Tariquet, Barton & Guestier, ...) ship wines with very
      // short names like "Classic" / "Sauvignon Blanc" that are meaningless
      // without the producer name prepended.
      // If we can't find a winery candidate in prevLines, CLEAR the carry-
      // over from the previous block to avoid bleed (e.g. "Penfolds,
      // Fortified" sticking to Tio Pepe rows under the Sherry sub-section).
      if (/^CODE\b.*\bNAME\b.*\b(APPELLATION|PRICE)\b/i.test(trimmed)) {
        let found: string | null = null
        for (let p = prevLines.length - 1; p >= 0; p--) {
          const w = pickWinery(prevLines[p])
          if (w) { found = w; break }
        }
        ctx.winery = found
        prevLines.length = 0
        continue
      }
      const wt = WINE_TYPE_SUBS[trimmed]
      if (wt !== undefined && ctx.section === 'wine') {
        ctx.wineType = wt
        // Don't reset winery — Red/White/Rose are sub-sections of the same
        // producer block.
        continue
      }
      if (ctx.section === 'spirit') {
        const st = detectSpiritSubtype(trimmed)
        if (st) {
          ctx.spiritType = st
          ctx.winery = null
          prevLines.length = 0
          continue
        }
      }

      // Data row?
      const firstTok = trimmed.split(/\s+/, 1)[0]
      if (SKU_RE.test(firstTok)) {
        const item = parseRow(trimmed, ctx, prevLines)
        if (item && item.supplier_sku) {
          const key = item.supplier_sku.toLowerCase()
          if (!skuSeen.has(key)) {
            skuSeen.add(key)
            items.push(item)
          }
        }
        prevLines.length = 0
        if (i - lastReport > 200) {
          lastReport = i
          const pct = 15 + Math.round((i / total) * 75)
          await onProgress?.(pct, 'parsing', items.length)
        }
        continue
      }

      // Stash this line as a possible name carryover for the next SKU row.
      // Skip header rows ("CODE NAME APPELLATION ...") and obvious noise.
      if (!/^CODE\b/i.test(trimmed) && trimmed.length > 1 && trimmed.length < 200) {
        prevLines.push(trimmed)
        if (prevLines.length > 3) prevLines.shift()
      }
    }

    await onProgress?.(95, 'inserting')
    return { supplier_name: SUPPLIER_NAME, price_list_date: null, currency: 'THB', items }
  } finally {
    safeUnlink(path)
  }
}

// ─── Detection helpers ─────────────────────────────────────────────────────

function detectSpiritSection(line: string): boolean {
  if (/^SPIRIT$/.test(line)) return true
  if (/^Whisky\s*&\s*Brandy$/i.test(line)) return true
  return false
}

// Spirit sub-section headers in IWS look like "Scotch Whisky", "Japanese
// Whisky", "Whisky & Brandy", "French Brandy", "Liqueurs & Spirit",
// "Japanese Plum Liqueur", "Brandy", "Vodka", "Rum", "Gin", "Sake",
// "Tequila", "Vermouth". Match by the most specific token in the line.
const SPIRIT_KEYWORDS: { rx: RegExp; type: string }[] = [
  { rx: /\bWhisk(?:y|ey)\b/i,  type: 'whisky' },
  { rx: /\bBourbon\b/i,        type: 'whisky' },
  { rx: /\bArmagnac\b/i,       type: 'armagnac' },
  { rx: /\bCognac\b/i,         type: 'cognac' },
  { rx: /\bCalvados\b/i,       type: 'calvados' },
  { rx: /\bBrandy\b/i,         type: 'brandy' },
  { rx: /\bGrappa\b/i,         type: 'grappa' },
  { rx: /\bLiqueurs?\b/i,      type: 'liqueur' },
  { rx: /\bAmaro\b/i,          type: 'amaro' },
  { rx: /\bVodka\b/i,          type: 'vodka' },
  { rx: /\bRum\b/i,            type: 'rum' },
  { rx: /\bGin\b/i,            type: 'gin' },
  { rx: /\bTequila\b/i,        type: 'tequila' },
  { rx: /\bSake\b/i,           type: 'sake' },
  { rx: /\bVermouth\b/i,       type: 'vermouth' },
  { rx: /\bBitter(s|ed)?\b/i,  type: 'bitters' },
  { rx: /\bAperitif\b/i,       type: 'aperitif' },
  { rx: /\bShochu\b/i,         type: 'shochu' },
  { rx: /\bPisco\b/i,          type: 'other' },
]

function detectSpiritSubtype(line: string): string | null {
  if (line.length > 60) return null // skip long descriptive paragraphs
  for (const { rx, type } of SPIRIT_KEYWORDS) {
    if (rx.test(line)) return type
  }
  return null
}

// Pull the winery name from a candidate line. The IWS format puts winery
// either alone on a line ("BARTON & GUESTIER") or as the first column of a
// row that may carry trailing tags ("Domaine Tariquet    Sustainable & Vegan
// friendly"). Returns null for lines that are clearly descriptions, section
// markers, or noise.
function pickWinery(line: string): string | null {
  const first = line.split(/\s{2,}/, 1)[0].trim()
  if (first.length < 3 || first.length > 70) return null
  if (!/^[A-Z0-9]/.test(first)) return null // descriptions start lowercase
  // Skip sentence-ish lines (descriptions).
  if (/\b(is|was|are|were|produces?|produce|produced|makes?|made|established|owns?|owned|founded|created|consist|locate|grow|grew|when|where|the\s+(\w+))\b/i.test(first)) {
    return null
  }
  // Skip section markers (Red/White/Rose/Sparkling, country names handled
  // elsewhere) and headers like "CODE NAME APPELLATION".
  if (/^(Red|White|Rose|Rosé|Sparkling|Champagne|Sweet|Dessert|Sherry|Port|Fortified|CODE)$/i.test(first)) return null
  // Title-case if the source is all-caps.
  if (first === first.toUpperCase() && first.length > 3) {
    return first.split(/\s+/).map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')
  }
  return first
}

function detectCountryHeading(line: string): string | null {
  const u = line.toUpperCase()
  if (COUNTRY_HEADINGS[u]) return COUNTRY_HEADINGS[u]
  // Multi-word like "SOUTH AFRICA" / "NEW ZEALAND" — sometimes the words land
  // on separate lines; we handle each as a single-token country (SOUTH/NEW
  // alone) by attaching the next AFRICA/ZEALAND token if present. Skip here:
  // the misspelling fallbacks above cover most real cases.
  return null
}

// ─── Row parsing ────────────────────────────────────────────────────────────

function parseRow(line: string, ctx: Ctx, prevLines: string[] = []): ExtractedItem | null {
  // Tokenize by 2+ spaces.
  const tokens = line.split(/\s{2,}/).map(t => t.trim()).filter(Boolean)
  if (tokens.length < 4) return null

  const sku = tokens[0]
  if (!SKU_RE.test(sku)) return null

  const remain = tokens.slice() // we'll shrink from the right

  // Right-peel deterministic fields. PRICE is always last. PACK is
  // sometimes empty (e.g. Maison Bouey gift-box rows); UNIT is the next
  // tail-token in any wine/spirit row but theoretically could also be
  // absent. PACK and UNIT are popped in order if present.
  const priceRaw = popMatch(remain, PRICE_RE)
  if (!priceRaw) return null
  const packRaw = popMatch(remain, PACK_RE)
  const unitRaw = popMatch(remain, UNIT_RE)
  void packRaw // currently unused, kept for clarity

  // After unit, fields in source order are:
  //   APPELLATION | VINTAGE | RATING
  // — but RATING and APPELLATION may both be present, just RATING, or
  // neither, and VINTAGE may be missing for NV products. Detect each by
  // pattern and pop greedily.

  let ratingRaw: string | null = null
  let vintageRaw: string | null = null
  let appellationRaw: string | null = null

  // Vintage is unambiguous (4-digit year or NV) — peel even if it's the
  // last remaining token (NAME on a previous line scenario).
  if (remain.length > 1 && VINTAGE_RE.test(remain[remain.length - 1])) {
    vintageRaw = remain.pop() ?? null
  }
  // For rating/appellation, keep the conservative `> 2` guard so we don't
  // eat a multi-word NAME when its tail looks plausible.
  for (let attempt = 0; attempt < 2 && remain.length > 2; attempt++) {
    const last = remain[remain.length - 1]
    if (looksLikeRating(last) && !ratingRaw) {
      ratingRaw = remain.pop() ?? null
    } else if (looksLikeAppellation(last) && !appellationRaw) {
      appellationRaw = remain.pop() ?? null
    } else if (VINTAGE_RE.test(last) && !vintageRaw) {
      vintageRaw = remain.pop() ?? null
    } else {
      break
    }
  }

  // Whatever's left between SKU (remain[0]) and what we've consumed is NAME
  // (possibly the appellation slipped in if its detector missed). Join.
  const nameTokens = remain.slice(1)
  let name = nameTokens.join(' ').trim()

  // No NAME on this row → recover from the last non-context line buffered
  // above it. Multi-line gift-box names span 2 lines, so join the most
  // recent prevLines that look like name fragments (no SKU, no headers).
  if (!name && prevLines.length > 0) {
    const candidates = prevLines.filter(p => !SKU_RE.test(p.split(/\s+/, 1)[0]) && !/^(Red|White|Rose|Sparkling|Champagne)$/i.test(p))
    name = candidates.join(' ').replace(/\s+/g, ' ').trim()
  }
  if (!name) return null

  // Prepend the producer when the row's name is short or doesn't already
  // reference it. Wineries like Domaine Tariquet ship "Classic" / "Sauvignon
  // Blanc" / "Premieres Grives" — meaningless without the brand.
  if (ctx.winery && !name.toLowerCase().includes(ctx.winery.toLowerCase())) {
    name = `${ctx.winery} ${name}`
  }

  const price = parsePrice(priceRaw)
  const year = parseYear(vintageRaw, sku)
  const volume = parseVolume(unitRaw)

  // Resolve country. For all spirit prefixes, ALWAYS prefer the SKU country
  // code — wine-section country context is wrong for spirits (e.g. Tio Pepe
  // sherry / Tamnavulin whisky still sit inside whatever country block the
  // wine catalog last entered). For W- and A- items, prefer section context.
  const prefix = sku.charAt(0)
  const skuCountryMatch = sku.match(/^[A-Z]-([A-Z]{2})/)
  const skuCountry = skuCountryMatch ? SKU_COUNTRY[skuCountryMatch[1]] ?? null : null
  const isSpirit = prefix !== 'W' && prefix !== 'A'
  const country = isSpirit ? (skuCountry ?? ctx.country) : (ctx.country ?? skuCountry)

  // Category resolution by SKU prefix (authoritative) + section context.
  const category = PREFIX_CATEGORY[prefix] ?? 'other'
  let wineType: ExtractedItem['wine_type'] = null
  let spiritType: string | null = null
  if (category === 'spirits') {
    spiritType = ctx.spiritType ?? PREFIX_SPIRIT_TYPE[prefix] ?? null
    // Refine vermouth/amaro/grappa/etc from row content if the section
    // context didn't catch them (Vermouth section often appears under the
    // "Liqueurs" umbrella in IWS).
    if (spiritType === 'liqueur' || !spiritType) {
      if (/\bvermouth\b/i.test(name)) spiritType = 'vermouth'
      else if (/\bgrappa\b/i.test(name)) spiritType = 'grappa'
      else if (/\bamaro\b/i.test(name)) spiritType = 'amaro'
      else if (/\b(armagnac)\b/i.test(name)) spiritType = 'armagnac'
      else if (/\b(cognac|VSOP|XO)\b/i.test(name) && prefix === 'B') spiritType = 'cognac'
    }
  } else if (category === 'wine') {
    wineType = ctx.wineType
    if (!wineType && prefix === 'A') wineType = 'sparkling'
  }

  const description = ratingRaw || null

  return {
    name,
    country,
    region: appellationRaw || null,
    grape_variety: null,
    price,
    year,
    volume,
    description,
    category,
    wine_type: wineType,
    spirit_type: spiritType,
    supplier_sku: sku,
  } as ExtractedItem
}

// ─── Pattern helpers ───────────────────────────────────────────────────────

const PRICE_RE = /^[\d,]+(?:\.\d+)?$/
const PACK_RE = /^\d{1,3}\s*[xX]\s*\d{1,3}$|^\d{1,3}$/        // "1x6", "1x12", "12"
const UNIT_RE = /^\d+(?:[.,]\d+)?\s*(?:cl|ml|l|liter|cL)\.?$/i // "75cl", "75 cl.", "1L"
const VINTAGE_RE = /^(N\.?\/?V|NV|(?:19|20)\d{2}(?:\/(?:19|20)?\d{2,4})*)$/i

function popMatch(tokens: string[], re: RegExp): string | null {
  if (tokens.length === 0) return null
  const last = tokens[tokens.length - 1]
  if (re.test(last)) {
    tokens.pop()
    return last
  }
  return null
}

function looksLikeRating(s: string): boolean {
  // Common patterns: "RP: 95", "JS 92", "WS: 90+", "Decanter: 97",
  // "Gilbert & Gaillard: Gold", "Gold Bordeaux", "Berliner Gold", "MV Silver",
  // "JD90", "WA 91-93".
  if (/\b(RP|JS|WS|WE|WA|JD|TA|BD|JH|GG)\s*[:\s]\s*\d{2,3}/i.test(s)) return true
  if (/\b(Gold|Silver|Bronze|Medal|Gilbert|Berliner|Decanter|Suckling|Parker|Spectator|Wine|James)\b/i.test(s)) return true
  if (/^\d{2,3}\+?$/.test(s)) return true
  return false
}

function looksLikeAppellation(s: string): boolean {
  if (s.length < 3 || s.length > 80) return false
  // Contains a vintage? Reject — let VINTAGE_RE catch.
  if (VINTAGE_RE.test(s)) return false
  if (PRICE_RE.test(s)) return false
  if (PACK_RE.test(s)) return false
  if (UNIT_RE.test(s)) return false
  // Heuristic: appellations contain letters, may have dots/dashes/commas/&
  // and often start with words like AOC, AOP, IGT, IGP, DOC, DOCG, DO, DOP,
  // DOCa, IGTP, AVA, regional names, "VdP", or capitalised place names.
  if (/^(AOC|AOP|IGT|IGP|DO|DOC|DOCG|DOP|DOCa|VdP|VDP|AVA|Vino|Vin|Vinho|Vino|Pays|Cotes|Cote|Bordeaux|Burgundy|Chateau|Riserva|Reserva|Rioja|Toscana|Pays\s+d['']Oc)\b/i.test(s)) return true
  // Or it just looks like a place name (Capitalised words, ≤6 words).
  if (/^[A-Z][a-zA-Z\s,.\-'&À-ſ]+$/.test(s) && s.split(/\s+/).length <= 6) return true
  return false
}

function parsePrice(s: string | null): number | null {
  if (!s) return null
  const n = parseFloat(s.replace(/,/g, ''))
  return isFinite(n) ? n : null
}

function parseYear(vintage: string | null, sku: string): number | null {
  if (vintage) {
    if (/^N/i.test(vintage)) return null
    const m = vintage.match(/(19|20)\d{2}/)
    if (m) return parseInt(m[0], 10)
  }
  // Fallback to SKU suffix (last 4 digits); '0000' means N/V.
  const skuM = sku.match(/(19|20)\d{2}$/)
  if (skuM) return parseInt(skuM[0], 10)
  return null
}

function parseVolume(unit: string | null): string | null {
  if (!unit) return null
  const m = unit.match(/(\d+(?:[.,]\d+)?)\s*(cl|ml|l|liter)/i)
  if (!m) return unit
  const n = m[1].replace(',', '.')
  const u = m[2].toLowerCase()
  if (u === 'l' || u === 'liter') return `${n}L`
  if (u === 'cl') {
    // Render cl as ml for consistency with other parsers (75cl → 750ml).
    const ml = parseFloat(n) * 10
    return Number.isInteger(ml) ? `${ml}ml` : `${n}cl`
  }
  return `${n}ml`
}

