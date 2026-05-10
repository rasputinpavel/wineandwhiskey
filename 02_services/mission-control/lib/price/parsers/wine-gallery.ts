// Wine Gallery — multi-sheet XLSX with per-region tabs.
//
// Sheets discovered:
//   cover, index   — front matter
//   us / ar / au / ch / gm / nz / sa / sp     — single-country sheets
//   f-alsace / f-bor / f-bur / f-rhone /
//   f-lang+loire+provence                      — France by region
//   i-piedmont / i-friuli+ven+lom+trentino /
//   i-tuscany / i-abruzzo+campania+puglia /
//   i-sicily                                   — Italy by region
//   rose / sweet / sparkling / champ           — by wine style (any country)
//   lr-non-750 / ttg / ttg-non-750             — special formats
//
// Cell layout per sheet (consistent across all data sheets):
//   Col A: vintage year ("2024") or blank for context rows
//   Col B: wine name OR producer name OR region header (ALL CAPS) OR grape
//          variety in parens "(cab sau+cab franc+petit verdot)"
//   Col C: country header (ALL CAPS) on the very first row of country sheets
//   Col D: price (number) or "soon" (pre-order) or "tba"
//
// Block structure: country header → region header (ALL CAPS) → producer
// (mixed case) → wine rows → optional grape line → blank → next producer.
//
// SKU is absent. Dedup by (sheet, name, year, price).

import * as XLSX from 'xlsx'
import Anthropic from '@anthropic-ai/sdk'
import type { ExtractedItem, ExtractionResult } from '../claude'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SUPPLIER_NAME = 'Wine Gallery'

type ProgressCb = (pct: number, phase?: string, itemCount?: number) => Promise<void> | void

// Canonical country per sheet name.
const SHEET_COUNTRY: Record<string, string | null> = {
  us: 'USA', ar: 'Argentina', au: 'Australia', ch: 'Chile',
  'f-alsace': 'France', 'f-bor': 'France', 'f-bur': 'France',
  'f-lang+loire+provence': 'France', 'f-rhone': 'France',
  gm: 'Germany', 'i-piedmont': 'Italy', 'i-friuli+ven+lom+trentino': 'Italy',
  'i-tuscany': 'Italy', 'i-abruzzo+campania+puglia': 'Italy', 'i-sicily': 'Italy',
  nz: 'New Zealand', sa: 'South Africa', sp: 'Spain',
  champ: 'France', // Champagne is always France
  // Special-format sheets (Champagne in non-750ml bottles, Taittinger).
  // The catalog's special-format sheets we've seen so far are all Champagne,
  // i.e. France.
  'lr-non-750': 'France', ttg: 'France', 'ttg-non-750': 'France',
  // Style sheets — country comes from row context.
  rose: null, sweet: null, sparkling: null,
}

// Region (or sub-region) hint from sheet name.
const SHEET_REGION: Record<string, string | null> = {
  'f-alsace': 'Alsace', 'f-bor': 'Bordeaux', 'f-bur': 'Burgundy',
  'f-rhone': 'Rhône', 'f-lang+loire+provence': 'Languedoc / Loire / Provence',
  'i-piedmont': 'Piedmont', 'i-tuscany': 'Tuscany',
  'i-friuli+ven+lom+trentino': 'Friuli / Veneto / Lombardy / Trentino',
  'i-abruzzo+campania+puglia': 'Abruzzo / Campania / Puglia',
  'i-sicily': 'Sicily', champ: 'Champagne',
  'lr-non-750': 'Champagne', ttg: 'Champagne', 'ttg-non-750': 'Champagne',
}

// Wine type hint from sheet name (style sheets).
const SHEET_WINE_TYPE: Record<string, ExtractedItem['wine_type']> = {
  rose: 'rose', sparkling: 'sparkling', champ: 'sparkling',
  'lr-non-750': 'sparkling', ttg: 'sparkling', 'ttg-non-750': 'sparkling',
  // 'sweet' is a wine style not in our enum — leave wine_type=null and
  // tag in description.
}

// Default per-bottle volume; "lr-non-750" / "ttg-non-750" override per row.
const DEFAULT_VOLUME = '750ml'

// ─── Detection ─────────────────────────────────────────────────────────────

export function isWineGallery(buffer: Buffer, filename: string): boolean {
  if (/wine\s*gallery/i.test(filename)) return true
  // Fallback: peek at sheet names
  try {
    const wb = XLSX.read(buffer, { type: 'buffer', sheetRows: 1 })
    const sigs = ['f-bor', 'f-bur', 'i-tuscany', 'i-piedmont', 'champ']
    return sigs.some(s => wb.SheetNames.includes(s))
  } catch {
    return false
  }
}

// ─── Entry point ───────────────────────────────────────────────────────────

export async function parseWineGallery(
  buffer: Buffer,
  _filename: string,
  onProgress?: ProgressCb,
): Promise<ExtractionResult> {
  await onProgress?.(5, 'reading workbook')
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const dataSheets = wb.SheetNames.filter(n => !['cover', 'index'].includes(n.toLowerCase()))

  await onProgress?.(15, 'parsing sheets')

  const items: ExtractedItem[] = []
  const skuSeen = new Set<string>()

  for (let s = 0; s < dataSheets.length; s++) {
    const sheetName = dataSheets[s]
    const sheet = wb.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][]

    parseSheet(sheetName, rows, items, skuSeen)

    const pct = 15 + Math.round(((s + 1) / dataSheets.length) * 75)
    await onProgress?.(pct, `sheet ${sheetName}`, items.length)
  }

  await onProgress?.(95, 'inserting')
  return {
    supplier_name: SUPPLIER_NAME,
    price_list_date: null,
    currency: 'THB',
    items,
  }
}

// ─── Sheet parser ──────────────────────────────────────────────────────────

type SheetCtx = {
  country: string | null
  region: string | null
  winery: string | null
  pendingGrape: string | null
  // For style sheets (rose/sweet/sparkling/champ) we need to track the
  // country from row text since the sheet itself doesn't define one.
  styleSheetWineType: ExtractedItem['wine_type']
}

function parseSheet(
  sheetName: string,
  rows: unknown[][],
  out: ExtractedItem[],
  skuSeen: Set<string>,
) {
  const ctx: SheetCtx = {
    country: SHEET_COUNTRY[sheetName] ?? null,
    region: SHEET_REGION[sheetName] ?? null,
    winery: null,
    pendingGrape: null,
    styleSheetWineType: SHEET_WINE_TYPE[sheetName] ?? null,
  }
  const isStyleSheet = sheetName === 'rose' || sheetName === 'sweet'
    || sheetName === 'sparkling' || sheetName === 'champ'

  rows.forEach(row => {
    const a = String(row[0] ?? '').trim()
    const b = String(row[1] ?? '').trim()
    const c = String(row[2] ?? '').trim()
    const d = row[3]
    const dStr = String(d ?? '').trim()
    const eStr = String(row[4] ?? '').trim() // sometimes "limited"

    // Style-sheet row 0: "ROSE" / "SWEET" / "SPARKLING" / "CHAMPAGNE" in
    // col C — purely decorative (not a country). Skip without overriding ctx.
    if (!a && !b && c && isStyleSheet && /^(ROSE|SWEET|SPARKLING|CHAMPAGNE)\s*$/i.test(c)) {
      return
    }

    // Country header in col C (ALL CAPS) — used by single-country sheets.
    if (!a && !b && c && c === c.toUpperCase() && c.length > 1) {
      if (isStyleSheet) {
        // Already filtered above; anything else here is decorative.
        return
      }
      // SHEET_COUNTRY is canonical; ignore the row text.
      return
    }

    // Combined country/region row (style sheets only): "CHILE / COLCHAGUA",
    // "FRANCE / ALSACE", "ITALY / VENETO". On country sheets, similar
    // "X / Y" patterns (e.g. "PESSAC LEOGNSAN / GRAVES" on f-bor) are
    // sub-region pairs — treat as region only.
    if (!a && b && /\//.test(b) && !dStr) {
      const [first, ...rest] = b.split('/').map(s => s.trim())
      const sheetCountry = SHEET_COUNTRY[sheetName]
      if (sheetCountry === null && isStyleSheet) {
        // Style sheet without fixed country: first half is the country.
        ctx.country = canonCountry(first)
        ctx.region = rest.join(' / ') || ctx.region
      } else {
        // Country sheet: both halves are sub-regions.
        ctx.region = b
      }
      ctx.winery = null
      return
    }

    // Region header (ALL CAPS in col B): e.g. "YOUNTVILLE", "BAROSSA VALLEY".
    if (!a && b && b === b.toUpperCase() && !dStr && !b.startsWith('(')) {
      // Skip the appellation tags ("DOC", "DOCG", "AOC", "AOP", "DO", "IGT")
      // — they're per-block sub-headings used inside producer blocks.
      if (/^(DOC|DOCG|AOC|AOP|DO|DOP|IGT|IGP|VDP|AVA)\s*$/.test(b)) return
      if (!SHEET_REGION[sheetName]) ctx.region = b
      ctx.winery = null
      return
    }

    // Producer/winery header: B is mixed-case, no price, no parens.
    if (!a && b && !dStr && !b.startsWith('(')) {
      ctx.winery = b
      return
    }

    // Grape-variety annotation: B is in parens.
    if (!a && b.startsWith('(') && (b.endsWith(')') || !dStr)) {
      ctx.pendingGrape = b.replace(/^[(]+|[)]+$/g, '').trim()
      // Annotation usually trails the wine — backfill onto recent items in
      // the same producer block (the catalog often groups several vintages
      // of the same wine together with one grape line below).
      for (let k = out.length - 1; k >= Math.max(0, out.length - 6); k--) {
        const last = out[k]
        if (!last) break
        if (last.grape_variety) break // hit boundary of previous block
        last.grape_variety = ctx.pendingGrape
        // Re-infer wine_type now that we know the grapes.
        if (!last.wine_type && !ctx.styleSheetWineType) {
          last.wine_type = inferWineType(last.name, ctx.pendingGrape)
        }
      }
      return
    }

    // Wine row: A is a 4-digit year, "NV", "nv", "n.v.", or "N/V";
    // B is the wine name; D is the price (number or "soon").
    const isYear = /^(NV|N\.?V\.?|nv|n\.v\.?|(19|20)\d{2})$/i.test(a)
    if ((isYear || (!a && b)) && b && !b.startsWith('(')) {
      if (!a && !dStr) return // not a wine row

      const year = isYear && /^\d{4}$/.test(a) ? parseInt(a, 10) : null
      const price = parsePrice(dStr)

      // Build name: prepend winery when it's not already in the name.
      let name = b
      if (ctx.winery && !name.toLowerCase().includes(ctx.winery.toLowerCase())) {
        name = `${ctx.winery} ${name}`
      }

      // Wine type: prefer sheet-derived type for style sheets; else
      // heuristic from name + grape.
      let wineType: ExtractedItem['wine_type'] = ctx.styleSheetWineType
      if (!wineType) wineType = inferWineType(name, ctx.pendingGrape)

      // Volume: special sheets carry non-750ml products.
      const volume = sheetName.includes('non-750') ? null : DEFAULT_VOLUME

      const dedupKey = `${sheetName}|${name.toLowerCase()}|${year ?? ''}|${price ?? dStr}`
      if (skuSeen.has(dedupKey)) return
      skuSeen.add(dedupKey)

      // Description: include "soon"/"tba" marker, sheet-specific style hint.
      const descParts: string[] = []
      if (!price && dStr) descParts.push(dStr)
      if (eStr) descParts.push(eStr) // "limited", "375ml", etc.
      if (sheetName === 'sweet') descParts.push('Sweet wine')
      if (sheetName === 'lr-non-750' || sheetName === 'ttg-non-750') descParts.push('Non-750ml format')

      const item: ExtractedItem = {
        name,
        country: ctx.country,
        region: ctx.region,
        grape_variety: ctx.pendingGrape,
        price,
        year,
        volume,
        description: descParts.length ? descParts.join(' • ') : null,
        category: 'wine',
        wine_type: wineType,
        spirit_type: null,
        supplier_sku: null,
      }
      out.push(item)
      ctx.pendingGrape = null
      return
    }

  })
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function canonCountry(s: string): string {
  const t = s.trim().toLowerCase()
  if (t === 'america' || t === 'usa' || t === 'united states') return 'USA'
  if (t === 'argentina') return 'Argentina'
  if (t === 'australia') return 'Australia'
  if (t === 'austria') return 'Austria'
  if (t === 'chile') return 'Chile'
  if (t === 'france') return 'France'
  if (t === 'germany') return 'Germany'
  if (t === 'italy') return 'Italy'
  if (t === 'new zealand') return 'New Zealand'
  if (t === 'portugal') return 'Portugal'
  if (t === 'south africa') return 'South Africa'
  if (t === 'spain') return 'Spain'
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

function parsePrice(raw: string): number | null {
  if (!raw) return null
  if (/soon|tba|n\/a|coming/i.test(raw)) return null
  const cleaned = raw.replace(/[,\s฿THB]/gi, '')
  const n = parseFloat(cleaned)
  return isFinite(n) ? n : null
}

// ─── Wine Gallery clearance offer (image) ─────────────────────────────────

export function isWineGalleryOffer(filename: string, mimeType: string): boolean {
  if (!mimeType.startsWith('image/') && !/\.(jpe?g|png|webp)$/i.test(filename)) return false
  return /wine\s*gallery.*offer/i.test(filename) || /offer.*wine\s*gallery/i.test(filename)
}

const OFFER_PROMPT = `This is a Wine Gallery clearance offer table. Each row is a wine on closeout pricing.

Columns: no. | items | vintage | unit price | clearance price | remark

For EACH numbered row return ONE item:
{
  "name": "<full wine name from 'items' column, prepend producer if abbreviated, e.g. 'M.G. Cab-Sau' → 'Mont Gras Cabernet Sauvignon'; 'Antu ninquen Cab-Sau+Carmenere' → 'Antu Ninquen Cabernet Sauvignon Carmenere'; 'Echeverria Syrah GRAN RESERVA' stays as is>",
  "winery": "<producer brand: 'Mont Gras' for M.G., 'Antu Ninquen', 'Echeverria'>",
  "country": "Chile",
  "region": null,
  "grape_variety": "<grape from name, e.g. 'Cabernet Sauvignon', 'Syrah', 'Merlot', 'Cabernet Sauvignon | Carmenere'>",
  "year": <vintage as integer>,
  "price": <CLEARANCE price as integer>,
  "volume": "750ml",
  "wine_type": "red",
  "category": "wine",
  "spirit_type": null,
  "description": "Regular ฿<unit price> (clearance), min order: <remark text>"
}

ALL items in this list are RED wines from Chile.

Return ONLY JSON: {"items": [...]}.`

export async function parseWineGalleryOffer(
  buffer: Buffer,
  mimeType: string,
  onProgress?: ProgressCb,
): Promise<ExtractionResult> {
  await onProgress?.(20, 'reading offer image')
  const safeMime = mimeType.startsWith('image/') ? mimeType : 'image/jpeg'
  const data = buffer.toString('base64')
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        { type: 'image' as const, source: { type: 'base64' as const, media_type: safeMime as 'image/jpeg' | 'image/png' | 'image/webp', data } },
        { type: 'text' as const, text: OFFER_PROMPT },
      ] as unknown as Anthropic.TextBlockParam[],
    }],
  })
  const raw = res.content[0].type === 'text' ? res.content[0].text : ''
  await onProgress?.(80, 'parsing')
  let items: ExtractedItem[] = []
  try {
    const parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()) as { items: ExtractedItem[] }
    items = parsed.items ?? []
  } catch (e) {
    console.error('[wine-gallery-offer] JSON parse failed:', e instanceof Error ? e.message : e)
  }
  console.log(`[wine-gallery-offer] extracted ${items.length} items`)
  return {
    supplier_name: SUPPLIER_NAME,
    price_list_date: null,
    currency: 'THB',
    items,
  }
}

function inferWineType(name: string, grape: string | null): ExtractedItem['wine_type'] {
  const text = `${name} ${grape ?? ''}`.toLowerCase()
  if (/\bros[eé]\b|rosado|rosato|chiaretto/.test(text)) return 'rose'
  if (/champagne|cremant|crémant|prosecco|cava|spumante|frizzante|sparkling|sekt/.test(text)) return 'sparkling'
  if (/\borange\s+wine\b|skin[\s-]contact|qvevri|kvevri|amphora|ramato/.test(text)) return 'orange'
  // Whites: grape-based heuristics.
  if (/\b(chardonnay|sauvignon\s+blanc|riesling|pinot\s+gr[ie]s|pinot\s+grigio|gew[uü]rztraminer|viognier|chenin|albari[ñn]o|verdejo|sémillon|semillon|gr[uü]ner\s+veltliner|fiano|vermentino|arneis|gavi|trebbiano|ugni\s+blanc|muscat|moscato|melon|aligoté|aligote|verdicchio|garganega|cortese|grillo|catarratto|pecorino)\b/.test(text)) return 'white'
  // Reds: grape-based heuristics.
  if (/\b(cabernet|merlot|pinot\s+noir|pinotage|shiraz|syrah|grenache|garnacha|tempranillo|sangiovese|nebbiolo|barbera|dolcetto|montepulciano|primitivo|aglianico|nero\s+d['’]avola|carmen[eè]re|malbec|mourv[èe]dre|gamay|zinfandel|petite\s+sirah|petit\s+verdot|cab\s+sau|cab\s+franc|petit\s+manseng|tannat)\b/.test(text)) return 'red'
  // Words.
  if (/\b(red|rouge|rosso|tinto)\b/.test(text)) return 'red'
  if (/\b(white|blanc|bianco|blanco|weiss)\b/.test(text)) return 'white'
  return null
}
