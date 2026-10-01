import { describe, it, expect } from 'vitest'
import { fold, normalizeGrape, grapeNeedles, countKnownGrapes } from './grapes'

describe('fold', () => {
  it('убирает диакритику и регистр', () => {
    expect(fold('Albariño')).toBe('albarino')
    expect(fold('  Gewürztraminer  ')).toBe('gewurztraminer')
  })
  it('сжимает пробелы', () => {
    expect(fold('Pinot   Grigio')).toBe('pinot grigio')
  })
})

describe('normalizeGrape', () => {
  it('сводит синонимы к канону', () => {
    expect(normalizeGrape('Pinot Grigio')).toBe('pinot gris')
    expect(normalizeGrape('Shiraz')).toBe('syrah')
    expect(normalizeGrape('Primitivo')).toBe('zinfandel')
  })
  it('незнакомый сорт оставляет как есть', () => {
    expect(normalizeGrape('Saperavi')).toBe('saperavi')
  })
})

describe('grapeNeedles', () => {
  it('отдаёт все синонимы канона', () => {
    expect(grapeNeedles('pinot gris')).toContain('pinot grigio')
  })
  it('для незнакомого сорта — он сам', () => {
    expect(grapeNeedles('saperavi')).toEqual(['saperavi'])
  })
})

describe('countKnownGrapes', () => {
  it('моносорт — один', () => {
    expect(countKnownGrapes('Chardonnay')).toBe(1)
  })
  it('бленд — больше одного', () => {
    expect(countKnownGrapes('Chardonnay-Semillon')).toBe(2)
  })
  it('Cabernet Franc не засчитывается как Cabernet Sauvignon', () => {
    expect(countKnownGrapes('Cabernet Franc')).toBe(1)
  })
  it('пусто — ноль', () => {
    expect(countKnownGrapes(null)).toBe(0)
  })
})
