import { describe, it, expect } from 'vitest'
import { normalizeName, resolveOwner, resolveOwnerFilter, UNASSIGNED } from './dedup'

describe('normalizeName (must match SQL name_norm)', () => {
  it('lowercases', () => { expect(normalizeName('Kata Rock')).toBe('kata rock') })
  it('collapses internal whitespace', () => { expect(normalizeName('Kata   Rock')).toBe('kata rock') })
  it('trims ends', () => { expect(normalizeName('  Kata Rock  ')).toBe('kata rock') })
  it('normalizes tabs/newlines', () => { expect(normalizeName('Kata\tRock\nCafe')).toBe('kata rock cafe') })
  it('folds non-ASCII spaces (NBSP, narrow-NBSP, ideographic) like the SQL translate()', () => {
    expect(normalizeName('Kata Rock')).toBe('kata rock')
    expect(normalizeName('Kata Rock')).toBe('kata rock')
    expect(normalizeName('Kata　Rock')).toBe('kata rock')
  })
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

describe('resolveOwnerFilter', () => {
  it('a picked person wins over the My/All toggle', () => {
    expect(resolveOwnerFilter({ paramOwner: 'mine', paramAssignee: 'Irina', salesName: 'Grace' }))
      .toEqual({ kind: 'person', name: 'Irina' })
  })
  it('the unassigned sentinel asks for leads with no owner', () => {
    expect(resolveOwnerFilter({ paramAssignee: UNASSIGNED, salesName: 'Grace' }))
      .toEqual({ kind: 'unassigned' })
  })
  it('falls back to the toggle: a manager sees their own leads', () => {
    expect(resolveOwnerFilter({ salesName: 'Grace', isAdmin: false }))
      .toEqual({ kind: 'person', name: 'Grace' })
  })
  it('falls back to the toggle: an admin sees everyone', () => {
    expect(resolveOwnerFilter({ salesName: 'Grace', isAdmin: true })).toEqual({ kind: 'all' })
  })
  it('an empty pick means everyone', () => {
    expect(resolveOwnerFilter({ paramOwner: 'all', paramAssignee: '', salesName: 'Grace' }))
      .toEqual({ kind: 'all' })
  })
  it('ignores a whitespace-only pick', () => {
    expect(resolveOwnerFilter({ paramAssignee: '   ', salesName: undefined })).toEqual({ kind: 'all' })
  })
})
