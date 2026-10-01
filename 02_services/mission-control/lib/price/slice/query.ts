import type { Category, SliceQuery, SliceSort, WineColor } from './types'
import { normalizeGrape } from './grapes'

const COLORS: readonly string[] = ['red', 'white', 'rose', 'orange', 'sparkling']
const CATEGORIES: readonly string[] = ['wine', 'spirits', 'beer', 'other']
const SORTS: readonly string[] = ['price_asc', 'price_desc', 'name']

export const EMPTY_QUERY: SliceQuery = {
  grapes: [], colors: [], countries: [], regions: [], categories: [],
  priceMin: null, priceMax: null, yearMin: null, yearMax: null,
  sort: 'price_asc', text: null,
}

function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    .map((x) => x.trim().toLowerCase())
}

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const cleaned = v.replace(/[^\d.-]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/** Приводит что угодно (в том числе ответ модели) к валидному SliceQuery. */
export function coerceSliceQuery(raw: unknown): SliceQuery {
  const o = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    grapes:     strList(o.grapes).map(normalizeGrape),
    colors:     strList(o.colors).filter((c): c is WineColor => COLORS.includes(c)),
    countries:  strList(o.countries),
    regions:    strList(o.regions),
    categories: strList(o.categories).filter((c): c is Category => CATEGORIES.includes(c)),
    priceMin:   num(o.priceMin),
    priceMax:   num(o.priceMax),
    yearMin:    num(o.yearMin),
    yearMax:    num(o.yearMax),
    sort:       SORTS.includes(String(o.sort)) ? (o.sort as SliceSort) : 'price_asc',
    text:       typeof o.text === 'string' && o.text.trim() !== '' ? o.text.trim() : null,
  }
}

/** Ни одного ограничения — резать нечего, бот просит переформулировать. */
export function isEmptyQuery(q: SliceQuery): boolean {
  return q.grapes.length === 0
    && q.colors.length === 0
    && q.countries.length === 0
    && q.regions.length === 0
    && q.categories.length === 0
    && q.priceMin === null && q.priceMax === null
    && q.yearMin === null && q.yearMax === null
    && q.text === null
}
