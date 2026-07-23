import { describe, it, expect } from 'vitest'
import { normalizeName, resolveOwner } from './dedup'

describe('normalizeName (must match SQL name_norm)', () => {
  it('lowercases', () => { expect(normalizeName('Kata Rock')).toBe('kata rock') })
  it('collapses internal whitespace', () => { expect(normalizeName('Kata   Rock')).toBe('kata rock') })
  it('trims ends', () => { expect(normalizeName('  Kata Rock  ')).toBe('kata rock') })
  it('normalizes tabs/newlines', () => { expect(normalizeName('Kata\tRock\nCafe')).toBe('kata rock cafe') })
})

describe('resolveOwner', () => {
  it('explicit mine wins (with sales_name)', () => {
    expect(resolveOwner({ paramOwner: 'mine', salesName: 'Grace', isAdmin: false })).toBe('mine')
  })
  it('explicit all wins', () => {
    expect(resolveOwner({ paramOwner: 'all', salesName: 'Grace', isAdmin: false })).toBe('all')
  })
  it('manager with sales_name defaults to mine', () => {
    expect(resolveOwner({ paramOwner: undefined, salesName: 'Grace', isAdmin: false })).toBe('mine')
  })
  it('admin defaults to all', () => {
    expect(resolveOwner({ paramOwner: undefined, salesName: 'Grace', isAdmin: true })).toBe('all')
  })
  it('no sales_name is always all', () => {
    expect(resolveOwner({ paramOwner: undefined, salesName: undefined, isAdmin: false })).toBe('all')
  })
  it('mine is downgraded to all without a sales_name', () => {
    expect(resolveOwner({ paramOwner: 'mine', salesName: undefined, isAdmin: false })).toBe('all')
  })
})
