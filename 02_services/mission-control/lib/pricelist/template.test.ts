import { describe, it, expect } from 'vitest'
import { buildHtml } from './template'
import { buildPages } from './layout'
import type { LineItem, PageSettings } from './types'

const s: PageSettings = {
  title: 'W&W', grouping: 'manual', showDividers: false, tierThresholds: [600, 1000],
  oddItemMode: 'solo-wide', headerContact: 'WhatsApp · Irina', vatNote: '7% VAT NOT INCLUDED',
  cardsPerPage: 14,
}
const items: LineItem[] = [
  { id: 'a', name: 'TENUTA MERLOT', price: 540, zone: 'red', country: 'ITALY', region: 'VENEZIA DOC', grape: 'MERLOT' },
  { id: 'b', name: 'PINOT GRIGIO', price: 540, zone: 'white', country: 'ITALY', grape: 'PINOT GRIGIO 100%' },
  { id: 'c', name: 'ARISTOV RIESLING', price: 610, zone: 'white', country: 'RUSSIA' },
]

describe('buildHtml', () => {
  const html = buildHtml({ pages: buildPages(items, s), settings: s })
  it('is a full document with the brand fonts', () => {
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('Bebas Neue')
  })
  it('renders the VAT footer and each wine name', () => {
    expect(html).toContain('7% VAT NOT INCLUDED')
    expect(html).toContain('TENUTA MERLOT')
    expect(html).toContain('ARISTOV RIESLING')
  })
  it('renders the price with a .- suffix', () => {
    expect(html).toContain('540')
    expect(html).toContain('.-')
  })
  it('renders a solo-wide card for the odd third item', () => {
    expect(html).toContain('card--wide')
  })
})
