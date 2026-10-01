import type { ExtractedItem, SliceQuery, SliceRow, SliceSort } from './types'
import { countKnownGrapes, fold, grapeNeedles } from './grapes'

export type FilterOutcome = {
  /** Прошли всё, включая сорт словом из прайса. */
  explicit: SliceRow[]
  /** Прошли всё, кроме сорта. Материал для LLM-добора по апелласьону. */
  candidates: ExtractedItem[]
}

export function toRow(it: ExtractedItem, match: SliceRow['match'], note: string | null): SliceRow {
  return {
    producer: null,       // заполняется отдельным шагом раскола
    name: it.name,
    region: it.region,
    country: it.country,
    year: it.year,
    price: it.price,
    volume: it.volume,
    match,
    note,
  }
}

/** Позиция без значения НЕ проходит ограничение — «до 600» не должно тащить безценовые. */
function inRange(v: number | null, min: number | null, max: number | null): boolean {
  if (min === null && max === null) return true
  if (v === null) return false
  if (min !== null && v < min) return false
  if (max !== null && v > max) return false
  return true
}

function anyNeedle(needles: string[], haystack: string | null): boolean {
  if (needles.length === 0) return true
  if (!haystack) return false
  const h = fold(haystack)
  return needles.some((n) => h.includes(fold(n)))
}

function join(...parts: (string | null)[]): string | null {
  const s = parts.filter((p): p is string => !!p).join(' · ')
  return s === '' ? null : s
}

/** Все ограничения, кроме сорта. */
function passesNonGrape(it: ExtractedItem, q: SliceQuery): boolean {
  if (q.categories.length > 0 && !(it.category && q.categories.includes(it.category))) return false
  if (q.colors.length > 0 && !(it.wine_type && q.colors.includes(it.wine_type))) return false
  if (!inRange(it.price, q.priceMin, q.priceMax)) return false
  if (!inRange(it.year, q.yearMin, q.yearMax)) return false
  if (q.countries.length > 0 && !anyNeedle(q.countries, join(it.country, it.region))) return false
  if (q.regions.length > 0 && !anyNeedle(q.regions, join(it.region, it.country))) return false
  if (q.text && !anyNeedle([q.text], join(it.name, it.description))) return false
  return true
}

export function applySliceFilter(items: ExtractedItem[], q: SliceQuery): FilterOutcome {
  const explicit: SliceRow[] = []
  const candidates: ExtractedItem[] = []
  const needles = q.grapes.flatMap(grapeNeedles)

  for (const it of items) {
    if (!passesNonGrape(it, q)) continue

    if (needles.length === 0) {
      explicit.push(toRow(it, 'explicit', null))
      continue
    }

    const hay = join(it.grape_variety, it.name)
    if (anyNeedle(needles, hay)) {
      // Бленд определяем ТОЛЬКО по полю сорта: в названиях полно дефисов
      // от топонимов (Pouilly-Fuissé, Saint-Émilion), они не бленды.
      const blend = countKnownGrapes(it.grape_variety) > 1
      explicit.push(toRow(it, 'explicit', blend ? 'бленд' : null))
    } else if (it.category === 'wine') {
      candidates.push(it)
    }
  }

  return { explicit, candidates }
}

export function sortRows(rows: SliceRow[], sort: SliceSort): SliceRow[] {
  const out = [...rows]
  if (sort === 'name') {
    out.sort((a, b) => a.name.localeCompare(b.name))
    return out
  }
  const dir = sort === 'price_desc' ? -1 : 1
  out.sort((a, b) => {
    if (a.price === null && b.price === null) return 0
    if (a.price === null) return 1   // без цены — всегда в конец
    if (b.price === null) return -1
    return (a.price - b.price) * dir
  })
  return out
}
