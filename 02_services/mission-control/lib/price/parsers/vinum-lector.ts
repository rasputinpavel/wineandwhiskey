// Vinum Lector — 114-page Adobe InDesign catalog with 746 SKU-anchored
// product cards. Layout is exceptionally regular, so we parse it
// deterministically rather than handing it to Claude.
//
// Card structure:
//
//   <wine name (indent ~13 sp.)>
//                 <vintage>          <region> <country>
//   <SKU> (indent 1-3 sp.)
//                 <ABV>
//                                                       ฿ <price>
//   <type>                          <grape variety>
//                                          <rating / notes>
//
// Type tag is on its own line (red / white / rose / sparkling / liqueur)
// or split across two lines (grape \n spirit) for grappa / pisco.
// Spirits replace the region with the bottle volume, e.g.:
//                 NV          700 ml Italy
//
// Section context (sticky) comes from country / sub-region / producer
// headers above each card block:
//
//   Argentina                   ← country (centered)
//   Bordeaux                    ← sub-region (left-indented)
//   Susana Balbo [Winery of...] ← producer (indented ~4 sp.)
//
// Vintage variants share an SKU base: FR0667-2014 / FR0667-2015 are
// different rows.
//
// SKU country prefix is the source of truth for country when the section
// header was missed:
//   AR/AU/AT/CL/FR/GE/HU/IT/NZ/PT/ZA/SP/US, plus OS=Austria (Österreich).

import type { ExtractedItem, ExtractionResult } from '../claude'
import { writeTemp as writeTempShared, safeUnlink, pdftotextLayout } from './_shared'

const writeTemp = (buf: Buffer) => writeTempShared(buf, 'vl')

const SUPPLIER_NAME = 'Vinum Lector Co.,Ltd.'

type ProgressCb = (pct: number, phase?: string, itemCount?: number) => Promise<void> | void

// ─── Constants ──────────────────────────────────────────────────────────────

// SKU shape: 2-3 letter country prefix, 4 digits, optional -YYYY vintage.
const SKU_RE = /^[A-Z]{2,3}\d{4}(?:-\d{4})?$/

// Country code → canonical name. Matches the prefixes Vinum Lector uses.
const SKU_COUNTRY: Record<string, string> = {
  AR: 'Argentina', AU: 'Australia', AT: 'Austria', OS: 'Austria',
  CH: 'Chile',     // Chile, not Switzerland — Vinum Lector ships no Swiss.
  FR: 'France', GE: 'Germany', DE: 'Germany', HU: 'Hungary',
  IT: 'Italy',  NZ: 'New Zealand', PO: 'Portugal', PT: 'Portugal',
  SA: 'South Africa', ZA: 'South Africa', SP: 'Spain', ES: 'Spain',
  US: 'USA',
}

const COUNTRIES = new Set([
  'Argentina', 'Australia', 'Austria', 'Chile', 'France', 'Germany',
  'Hungary', 'Italy', 'New Zealand', 'Portugal', 'South Africa', 'Spain',
  'USA',
])

// French sub-regions / Italian super-regions / etc — used to refine `region`
// when the catalog groups producers under a sub-section header.
const SUB_REGIONS = new Set([
  'Bordeaux', 'Burgundy', 'Champagne', 'Loire', 'Rhône', 'Rhone',
  'Alsace', 'Languedoc', 'Provence', 'Sud-Ouest', 'Beaujolais',
  'Médoc', 'Medoc', 'Haut Médoc', 'Haut-Médoc', 'Saint-Émilion',
  'Saint Estephe', 'Pauillac', 'Saint Julien', 'Saint-Julien',
  'Pessec-Leognan', 'Pessac-Léognan', 'Pomerol', 'Sauternes',
  'Margaux', 'Cote de Bourg', 'Côte de Bourg', 'Lalande de Pomerol',
  'Lussac St. Emilion', 'Montagne St. Emilion', 'Rivesaltes', 'Rivesalfes',
  'Saint-Émilion Satellites',
  'Tuscany', 'Piedmont', 'Veneto', 'Puglia', 'Sicily', 'Friuli',
  'Marche', 'Umbria', 'Lombardy', 'Trentino', 'Abruzzo', 'Lazio', 'Campania',
  'Super Tuscan', 'Super Tuscan IGT',
  'GRAND CRU', 'Spirits',
])

const TYPE_TAGS: Record<string, ExtractedItem['wine_type'] | null> = {
  red: 'red', White: 'white', white: 'white', rose: 'rose', 'rosé': 'rose',
  sparkling: 'sparkling', orange: 'orange',
}

// ─── Detection ─────────────────────────────────────────────────────────────

export async function isVinumLector(buf: Buffer, filename: string): Promise<boolean> {
  if (/vinum\s*lector/i.test(filename)) return true
  const path = await writeTemp(buf)
  try {
    const text = await pdftotextLayout(path, 1, 1)
    return /Vinum\s+Lector/i.test(text)
  } catch {
    return false
  } finally {
    safeUnlink(path)
  }
}

// ─── Entry point ───────────────────────────────────────────────────────────

type Ctx = {
  country: string | null
  region: string | null
  subSection: string | null
  producer: string | null
}

export async function parseVinumLector(
  buf: Buffer,
  _filename: string,
  onProgress?: ProgressCb,
): Promise<ExtractionResult> {
  const path = await writeTemp(buf)
  try {
    await onProgress?.(5, 'reading PDF')
    const text = await pdftotextLayout(path, 1, 0)
    await onProgress?.(15, 'parsing')

    const lines = text.split('\n')
    const items: ExtractedItem[] = []
    const skuSeen = new Set<string>()
    const ctx: Ctx = { country: null, region: null, subSection: null, producer: null }

    let lastReport = 0

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].replace(/\s+$/, '')
      const trimmed = raw.trim()
      if (!trimmed) continue

      // Page footer artefact → skip
      if (/^\*Price are in thai baht/.test(trimmed)) continue
      if (/Vintages May be/.test(trimmed)) continue
      if (/^April \d{4}\s+Si\s+\d+$/.test(trimmed)) continue
      if (/^without Prior Notice/.test(trimmed)) continue

      // ---------- Section / context detection ----------
      if (COUNTRIES.has(trimmed)) {
        ctx.country = trimmed
        ctx.region = null
        ctx.subSection = null
        ctx.producer = null
        continue
      }
      if (trimmed === 'Spirits') {
        ctx.country = null
        ctx.region = null
        ctx.subSection = 'Spirits'
        ctx.producer = null
        continue
      }
      if (SUB_REGIONS.has(trimmed)) {
        ctx.region = trimmed
        ctx.producer = null
        continue
      }
      // "Super Tuscan" sometimes appears as "Super Tuscan IGT" or "Super Tuscan"
      // and we want to treat the next country header as fresh
      // Skip rule: if the line is a plain wine_type tag at the start of card,
      // don't mistake it for a producer.
      if (/^(red|white|rose|rosé|sparkling|orange|liqueur|grape|spirit)\b/i.test(trimmed) && trimmed.length < 30) {
        continue
      }

      // ---------- SKU anchor ----------
      const indent = raw.search(/\S/)
      if (SKU_RE.test(trimmed) && indent <= 6) {
        const item = parseCard(lines, i, ctx)
        if (item && item.supplier_sku) {
          const key = item.supplier_sku.toLowerCase()
          if (!skuSeen.has(key)) {
            skuSeen.add(key)
            items.push(item)
          }
        }
        if (i - lastReport > 200) {
          lastReport = i
          await onProgress?.(15 + Math.round((i / lines.length) * 75), 'parsing', items.length)
        }
        continue
      }

      // ---------- Producer header ----------
      // Two visual styles for producer titles:
      //   • Left-indented short line (Malbicho, Susana Balbo, Andeluna)
      //     → indent 1-8 chars
      //   • Centered title above a block (Grappa Castagner)
      //     → indent ≥ 25 chars (effectively centered on A4)
      // Both are short, not section headers, not card data.
      const leftProducer = indent >= 1 && indent <= 8
      const centeredProducer = indent >= 25 && trimmed.length <= 50
      if ((leftProducer || centeredProducer) && trimmed.length >= 3 && trimmed.length <= 100) {
        if (looksLikeCardData(trimmed)) continue
        if (looksLikeVolumeMarker(trimmed)) continue
        if (/^[0-9]/.test(trimmed)) continue // anything starting with a digit
        // Don't promote things that look like wine names (deeper indent already filters most;
        // also reject if the next line is NOT empty/marker — wine names sit immediately
        // before a vintage line).
        if (centeredProducer && /^[A-Z][a-zA-Z0-9 \-&'’.,]+$/.test(trimmed)) {
          ctx.producer = cleanProducer(trimmed)
          continue
        }
        if (leftProducer) {
          ctx.producer = cleanProducer(trimmed)
        }
      }
    }

    await onProgress?.(95, 'inserting')
    return {
      supplier_name: SUPPLIER_NAME,
      price_list_date: null,
      currency: 'THB',
      items,
    }
  } finally {
    safeUnlink(path)
  }
}

// ─── Card parser ────────────────────────────────────────────────────────────

function parseCard(lines: string[], skuIdx: number, ctx: Ctx): ExtractedItem | null {
  const sku = lines[skuIdx].trim()
  if (!SKU_RE.test(sku)) return null

  // Look back up to 5 lines for the vintage line (`<vintage> <region/volume> <country>`)
  // and one further for the wine name.
  let vintageIdx = -1
  for (let j = skuIdx - 1; j >= Math.max(0, skuIdx - 6); j--) {
    if (looksLikeVintageLine(lines[j])) { vintageIdx = j; break }
  }
  if (vintageIdx < 0) return null

  const vintageInfo = parseVintageLine(lines[vintageIdx])
  if (!vintageInfo) return null

  // Wine name: nearest line above vintage that's substantial and not a
  // section/producer header. Walk up to 4 lines above vintageIdx.
  let name: string | null = null
  for (let j = vintageIdx - 1; j >= Math.max(0, vintageIdx - 4); j--) {
    const t = lines[j].trim()
    if (!t) continue
    if (looksLikeCardData(t)) continue
    if (looksLikeSectionHeader(t)) continue
    if (SKU_RE.test(t)) break // hit previous card
    name = t
    break
  }
  if (!name) return null

  // Forward scan: ABV, price, type/grape lines.
  let abv: number | null = null
  let priceRaw = ''
  let typeText = ''
  let grapeText = ''
  let descParts: string[] = []
  let priceIdxFound = -1

  for (let j = skuIdx + 1; j < Math.min(lines.length, skuIdx + 12); j++) {
    const raw = lines[j]
    const t = raw.trim()
    if (!t) continue
    if (SKU_RE.test(t)) break // next card
    if (looksLikeSectionHeader(t)) break

    // ABV: standalone numeric, e.g. "13" or "14.5"
    if (abv === null && /^\d+(?:\.\d+)?$/.test(t) && parseFloat(t) <= 65) {
      abv = parseFloat(t)
      continue
    }

    // Price: line containing ฿ followed by number or only "฿  ,"
    if (priceRaw === '' && /฿/.test(raw)) {
      const priceMatch = raw.match(/฿\s*([\d,]+(?:\.\d+)?)/)
      if (priceMatch) {
        priceRaw = priceMatch[1]
        // Tail check: catalog has cards where price has been split across
        // lines (e.g. "฿  00" + a stray "5" three lines below = 500). Mark
        // for fallback if priceMatch is suspiciously short (1-2 digits).
        const digitsOnly = priceRaw.replace(/[,\s]/g, '')
        if (digitsOnly.length <= 2) priceIdxFound = j
        else continue
      } else {
        priceIdxFound = j
      }
      continue
    }

    // Type line: starts with a known wine_type tag, possibly with grape after.
    if (!typeText) {
      // No \b because rosé ends in a non-ASCII letter and \b is ASCII-only,
      // which would block the match. Anchor with start + a whitespace
      // separator instead.
      const m = t.match(/^(red|white|rose|rosé|sparkling|orange|liqueur)(?:\s+(.*))?$/i)
      if (m) {
        typeText = m[1]
        if (m[2]) grapeText = m[2].trim()
        continue
      }
      // Spirits split: "grape" and "spirit" on consecutive lines.
      if (/^grape\b/i.test(t)) {
        typeText = 'grape spirit'
        // Remainder of grape line might be "Double Distilled Muscat Grapes"
        // — we'll pull grape from line below the price.
        continue
      }
      if (/^spirit\b/i.test(t) && typeText === 'grape spirit') {
        // already noted
        continue
      }
    } else if (!grapeText && t.length < 200) {
      // Line right after the type — usually grape variety.
      // But skip if it looks like a price/ABV row or ratings-only.
      if (/^\d+(\.\d+)?$/.test(t)) continue
      if (/฿/.test(t)) continue
      grapeText = t
      continue
    } else {
      // Ratings / accolades line.
      if (t.length > 4 && t.length < 250) descParts.push(t)
    }
  }

  // Fallback price recovery for PDF-positioning glitches. Two failure modes:
  //   (a) "฿  ,"  + "1   0   2   5" 3 lines later → 1025
  //   (b) "฿  00" + "5" 3 lines later → 500
  // Walk 6 lines after the broken price and gather any trailing digit-row
  // pattern (digits separated by 1+ spaces, possibly with commas).
  if (priceIdxFound > 0) {
    let scattered = ''
    for (let j = priceIdxFound + 1; j < Math.min(lines.length, priceIdxFound + 7); j++) {
      const tail = lines[j].match(/(?:^|\s{2,})((?:\d[,\s]*)+)$/)
      if (tail) {
        const digitsOnly = tail[1].replace(/[,\s]+/g, '')
        if (/^\d+$/.test(digitsOnly)) scattered += digitsOnly
      }
    }
    if (scattered) {
      // Concatenate scattered (typically the LEFT digits, positioned higher
      // up in PDF reading order) with whatever was on the ฿ line itself
      // (the right digits).
      priceRaw = scattered + priceRaw.replace(/[,\s]/g, '')
    }
  }

  const price = parsePrice(priceRaw)

  // Country: prefer section context, then SKU country code.
  const skuPrefix = sku.match(/^([A-Z]{2,3})\d/)?.[1]
  const country = ctx.country
    || (skuPrefix ? SKU_COUNTRY[skuPrefix] ?? null : null)
    || vintageInfo.country
    || null

  // Volume: from vintage line for spirits ("700 ml"), default 750ml for wines.
  let volume = '750ml'
  if (vintageInfo.regionOrVolume) {
    const vm = vintageInfo.regionOrVolume.match(/(\d+(?:[.,]\d+)?)\s*(ml|l|liter|cl)\b/i)
    if (vm) {
      const n = vm[1].replace(',', '.')
      const u = vm[2].toLowerCase()
      volume = u === 'l' || u === 'liter' ? `${n}L` : u === 'cl' ? `${parseFloat(n) * 10}ml` : `${n}ml`
    }
  }

  // Region: prefer section context (sticky), fall back to vintage line text
  // if it looks like a region (and not a volume).
  let region = ctx.region
  if (!region && vintageInfo.regionOrVolume && !/\d+\s*(ml|l|cl)\b/i.test(vintageInfo.regionOrVolume)) {
    region = vintageInfo.regionOrVolume.trim() || null
  }

  // Categorise.
  let category: ExtractedItem['category'] = 'wine'
  let wineType: ExtractedItem['wine_type'] = null
  let spiritType: string | null = null
  const t = typeText.toLowerCase()
  if (t === 'liqueur' || t === 'grape spirit') {
    category = 'spirits'
    spiritType = t === 'liqueur' ? 'liqueur' : 'grappa'
    // Refine: if name contains "Pisco" → spirit_type='other' (or pisco)
    if (/pisco/i.test(name)) spiritType = 'other'
    if (/amaro/i.test(name)) spiritType = 'amaro'
  } else if (TYPE_TAGS[t] !== undefined) {
    wineType = TYPE_TAGS[t]
  }

  // Compose name with producer prefix when name doesn't already reference
  // the producer. Substring check on the full producer string AND on its
  // distinctive last word (covers "Grappa Castagner" → name "Castagner ..."
  // where the surname is already in the name even though the full producer
  // header isn't a substring).
  let composedName = name
  if (ctx.producer) {
    const cleanProd = ctx.producer.replace(/\s*\[[^\]]*\]\s*/g, '').trim()
    const lc = composedName.toLowerCase()
    const distinctive = cleanProd
      .split(/\s+/)
      .filter(w => w.length >= 4 && !/^(grappa|cantine|cantina|domaine|chateau|maison|bodega|bodegas|winery|wines|estate|cellars|by|the|de|del|la|le)$/i.test(w))
    const refs = distinctive.length > 0 ? distinctive : [cleanProd]
    const alreadyRefd = lc.includes(cleanProd.toLowerCase())
      || refs.some(w => lc.includes(w.toLowerCase()))
    if (cleanProd && !alreadyRefd) {
      composedName = `${cleanProd} ${composedName}`
    }
  }

  // Strip "NEW" / "LIMITED STOCK" / "COMING SOON" markers from name.
  composedName = composedName.replace(/\s+(NEW|LIMITED\s+STOCK|COMING\s+SOON|RARE)\s*$/i, '').trim()

  return {
    name: composedName,
    country,
    region,
    grape_variety: grapeText || null,
    price,
    year: vintageInfo.year,
    volume,
    description: descParts.length ? descParts.join(' • ').slice(0, 300) : null,
    category,
    wine_type: wineType,
    spirit_type: spiritType,
    supplier_sku: sku,
  } as ExtractedItem
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function looksLikeVintageLine(line: string): boolean {
  // Vintage line examples (the leading whitespace varies, so test trimmed):
  //   "2024           Mendoza Argentina"
  //   "NV             700 ml Italy"
  //   "nv             Burgundy France"
  //   "2014/2015      Region Country"
  return /^(?:N\.?V|nv|NV|\d{4}(?:\/\d{4})?)\s+\S+/.test(line.trim())
}

function parseVintageLine(line: string): { year: number | null; regionOrVolume: string; country: string | null } | null {
  const t = line.trim()
  const m = t.match(/^(N\.?V|nv|NV|\d{4}(?:\/\d{4})?)\s+(.+?)\s*$/)
  if (!m) return null
  const yearStr = m[1]
  const tail = m[2].trim()
  let year: number | null = null
  if (/^\d{4}/.test(yearStr)) year = parseInt(yearStr.slice(0, 4), 10)
  // Last word of tail is usually country (e.g. "Mendoza Argentina", "700 ml Italy").
  const words = tail.split(/\s+/)
  const country = words.length >= 2 && COUNTRIES.has(words[words.length - 1]) ? words[words.length - 1] : null
  const regionOrVolume = country ? words.slice(0, -1).join(' ') : tail
  return { year, regionOrVolume, country }
}

function looksLikeVolumeMarker(line: string): boolean {
  return /^\s*\d+(?:[.,]\d+)?\s*(ml|l|cl|liter)\b/i.test(line)
}

function looksLikeCardData(line: string): boolean {
  // Quick heuristic: if a line is something we'd expect IN a card, it's not
  // a producer header.
  if (/฿/.test(line)) return true
  if (looksLikeVintageLine(line)) return true
  if (/^\d+(?:\.\d+)?$/.test(line.trim())) return true
  if (/^(red|white|rose|rosé|sparkling|orange|liqueur|grape|spirit)\b/i.test(line.trim())) return true
  return false
}

function looksLikeSectionHeader(line: string): boolean {
  if (COUNTRIES.has(line)) return true
  if (SUB_REGIONS.has(line)) return true
  return false
}

function cleanProducer(line: string): string {
  // Remove trailing accolades like "[Top 100 Premium Wine&Spirit Brands of the World 2023]"
  // — keep them in description only if useful, but for the producer name itself
  // we keep the bare estate name.
  return line.trim()
}

function parsePrice(raw: string): number | null {
  if (!raw) return null
  const cleaned = raw.replace(/[,\s]/g, '')
  const n = parseFloat(cleaned)
  return isFinite(n) ? n : null
}

