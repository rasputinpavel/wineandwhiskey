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

describe('buildHtml — untrusted input hardening (render route trusts raw JSON)', () => {
  it('drops a non-http/data imageUrl and never emits an onerror handler', () => {
    const evil: LineItem[] = [{ id: 'x', name: 'Evil', price: 1, zone: 'white',
      imageUrl: 'x" onerror="fetch(String.fromCharCode(47))' }]
    const out = buildHtml({ pages: buildPages(evil, s), settings: s })
    expect(out).not.toContain('onerror')
    // javascript:/breakout scheme is rejected → placeholder, no <img src="x...">
    expect(out).toContain('bottle__ph')
  })
  it('escapes a legitimate http imageUrl into the src attribute', () => {
    const ok: LineItem[] = [{ id: 'x', name: 'Ok', price: 1, zone: 'white',
      imageUrl: 'https://example.com/a.png?q=1&b=2' }]
    const out = buildHtml({ pages: buildPages(ok, s), settings: s })
    expect(out).toContain('src="https://example.com/a.png?q=1&amp;b=2"')
  })
  it('does not interpolate a non-numeric price', () => {
    const bad = [{ id: 'x', name: 'Bad', price: '<script>alert(1)</script>' as unknown as number, zone: 'white' as const }]
    const out = buildHtml({ pages: buildPages(bad, s), settings: s })
    expect(out).not.toContain('<script>alert(1)</script>')
    expect(out).toContain('<span class="price">—</span>')
  })
  it('falls back an unknown zone to white (no attribute breakout)', () => {
    const bad = [{ id: 'x', name: 'Z', price: 1, zone: 'red" onload="alert(1)' as unknown as 'red' }]
    const out = buildHtml({ pages: buildPages(bad, s), settings: s })
    expect(out).not.toContain('onload')
    expect(out).toContain('zone--white')
  })
})
