import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExtractedItem, SliceRow } from './types'

const askJson = vi.fn()
vi.mock('./llm', () => ({
  askJson: (...args: unknown[]) => askJson(...args),
  SliceLlmError: class extends Error {},
  SLICE_MODEL: 'test-model',
}))

const { inferByAppellation, splitProducer, BATCH_SIZE } = await import('./enrich')

function item(over: Partial<ExtractedItem>): ExtractedItem {
  return {
    name: 'Wine', country: null, region: null, grape_variety: null,
    price: null, year: null, volume: null, description: null,
    category: 'wine', wine_type: null,
    ...over,
  }
}

function row(name: string): SliceRow {
  return {
    producer: null, name, region: null, country: null, year: null,
    price: null, volume: null, match: 'explicit', note: null,
  }
}

beforeEach(() => askJson.mockReset())

describe('inferByAppellation', () => {
  it('без сортов в запросе модель не зовётся', async () => {
    const out = await inferByAppellation([item({ name: 'Chablis' })], [])
    expect(out).toEqual([])
    expect(askJson).not.toHaveBeenCalled()
  })

  it('отобранные позиции помечает inferred с основанием', async () => {
    askJson.mockResolvedValue({ hits: [{ i: 0, why: 'Chablis' }] })
    const out = await inferByAppellation(
      [item({ name: 'Domaine Laroche Chablis' }), item({ name: 'Rioja Tinto' })],
      ['chardonnay'],
    )
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('Domaine Laroche Chablis')
    expect(out[0].match).toBe('inferred')
    expect(out[0].note).toBe('Chablis')
  })

  it('индексы вне диапазона игнорирует', async () => {
    askJson.mockResolvedValue({ hits: [{ i: 99, why: 'ерунда' }] })
    const out = await inferByAppellation([item({ name: 'Chablis' })], ['chardonnay'])
    expect(out).toEqual([])
  })

  it('пустое основание заменяет на «по апелласьону»', async () => {
    askJson.mockResolvedValue({ hits: [{ i: 0, why: '' }] })
    const out = await inferByAppellation([item({ name: 'Meursault' })], ['chardonnay'])
    expect(out[0].note).toBe('по апелласьону')
  })

  it('режет на батчи', async () => {
    askJson.mockResolvedValue({ hits: [] })
    const many = Array.from({ length: BATCH_SIZE + 1 }, (_, i) => item({ name: `W${i}` }))
    await inferByAppellation(many, ['chardonnay'])
    expect(askJson).toHaveBeenCalledTimes(2)
  })
})

describe('splitProducer', () => {
  it('пустой список модель не зовёт', async () => {
    expect(await splitProducer([])).toEqual([])
    expect(askJson).not.toHaveBeenCalled()
  })

  it('раскладывает производителя и название', async () => {
    askJson.mockResolvedValue({
      rows: [{ i: 0, producer: 'Louis Jadot', name: 'Bourgogne Chardonnay' }],
    })
    const out = await splitProducer([row('Louis Jadot Bourgogne Chardonnay')])
    expect(out[0].producer).toBe('Louis Jadot')
    expect(out[0].name).toBe('Bourgogne Chardonnay')
  })

  it('не теряет строки, которых модель не вернула', async () => {
    askJson.mockResolvedValue({ rows: [{ i: 0, producer: 'A', name: 'B' }] })
    const out = await splitProducer([row('A B'), row('Untouched')])
    expect(out).toHaveLength(2)
    expect(out[1]).toMatchObject({ producer: null, name: 'Untouched' })
  })

  it('пустое название от модели не затирает исходное', async () => {
    askJson.mockResolvedValue({ rows: [{ i: 0, producer: 'A', name: '' }] })
    const out = await splitProducer([row('A B')])
    expect(out[0].name).toBe('A B')
    expect(out[0].producer).toBe('A')
  })
})
