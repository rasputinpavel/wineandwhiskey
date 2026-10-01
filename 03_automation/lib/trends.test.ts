import { describe, it, expect } from 'vitest'
import { isHit, isFreshForDigest, multiple } from './trends'

describe('multiple', () => {
  it('is views divided by followers', () => {
    expect(multiple(100_000, 10_000)).toBe(10)
  })

  it('is 0 when the follower count is missing or zero', () => {
    expect(multiple(100_000, null)).toBe(0)
    expect(multiple(100_000, 0)).toBe(0)
    expect(multiple(100_000, undefined)).toBe(0)
  })
})

describe('isHit', () => {
  it('accepts a reel exactly on both thresholds', () => {
    // 50_000 views from 10_000 followers is exactly 5x and exactly the floor
    expect(isHit(50_000, 10_000)).toBe(true)
  })

  it('rejects a reel one view under the floor', () => {
    expect(isHit(49_999, 1_000)).toBe(false)
  })

  it('rejects a reel just under the multiple', () => {
    // 4.9x, well over the floor — routine output of a large account
    expect(isHit(245_000, 50_000)).toBe(false)
  })

  it('rejects a tiny account that cannot clear the floor', () => {
    // 10x, but 3_000 views is noise
    expect(isHit(3_000, 300)).toBe(false)
  })

  it('never fires when the follower count is unknown', () => {
    expect(isHit(1_000_000, null)).toBe(false)
  })
})

describe('isFreshForDigest', () => {
  const now = new Date('2026-10-01T09:00:00Z')

  it('notifies a reel published 13 days ago', () => {
    expect(isFreshForDigest('2026-09-18T09:00:00Z', now)).toBe(true)
  })

  it('skips a reel published 15 days ago', () => {
    expect(isFreshForDigest('2026-09-16T09:00:00Z', now)).toBe(false)
  })

  it('treats a future timestamp as fresh rather than dropping it', () => {
    // Instagram timestamps occasionally land slightly ahead of our clock
    expect(isFreshForDigest('2026-10-01T11:00:00Z', now)).toBe(true)
  })

  it('skips a missing or unparseable date', () => {
    expect(isFreshForDigest(null, now)).toBe(false)
    expect(isFreshForDigest('не дата', now)).toBe(false)
  })
})
