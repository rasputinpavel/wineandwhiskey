import { describe, it, expect } from 'vitest'
import { rowsToLineItems, typeToZone } from './import'

describe('typeToZone', () => {
  it('maps synonyms to plaque zones', () => {
    expect(typeToZone('White')).toBe('white')
    expect(typeToZone('красное')).toBe('red')
    expect(typeToZone('sparkling')).toBe('sparkling')
    expect(typeToZone('игристое')).toBe('sparkling')
    expect(typeToZone('whisky')).toBe('spirits')
    expect(typeToZone('rosé')).toBe('rose')
  })
  it('defaults unknown to white', () => {
    expect(typeToZone('xyz')).toBe('white')
  })
})

describe('rowsToLineItems', () => {
  it('fuzzy-matches headers case-insensitively', () => {
    const { items } = rowsToLineItems([
      { Name: 'Merlot', Price: '540', Type: 'red', Country: 'Italy', Region: 'Venezia', Grape: 'Merlot' },
    ])
    expect(items[0]).toMatchObject({ name: 'Merlot', price: 540, zone: 'red', country: 'Italy', region: 'Venezia', grape: 'Merlot' })
  })
  it('flags rows missing name or price', () => {
    const { items, report } = rowsToLineItems([
      { name: '', price: '500' },
      { name: 'Ok', price: '' },
    ])
    expect(items).toHaveLength(2)
    expect(report.missingName).toBe(1)
    expect(report.missingPrice).toBe(1)
  })
  it('assigns stable ids', () => {
    const { items } = rowsToLineItems([{ name: 'A', price: '1' }, { name: 'B', price: '2' }])
    expect(items[0].id).not.toBe(items[1].id)
  })
})
