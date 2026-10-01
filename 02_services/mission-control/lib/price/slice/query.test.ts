import { describe, it, expect } from 'vitest'
import { coerceSliceQuery, isEmptyQuery, EMPTY_QUERY } from './query'

describe('coerceSliceQuery', () => {
  it('нормализует сорта к канону', () => {
    const q = coerceSliceQuery({ grapes: ['Pinot Grigio', ' chardonnay '] })
    expect(q.grapes).toEqual(['pinot gris', 'chardonnay'])
  })

  it('отбрасывает неизвестные цвета и категории', () => {
    const q = coerceSliceQuery({ colors: ['white', 'purple'], categories: ['wine', 'cheese'] })
    expect(q.colors).toEqual(['white'])
    expect(q.categories).toEqual(['wine'])
  })

  it('числа принимает строками с мусором', () => {
    const q = coerceSliceQuery({ priceMax: '฿600', yearMin: '2020' })
    expect(q.priceMax).toBe(600)
    expect(q.yearMin).toBe(2020)
  })

  it('нечисловое в цене даёт null', () => {
    expect(coerceSliceQuery({ priceMax: 'дорого' }).priceMax).toBeNull()
  })

  it('сортировка по умолчанию — от дешёвых', () => {
    expect(coerceSliceQuery({}).sort).toBe('price_asc')
    expect(coerceSliceQuery({ sort: 'что-то' }).sort).toBe('price_asc')
    expect(coerceSliceQuery({ sort: 'price_desc' }).sort).toBe('price_desc')
  })

  it('мусор вместо объекта не роняет', () => {
    expect(coerceSliceQuery(null)).toEqual(EMPTY_QUERY)
    expect(coerceSliceQuery('привет')).toEqual(EMPTY_QUERY)
  })

  it('пустой text становится null', () => {
    expect(coerceSliceQuery({ text: '   ' }).text).toBeNull()
  })
})

describe('isEmptyQuery', () => {
  it('запрос без единого ограничения — пустой', () => {
    expect(isEmptyQuery(coerceSliceQuery({ sort: 'price_desc' }))).toBe(true)
  })
  it('запрос с сортом — не пустой', () => {
    expect(isEmptyQuery(coerceSliceQuery({ grapes: ['chardonnay'] }))).toBe(false)
  })
  it('запрос только с ценой — не пустой', () => {
    expect(isEmptyQuery(coerceSliceQuery({ priceMax: 600 }))).toBe(false)
  })
})
