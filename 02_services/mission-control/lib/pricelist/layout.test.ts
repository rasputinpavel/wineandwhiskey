import { describe, it, expect } from 'vitest'
import { buildPages } from './layout'
import type { LineItem, PageSettings } from './types'

function item(id: string, over: Partial<LineItem> = {}): LineItem {
  return { id, name: `Wine ${id}`, price: 500, zone: 'white', ...over }
}

const base: PageSettings = {
  title: 'Test', grouping: 'manual', showDividers: false,
  tierThresholds: [600, 1000], oddItemMode: 'solo-wide',
  headerContact: '', vatNote: '', cardsPerPage: 14,
}

describe('buildPages — packing', () => {
  it('packs an even manual list into pair rows, no dividers', () => {
    const pages = buildPages([item('a'), item('b'), item('c'), item('d')], base)
    expect(pages).toHaveLength(1)
    expect(pages[0].rows).toEqual([
      { kind: 'pair', items: [expect.objectContaining({ id: 'a' }), expect.objectContaining({ id: 'b' })] },
      { kind: 'pair', items: [expect.objectContaining({ id: 'c' }), expect.objectContaining({ id: 'd' })] },
    ])
  })

  it('turns a trailing odd item into solo-wide by default', () => {
    const pages = buildPages([item('a'), item('b'), item('c')], base)
    const rows = pages[0].rows
    expect(rows[0].kind).toBe('pair')
    expect(rows[1]).toEqual({ kind: 'solo-wide', item: expect.objectContaining({ id: 'c' }) })
  })

  it('keeps a trailing odd item as a half-width lone pair when oddItemMode=tight', () => {
    const pages = buildPages([item('a'), item('b'), item('c')], { ...base, oddItemMode: 'tight' })
    const last = pages[0].rows[1]
    expect(last.kind).toBe('pair')
    // tight mode leaves the right slot empty (null placeholder)
    expect((last as any).items[1]).toBeNull()
  })

  it('honours a per-item rowLayout override', () => {
    const pages = buildPages([item('a', { rowLayout: 'solo-wide' }), item('b'), item('c')], base)
    expect(pages[0].rows[0]).toEqual({ kind: 'solo-wide', item: expect.objectContaining({ id: 'a' }) })
    expect(pages[0].rows[1]).toEqual({ kind: 'pair', items: [expect.objectContaining({ id: 'b' }), expect.objectContaining({ id: 'c' })] })
  })
})

describe('buildPages — grouping', () => {
  it('groups by type and emits a divider per group when showDividers', () => {
    const items = [item('a', { zone: 'white' }), item('b', { zone: 'red' }), item('c', { zone: 'white' })]
    const pages = buildPages(items, { ...base, grouping: 'type', showDividers: true })
    const kinds = pages[0].rows.map(r => r.kind)
    expect(kinds[0]).toBe('divider')
    // white group (a, c) then red group (b), each preceded by a divider
    expect(pages[0].rows.filter(r => r.kind === 'divider')).toHaveLength(2)
  })

  it('buckets by tier thresholds', () => {
    const items = [item('cheap', { price: 400 }), item('mid', { price: 800 }), item('lux', { price: 1500 })]
    const pages = buildPages(items, { ...base, grouping: 'tier', showDividers: true })
    const labels = pages[0].rows.filter(r => r.kind === 'divider').map(r => (r as any).label)
    expect(labels).toHaveLength(3)
  })
})

describe('buildPages — pagination', () => {
  it('flows rows onto multiple pages at cardsPerPage', () => {
    const items = Array.from({ length: 30 }, (_, i) => item(String(i)))
    const pages = buildPages(items, { ...base, cardsPerPage: 14 })
    expect(pages.length).toBeGreaterThan(1)
  })

  it('never orphans a divider at the end of a page', () => {
    const items = [
      ...Array.from({ length: 13 }, (_, i) => item(`w${i}`, { zone: 'white' })),
      item('r0', { zone: 'red' }), item('r1', { zone: 'red' }),
    ]
    const pages = buildPages(items, { ...base, grouping: 'type', showDividers: true, cardsPerPage: 14 })
    for (const p of pages) {
      expect(p.rows[p.rows.length - 1].kind).not.toBe('divider')
    }
  })
})
