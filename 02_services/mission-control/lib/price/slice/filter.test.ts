import { describe, it, expect } from 'vitest'
import { applySliceFilter, sortRows } from './filter'
import { coerceSliceQuery } from './query'
import type { ExtractedItem, SliceRow } from './types'

function item(over: Partial<ExtractedItem>): ExtractedItem {
  return {
    name: 'Wine', country: null, region: null, grape_variety: null,
    price: null, year: null, volume: null, description: null,
    category: 'wine', wine_type: null,
    ...over,
  }
}

const CHARD = coerceSliceQuery({ grapes: ['chardonnay'] })

describe('applySliceFilter — сорт', () => {
  it('ловит сорт в grape_variety', () => {
    const { explicit } = applySliceFilter([item({ name: 'Mâcon', grape_variety: 'Chardonnay' })], CHARD)
    expect(explicit).toHaveLength(1)
    expect(explicit[0].match).toBe('explicit')
    expect(explicit[0].note).toBeNull()
  })

  it('ловит сорт прямо в названии', () => {
    const { explicit } = applySliceFilter([item({ name: 'Louis Jadot Bourgogne Chardonnay' })], CHARD)
    expect(explicit).toHaveLength(1)
  })

  it('понимает синоним (Pinot Grigio → pinot gris)', () => {
    const q = coerceSliceQuery({ grapes: ['Pinot Gris'] })
    const { explicit } = applySliceFilter([item({ name: 'Santa Margherita Pinot Grigio' })], q)
    expect(explicit).toHaveLength(1)
  })

  it('бленд помечает, но не выбрасывает', () => {
    const { explicit } = applySliceFilter(
      [item({ name: 'Hardys', grape_variety: 'Chardonnay-Semillon' })], CHARD)
    expect(explicit).toHaveLength(1)
    expect(explicit[0].note).toBe('бленд')
  })

  it('не-шардоне уходит в кандидаты на добор', () => {
    const { explicit, candidates } = applySliceFilter(
      [item({ name: 'Domaine Laroche Chablis', region: 'Chablis' })], CHARD)
    expect(explicit).toHaveLength(0)
    expect(candidates).toHaveLength(1)
  })

  it('в кандидаты попадает только вино, не крепкое', () => {
    const { candidates } = applySliceFilter(
      [item({ name: 'Grants Whisky', category: 'spirits' })], CHARD)
    expect(candidates).toHaveLength(0)
  })

  it('пустой список сортов пропускает всё', () => {
    const q = coerceSliceQuery({ priceMax: 1000 })
    const { explicit } = applySliceFilter([item({ name: 'Whatever', price: 500 })], q)
    expect(explicit).toHaveLength(1)
  })
})

describe('applySliceFilter — прочие ограничения', () => {
  it('режет по верхней цене', () => {
    const q = coerceSliceQuery({ grapes: ['chardonnay'], priceMax: 600 })
    const items = [
      item({ name: 'A Chardonnay', price: 500 }),
      item({ name: 'B Chardonnay', price: 900 }),
    ]
    expect(applySliceFilter(items, q).explicit.map((r) => r.name)).toEqual(['A Chardonnay'])
  })

  it('позиция без цены не проходит ценовое ограничение', () => {
    const q = coerceSliceQuery({ grapes: ['chardonnay'], priceMax: 600 })
    expect(applySliceFilter([item({ name: 'A Chardonnay', price: null })], q).explicit).toHaveLength(0)
  })

  it('режет по стране без учёта регистра', () => {
    const q = coerceSliceQuery({ countries: ['france'] })
    const items = [item({ name: 'A', country: 'FRANCE' }), item({ name: 'B', country: 'Italy' })]
    expect(applySliceFilter(items, q).explicit.map((r) => r.name)).toEqual(['A'])
  })

  it('режет по цвету', () => {
    const q = coerceSliceQuery({ colors: ['white'] })
    const items = [
      item({ name: 'W', wine_type: 'white' }),
      item({ name: 'R', wine_type: 'red' }),
    ]
    expect(applySliceFilter(items, q).explicit.map((r) => r.name)).toEqual(['W'])
  })

  it('режет по году', () => {
    const q = coerceSliceQuery({ yearMin: 2021 })
    const items = [item({ name: 'New', year: 2022 }), item({ name: 'Old', year: 2018 })]
    expect(applySliceFilter(items, q).explicit.map((r) => r.name)).toEqual(['New'])
  })

  it('свободный текст ищет в названии и описании', () => {
    const q = coerceSliceQuery({ text: 'organic' })
    const items = [
      item({ name: 'A', description: 'Certified organic' }),
      item({ name: 'B', description: 'Classic' }),
    ]
    expect(applySliceFilter(items, q).explicit.map((r) => r.name)).toEqual(['A'])
  })

  it('регион ищется и по стране (прайсы путают поля)', () => {
    const q = coerceSliceQuery({ regions: ['bourgogne'] })
    const items = [item({ name: 'A', country: 'France Bourgogne' }), item({ name: 'B', country: 'Italy' })]
    expect(applySliceFilter(items, q).explicit.map((r) => r.name)).toEqual(['A'])
  })

  it('строка переносит объём и цену без изменений', () => {
    const { explicit } = applySliceFilter(
      [item({ name: 'A Chardonnay', price: 1180, volume: '750ml', year: 2022 })], CHARD)
    expect(explicit[0]).toMatchObject({ price: 1180, volume: '750ml', year: 2022, producer: null })
  })
})

describe('sortRows', () => {
  const row = (name: string, price: number | null): SliceRow => ({
    producer: null, name, region: null, country: null, year: null,
    price, volume: null, match: 'explicit', note: null,
  })

  it('по цене от дешёвых, без цены — в конец', () => {
    const out = sortRows([row('b', 900), row('nil', null), row('a', 500)], 'price_asc')
    expect(out.map((r) => r.name)).toEqual(['a', 'b', 'nil'])
  })

  it('по цене от дорогих, без цены — в конец', () => {
    const out = sortRows([row('a', 500), row('nil', null), row('b', 900)], 'price_desc')
    expect(out.map((r) => r.name)).toEqual(['b', 'a', 'nil'])
  })

  it('по названию', () => {
    const out = sortRows([row('Beta', 1), row('Alpha', 2)], 'name')
    expect(out.map((r) => r.name)).toEqual(['Alpha', 'Beta'])
  })

  it('не мутирует вход', () => {
    const input = [row('b', 900), row('a', 500)]
    sortRows(input, 'price_asc')
    expect(input.map((r) => r.name)).toEqual(['b', 'a'])
  })
})
