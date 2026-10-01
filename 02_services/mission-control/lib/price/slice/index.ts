import type { ExtractedItem, SliceQuery, SliceResult } from './types'
import { applySliceFilter, sortRows } from './filter'
import { inferByAppellation, splitProducer } from './enrich'
import { isEmptyQuery, parseSliceQuery } from './query'

export class EmptyQueryError extends Error {
  constructor() { super('запрос не содержит ни одного ограничения') }
}

/**
 * Полный срез прайса. `query` — либо фраза пользователя (её разберёт модель),
 * либо уже готовый фильтр (для доуточнения: модель второй раз не нужна).
 *
 * Падение любого LLM-шага деградирует результат, но не отменяет его: имя
 * сломавшегося шага попадает в `degraded`, и бот честно это показывает.
 */
export async function sliceItems(
  items: ExtractedItem[],
  query: string | SliceQuery,
): Promise<SliceResult> {
  const degraded: string[] = []

  const q: SliceQuery = typeof query === 'string' ? await parseSliceQuery(query) : query
  if (isEmptyQuery(q)) throw new EmptyQueryError()

  const { explicit, candidates } = applySliceFilter(items, q)

  let inferred: SliceResult['rows'] = []
  try {
    inferred = await inferByAppellation(candidates, q.grapes)
  } catch (e) {
    console.error('[slice] inferByAppellation failed:', e)
    degraded.push('добор по апелласьону')
  }

  let rows = [...explicit, ...inferred]
  if (rows.length > 0) {
    try {
      rows = await splitProducer(rows)
    } catch (e) {
      console.error('[slice] splitProducer failed:', e)
      degraded.push('производитель')
    }
  }

  return {
    query: q,
    rows: sortRows(rows, q.sort),
    totalItems: items.length,
    matched: rows.length,
    degraded,
  }
}

export type { SliceQuery, SliceResult, SliceRow } from './types'
export { coerceSliceQuery, isEmptyQuery, parseSliceQuery } from './query'
