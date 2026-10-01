import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExtractedItem } from './types'

const parseSliceQuery = vi.fn()
const inferByAppellation = vi.fn()
const splitProducer = vi.fn()

vi.mock('./query', async () => {
  const actual = await vi.importActual<typeof import('./query')>('./query')
  return { ...actual, parseSliceQuery: (...a: unknown[]) => parseSliceQuery(...a) }
})
vi.mock('./enrich', () => ({
  inferByAppellation: (...a: unknown[]) => inferByAppellation(...a),
  splitProducer: (...a: unknown[]) => splitProducer(...a),
  BATCH_SIZE: 100,
}))

const { sliceItems, EmptyQueryError } = await import('./index')
const { coerceSliceQuery } = await import('./query')

function item(over: Partial<ExtractedItem>): ExtractedItem {
  return {
    name: 'Wine', country: null, region: null, grape_variety: null,
    price: null, year: null, volume: null, description: null,
    category: 'wine', wine_type: null,
    ...over,
  }
}

beforeEach(() => {
  parseSliceQuery.mockReset()
  inferByAppellation.mockReset()
  splitProducer.mockReset()
  parseSliceQuery.mockResolvedValue(coerceSliceQuery({ grapes: ['chardonnay'] }))
  inferByAppellation.mockResolvedValue([])
  splitProducer.mockImplementation(async (rows: unknown) => rows)
})

const ITEMS = [
  item({ name: 'B Chardonnay', price: 900 }),
  item({ name: 'A Chardonnay', price: 500 }),
  item({ name: 'Rioja Tinto', price: 400 }),
]

describe('sliceItems', () => {
  it('отдаёт отсортированный срез и счётчики', async () => {
    const res = await sliceItems(ITEMS, 'все шардоне')
    expect(res.rows.map((r) => r.name)).toEqual(['A Chardonnay', 'B Chardonnay'])
    expect(res.matched).toBe(2)
    expect(res.totalItems).toBe(3)
    expect(res.degraded).toEqual([])
  })

  it('доборные строки попадают в выдачу', async () => {
    inferByAppellation.mockResolvedValue([{
      producer: null, name: 'Chablis', region: null, country: null,
      year: null, price: 700, volume: null, match: 'inferred', note: 'Chablis',
    }])
    const res = await sliceItems(ITEMS, 'все шардоне')
    expect(res.rows.map((r) => r.name)).toEqual(['A Chardonnay', 'Chablis', 'B Chardonnay'])
    expect(res.matched).toBe(3)
  })

  it('падение добора оставляет точные строки и пишет в degraded', async () => {
    inferByAppellation.mockRejectedValue(new Error('модель легла'))
    const res = await sliceItems(ITEMS, 'все шардоне')
    expect(res.rows).toHaveLength(2)
    expect(res.degraded).toEqual(['добор по апелласьону'])
  })

  it('падение раскола оставляет названия целиком и пишет в degraded', async () => {
    splitProducer.mockRejectedValue(new Error('модель легла'))
    const res = await sliceItems(ITEMS, 'все шардоне')
    expect(res.rows).toHaveLength(2)
    expect(res.rows[0].producer).toBeNull()
    expect(res.degraded).toEqual(['производитель'])
  })

  it('пустой срез не зовёт раскол', async () => {
    parseSliceQuery.mockResolvedValue(coerceSliceQuery({ grapes: ['saperavi'] }))
    const res = await sliceItems(ITEMS, 'всё саперави')
    expect(res.rows).toEqual([])
    expect(splitProducer).not.toHaveBeenCalled()
  })

  it('нераспознанная фраза — EmptyQueryError', async () => {
    parseSliceQuery.mockResolvedValue(coerceSliceQuery({}))
    await expect(sliceItems(ITEMS, 'бла бла')).rejects.toBeInstanceOf(EmptyQueryError)
  })

  it('готовый фильтр используется без обращения к модели', async () => {
    const res = await sliceItems(ITEMS, coerceSliceQuery({ grapes: ['chardonnay'] }))
    expect(parseSliceQuery).not.toHaveBeenCalled()
    expect(res.matched).toBe(2)
  })
})
