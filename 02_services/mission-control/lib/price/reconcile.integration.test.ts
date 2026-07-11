import { describe, it, expect } from 'vitest'
import { computeDiff } from './reconcile'
import type { WineItem } from './supabase'
import type { ExtractedItem } from './claude'
import oldItems from './__fixtures__/harvest-old.json'
import newItems from './__fixtures__/harvest-new.json'

describe('Harvest golden fixture', () => {
  const diff = computeDiff(oldItems as unknown as WineItem[], newItems as unknown as ExtractedItem[])
  const count = (k: string) => diff.changes.filter(c => c.kind === k).length

  it('detects the price change on Cabernet (vintage-agnostic match)', () => {
    const cab = diff.changes.find(c => c.existing_id === 'o1')
    expect(cab?.kind).toBe('price_changed')
    expect(cab?.old_price).toBe(300)
    expect(cab?.incoming?.price).toBe(350)
  })
  it('keeps the identical Grape Dance as unchanged', () => {
    expect(diff.changes.find(c => c.existing_id === 'o2')?.kind).toBe('unchanged')
  })
  it('adds the new Nude Saperavi', () => {
    expect(diff.changes.some(c => c.kind === 'added' && c.incoming?.name === 'Nude Saperavi')).toBe(true)
  })
  it('discontinues the delisted wine', () => {
    expect(diff.changes.find(c => c.existing_id === 'o3')?.kind).toBe('discontinued')
  })
  it('produces exactly one change per existing + net-new item', () => {
    expect(count('price_changed') + count('unchanged') + count('discontinued') + count('added')).toBe(diff.changes.length)
  })
})
