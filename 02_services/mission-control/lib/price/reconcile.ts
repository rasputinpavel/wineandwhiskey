// Pure catalog-reconciliation logic: compare a freshly parsed price list against
// a supplier's current active items and produce a reviewable diff. No I/O here.
import type { ExtractedItem } from './claude'
import type { WineItem } from './supabase'

export function normalizeName(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[’']/g, '')                              // elide apostrophes (d'Or -> dor)
    .replace(/\b\d{4}\b/g, ' ')                        // drop vintage year tokens
    .replace(/[^a-z0-9]+/g, ' ')                       // punctuation -> space
    .trim()
    .replace(/\s+/g, ' ')
}

export function canonicalVolume(volume: string | null | undefined): string {
  if (!volume) return '750'
  const v = volume.toLowerCase().replace(/\s+/g, '')
  const l = v.match(/^([\d.]+)l$/)                     // e.g. 0.75l
  if (l) return String(Math.round(parseFloat(l[1]) * 1000))
  const ml = v.match(/(\d+)ml/)                        // e.g. 750ml
  if (ml) return ml[1]
  const bare = v.match(/^(\d+)$/)
  return bare ? bare[1] : '750'
}

export function matchKey(name: string, volume: string | null | undefined): string {
  return `${normalizeName(name)}|${canonicalVolume(volume)}`
}

export type DiffKind =
  | 'added' | 'price_changed' | 'updated' | 'unchanged'
  | 'discontinued' | 'reactivated' | 'ambiguous'

// Comparable fields of an existing catalog row, snapshotted into the diff so the
// review screen can render a full before → after without a second DB read.
export type ItemSnapshot = {
  name: string
  price: number | null
  year: number | null
  volume: string | null
  description: string | null
  grape_variety: string | null
  region: string | null
  country: string | null
  wine_type: string | null
}

export type DiffChange = {
  kind: DiffKind
  match_key: string
  existing_id: string | null        // null for 'added'
  existing_name: string | null
  old_price: number | null
  existing: ItemSnapshot | null      // 'before' snapshot; null for 'added'
  incoming: ExtractedItem | null     // 'after'; null for 'discontinued'
  // ambiguous only: candidate existing items the user can bind to
  candidates?: { id: string; name: string; price: number | null; snapshot: ItemSnapshot }[]
  changed_fields?: string[]          // for 'updated'
}

export type CatalogDiff = {
  supplier_name: string | null
  changes: DiffChange[]
}

// Trigram similarity (Dice coefficient over 3-grams of the normalized name).
function trigrams(s: string): Set<string> {
  const p = `  ${s} `
  const g = new Set<string>()
  for (let i = 0; i < p.length - 2; i++) g.add(p.slice(i, i + 3))
  return g
}
export function similarity(a: string, b: string): number {
  const A = trigrams(a), B = trigrams(b)
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const g of A) if (B.has(g)) inter++
  return (2 * inter) / (A.size + B.size)
}
const FUZZY_THRESHOLD = 0.5

const ATTR_FIELDS: (keyof ExtractedItem)[] =
  ['description', 'grape_variety', 'region', 'country', 'year', 'wine_type', 'volume']

function attrDiff(existing: WineItem, incoming: ExtractedItem): string[] {
  const changed: string[] = []
  for (const f of ATTR_FIELDS) {
    const a = (existing as Record<string, unknown>)[f] ?? null
    const b = (incoming as Record<string, unknown>)[f] ?? null
    if (String(a) !== String(b)) changed.push(f)
  }
  return changed
}

export function computeDiff(existing: WineItem[], incoming: ExtractedItem[]): CatalogDiff {
  const changes: DiffChange[] = []
  const byKey = new Map<string, WineItem>()
  for (const e of existing) byKey.set(e.match_key ?? matchKey(e.name, e.volume), e)
  const matched = new Set<string>() // existing ids consumed

  const leftover: ExtractedItem[] = []
  for (const inc of incoming) {
    const key = matchKey(inc.name, inc.volume)
    const hit = byKey.get(key)
    if (hit && !matched.has(hit.id)) {
      matched.add(hit.id)
      if (hit.status === 'discontinued') {
        changes.push(mk('reactivated', key, hit, inc))
      } else if ((hit.price ?? null) !== (inc.price ?? null)) {
        changes.push(mk('price_changed', key, hit, inc))
      } else {
        const cf = attrDiff(hit, inc)
        changes.push(cf.length ? { ...mk('updated', key, hit, inc), changed_fields: cf }
                               : mk('unchanged', key, hit, inc))
      }
    } else {
      leftover.push(inc)
    }
  }

  const unmatchedExisting = existing.filter(e => !matched.has(e.id))

  // Try to fuzzy-bind each leftover incoming item to an unmatched existing one.
  const stillNew: ExtractedItem[] = []
  const boundExisting = new Set<string>()
  for (const inc of leftover) {
    const incNorm = normalizeName(inc.name)
    const cands = unmatchedExisting
      .filter(e => !boundExisting.has(e.id))
      .map(e => ({ e, score: similarity(incNorm, normalizeName(e.name)) }))
      .filter(x => x.score >= FUZZY_THRESHOLD)
      .sort((a, b) => b.score - a.score)
    if (cands.length > 0) {
      cands.forEach(c => boundExisting.add(c.e.id))
      changes.push({
        kind: 'ambiguous', match_key: matchKey(inc.name, inc.volume),
        existing_id: null, existing_name: null, old_price: null, existing: null, incoming: inc,
        candidates: cands.map(c => ({ id: c.e.id, name: c.e.name, price: c.e.price, snapshot: snap(c.e) })),
      })
    } else {
      stillNew.push(inc)
    }
  }

  for (const inc of stillNew) changes.push(mk('added', matchKey(inc.name, inc.volume), null, inc))
  for (const e of unmatchedExisting) {
    if (boundExisting.has(e.id)) continue // reserved for an ambiguous decision
    if (e.status === 'discontinued') continue // already gone, no change
    changes.push(mk('discontinued', e.match_key ?? matchKey(e.name, e.volume), e, null))
  }

  return { supplier_name: existing[0]?.supplier_name ?? incoming[0]?.name ?? null, changes }
}

function snap(e: WineItem): ItemSnapshot {
  return {
    name: e.name, price: e.price, year: e.year, volume: e.volume,
    description: e.description, grape_variety: e.grape_variety,
    region: e.region, country: e.country, wine_type: e.wine_type,
  }
}

function mk(kind: DiffKind, key: string, e: WineItem | null, inc: ExtractedItem | null): DiffChange {
  return {
    kind, match_key: key,
    existing_id: e?.id ?? null, existing_name: e?.name ?? null,
    old_price: e?.price ?? null, existing: e ? snap(e) : null, incoming: inc,
  }
}
