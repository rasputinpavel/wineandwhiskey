import type { VivinoResult, VivinoGrape, WineItemRow } from './types'
import { VIVINO_WINE_TYPES, VIVINO_BODY_BUCKETS } from './types'
import { normalizeName } from './normalize'

type NamedRef = string | { name?: string } | null | undefined

export function parseWineType(r: VivinoResult): 'red' | 'white' | 'rose' | 'sparkling' | null {
  if (r.wine_type_id && VIVINO_WINE_TYPES[r.wine_type_id]) return VIVINO_WINE_TYPES[r.wine_type_id]
  // Actor returns capitalized strings like "Red" / "Rosé" in `wine_type`.
  const t = (r.wine_type ?? r.type ?? '').toString().toLowerCase()
  if (t.includes('red')) return 'red'
  if (t.includes('white')) return 'white'
  if (t.includes('ros')) return 'rose'
  if (t.includes('spark') || t.includes('champagne') || t.includes('prosecco')) return 'sparkling'
  return null
}

export function parseGrapes(r: VivinoResult): string | null {
  // Actor's canonical field is `grape_varieties` (string[]); older code passed
  // `grapes` (VivinoGrape[] = string | { name }) — accept both for resilience.
  const list: VivinoGrape[] | undefined = (Array.isArray(r.grape_varieties) ? r.grape_varieties : undefined) as VivinoGrape[] | undefined
                                          ?? r.grapes
  if (!list || list.length === 0) return null
  const names = list.map(g => (typeof g === 'string' ? g : g.name)).filter(Boolean)
  return names.length ? names.join(', ') : null
}

function flatten(v: NamedRef): string | null {
  if (!v) return null
  if (typeof v === 'string') return v.trim() || null
  return v.name?.trim() || null
}

function flattenList(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const x of v) {
    const s = flatten(x as NamedRef)
    if (s) out.push(s)
  }
  return out
}

// Actor's canonical field is `taste_profile.flavor_notes` (string[], typically
// 100+ entries ordered by frequency). We cap at 15 — the rest is noise for UI.
// Older shapes are kept as fallbacks.
const FLAVOR_LIMIT = 15
function extractFlavors(r: VivinoResult): string[] {
  const tp = r.taste_profile
  if (tp && Array.isArray(tp.flavor_notes) && tp.flavor_notes.length) {
    return tp.flavor_notes.slice(0, FLAVOR_LIMIT)
  }
  const candidates: unknown[] = []
  if (r.flavors) candidates.push(r.flavors)
  if (r.flavor_profile) {
    if (Array.isArray(r.flavor_profile)) candidates.push(r.flavor_profile)
    else if (Array.isArray((r.flavor_profile as { flavors?: unknown[] }).flavors)) {
      candidates.push((r.flavor_profile as { flavors: unknown[] }).flavors)
    }
  }
  if (tp && Array.isArray(tp.flavors)) candidates.push(tp.flavors)
  for (const c of candidates) {
    const list = flattenList(c)
    if (list.length) return list.slice(0, FLAVOR_LIMIT)
  }
  return []
}

function extractFoodPairings(r: VivinoResult): string[] {
  if (Array.isArray(r.food_pairings)) {
    const list = flattenList(r.food_pairings)
    if (list.length) return list
  }
  if (Array.isArray(r.food_pairing)) {
    const list = flattenList(r.food_pairing)
    if (list.length) return list
  }
  return []
}

function extractBody(r: VivinoResult): string | null {
  // Numeric bucket from Vivino (1..5) → 'light' | 'medium' | 'full'.
  if (typeof r.body === 'number') return VIVINO_BODY_BUCKETS[Math.round(r.body)] ?? null
  if (typeof r.body === 'string') return r.body.toLowerCase().trim() || null
  // Fallback: taste_profile.body sometimes carries it.
  const tp = r.taste_profile as Record<string, unknown> | undefined
  if (tp) {
    if (typeof tp.body === 'number') return VIVINO_BODY_BUCKETS[Math.round(tp.body as number)] ?? null
    if (typeof tp.body === 'string') return (tp.body as string).toLowerCase().trim() || null
  }
  return null
}

function extractAlcohol(r: VivinoResult): number | null {
  const raw = r.alcohol ?? r.abv
  if (raw == null) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.round(raw * 100) / 100 : null
  // Strings like "13.5%", "13,5", "13.5 %"
  const num = parseFloat(String(raw).replace(',', '.').replace('%', '').trim())
  return Number.isFinite(num) ? Math.round(num * 100) / 100 : null
}

function extractYear(r: VivinoResult): number | null {
  const raw = r.vintage ?? r.year
  if (raw == null) return null
  const num = typeof raw === 'number' ? raw : parseInt(String(raw), 10)
  if (!Number.isFinite(num)) return null
  if (num < 1800 || num > 2100) return null
  return num
}

function extractImages(r: VivinoResult): string[] {
  const out = new Set<string>()
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) out.add(v.trim())
    else if (Array.isArray(v)) for (const x of v) push(x)
  }
  push(r.image_url)
  push(r.images)
  return [...out]
}

function extractRegionHierarchy(r: VivinoResult): {
  country: string | null
  region: string | null
  subregion: string | null
  appellation: string | null
} {
  return {
    country: flatten(r.country as NamedRef),
    region: flatten(r.region as NamedRef),
    subregion: flatten(r.subregion as NamedRef),
    appellation: flatten(r.appellation as NamedRef),
  }
}

function tokenize(s: string): Set<string> {
  return new Set(normalizeName(s).split(' ').filter(t => t.length > 1))
}

// Score how well a Vivino result matches our local item. We jaccard the
// local (name + winery) tokens against the candidate's (name + winery)
// tokens. Combining winery on both sides matters: many Vivino results put
// the brand only in `winery` (e.g. name="Altagracia Red", winery="Eisele
// Vineyard"), while our local name often duplicates the winery prefix
// ("Eisele Vineyard Altagracia"). Without combining, the Altagracia loses
// to "Eisele Vineyard Grappa" by token count.
export function matchConfidence(item: WineItemRow, result: VivinoResult): number {
  const localName = item.name ?? ''
  const localWinery = item.winery ?? ''
  const vivinoName = result.name ?? ''
  const vivinoWinery = flatten(result.winery as NamedRef) ?? ''

  const local = new Set([...tokenize(localName), ...tokenize(localWinery)])
  const vivino = new Set([...tokenize(vivinoName), ...tokenize(vivinoWinery)])
  if (local.size === 0 || vivino.size === 0) return 0

  let overlap = 0
  for (const t of local) if (vivino.has(t)) overlap++
  const jaccard = overlap / new Set([...local, ...vivino]).size

  return Math.round(Math.min(1, jaccard) * 100) / 100
}

// Pick the best candidate from the actor's results for one local item.
// Returns null when no candidate clears MIN_MATCH (treat as not_found).
const MIN_MATCH = 0.5

export function pickBestMatch(item: WineItemRow, candidates: VivinoResult[]): { result: VivinoResult; confidence: number } | null {
  if (candidates.length === 0) return null
  let best: { result: VivinoResult; confidence: number } | null = null
  for (const c of candidates) {
    const conf = matchConfidence(item, c)
    if (!best || conf > best.confidence) {
      best = { result: c, confidence: conf }
    } else if (conf === best.confidence) {
      // Tiebreak by ratings_count — more reviews = more likely the canonical wine.
      const cur = (c.ratings_count ?? 0)
      const prv = (best.result.ratings_count ?? 0)
      if (cur > prv) best = { result: c, confidence: conf }
    }
  }
  if (!best || best.confidence < MIN_MATCH) return null
  return best
}

export type EnrichmentUpdate = {
  vivino_rating: number | null
  vivino_reviews_count: number | null
  vivino_url: string | null
  vivino_image_url: string | null
  vivino_images: string[] | null
  vivino_alcohol: number | null
  vivino_body: string | null
  vivino_flavors: string[] | null
  vivino_food_pairings: string[] | null
  vivino_region_hierarchy: { country: string | null; region: string | null; subregion: string | null; appellation: string | null } | null
  vivino_style: string | null
  vivino_year: number | null
  vivino_enriched_at: string
  vivino_failed_at: null
  vivino_match_confidence: number
  vivino_query: string
  category: 'wine'
  // Conditionally filled (high confidence OR locally empty):
  grape_variety?: string
  winery?: string
  wine_type?: 'red' | 'white' | 'rose' | 'sparkling'
  year?: number
  country?: string
  region?: string
}

const HIGH_CONFIDENCE = 0.7

export function buildEnrichmentUpdate(
  item: WineItemRow,
  result: VivinoResult,
  query: string,
  now: string
): EnrichmentUpdate {
  const grapes = parseGrapes(result)
  const winery = flatten(result.winery as NamedRef)
  const wineType = parseWineType(result)
  const confidence = matchConfidence(item, result)
  const trust = confidence >= HIGH_CONFIDENCE

  const images = extractImages(result)
  const flavors = extractFlavors(result)
  const foods = extractFoodPairings(result)
  const body = extractBody(result)
  const alcohol = extractAlcohol(result)
  const year = extractYear(result)
  const region = extractRegionHierarchy(result)
  const style = flatten(result.style as NamedRef)

  const update: EnrichmentUpdate = {
    vivino_rating: result.average_rating ?? null,
    vivino_reviews_count: result.ratings_count ?? null,
    vivino_url: result.vivino_url ?? null,
    vivino_image_url: images[0] ?? null,
    vivino_images: images.length ? images : null,
    vivino_alcohol: alcohol,
    vivino_body: body,
    vivino_flavors: flavors.length ? flavors : null,
    vivino_food_pairings: foods.length ? foods : null,
    vivino_region_hierarchy: (region.country || region.region || region.subregion || region.appellation) ? region : null,
    vivino_style: style,
    vivino_year: year,
    vivino_enriched_at: now,
    vivino_failed_at: null,
    vivino_match_confidence: Math.round(confidence * 100) / 100,
    vivino_query: query,
    category: 'wine',
  }

  if (grapes && (trust || !item.grape_variety)) update.grape_variety = grapes
  if (winery && (trust || !item.winery)) update.winery = winery
  if (wineType && (trust || !item.wine_type)) update.wine_type = wineType

  // Promote year/country/region into core wine_items columns when local is empty.
  // We're stricter here: only fill, never overwrite — vintage/region from local
  // price lists is usually correct, and overwriting changes filter behavior.
  if (year && !item.year) update.year = year
  if (region.country && !item.country) update.country = region.country
  if (region.region && !item.region) update.region = region.region

  return update
}
