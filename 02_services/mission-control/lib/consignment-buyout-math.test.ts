import { describe, it, expect } from 'vitest'
import { runOwnedPool, allocateOwnedPlacement } from './consignment-buyout-math'

// Aug 2026 Harvest cycle, Bangkok midnight boundaries.
const START = '2026-08-04T17:00:00.000Z'   // 5 Aug 00:00 Bangkok
const END   = '2026-09-04T17:00:00.000Z'   // 5 Sep 00:00 Bangkok
const BUY28 = '2026-08-27T17:00:00.000Z'   // 28 Aug 00:00 Bangkok

describe('runOwnedPool', () => {
  it('no buyout at all → nothing owned, nothing shielded', () => {
    const r = runOwnedPool([], [{ atIso: '2026-08-20T05:00:00Z', qty: 3 }], START, END)
    expect(r).toEqual({ ownedRemaining: 0, ownedConsumedInWindow: 0, boughtOutInWindow: 0 })
  })

  it('buyout with no sales after it stays whole and leaves consignment stock', () => {
    const r = runOwnedPool([{ atIso: BUY28, qty: 6 }], [], START, END)
    expect(r.ownedRemaining).toBe(6)
    expect(r.boughtOutInWindow).toBe(6)
    expect(r.ownedConsumedInWindow).toBe(0)
  })

  it('a sale BEFORE the buyout is billable — the bottle was still the supplier’s', () => {
    // Signature Saperavi: 1 sold at the till 26 Aug, bought out 28 Aug.
    const r = runOwnedPool(
      [{ atIso: BUY28, qty: 3 }],
      [{ atIso: '2026-08-26T09:11:57Z', qty: 1 }],
      START, END,
    )
    expect(r.ownedConsumedInWindow).toBe(0)   // nothing shielded
    expect(r.ownedRemaining).toBe(3)
  })

  it('sales after the buyout draw from our pool first', () => {
    const r = runOwnedPool(
      [{ atIso: BUY28, qty: 6 }],
      [{ atIso: '2026-08-30T09:00:00Z', qty: 4 }],
      START, END,
    )
    expect(r.ownedConsumedInWindow).toBe(4)
    expect(r.ownedRemaining).toBe(2)
  })

  it('once our pool is empty the supplier is billed again', () => {
    const r = runOwnedPool(
      [{ atIso: BUY28, qty: 2 }],
      [{ atIso: '2026-08-30T09:00:00Z', qty: 5 }],
      START, END,
    )
    expect(r.ownedConsumedInWindow).toBe(2)   // 2 shielded, the other 3 are billable
    expect(r.ownedRemaining).toBe(0)
  })

  it('a same-day sale draws from the pool bought that morning', () => {
    const r = runOwnedPool(
      [{ atIso: BUY28, qty: 2 }],
      [{ atIso: '2026-08-28T04:00:00Z', qty: 2 }],
      START, END,
    )
    expect(r.ownedConsumedInWindow).toBe(2)
    expect(r.ownedRemaining).toBe(0)
  })

  it('a buyout from an earlier cycle still shields sales in this one', () => {
    const r = runOwnedPool(
      [{ atIso: '2026-07-10T17:00:00.000Z', qty: 5 }],
      [
        { atIso: '2026-07-20T09:00:00Z', qty: 2 },   // last cycle — consumed, not counted here
        { atIso: '2026-08-15T09:00:00Z', qty: 1 },   // this cycle
      ],
      START, END,
    )
    expect(r.boughtOutInWindow).toBe(0)        // the buyout is not this cycle's event
    expect(r.ownedConsumedInWindow).toBe(1)
    expect(r.ownedRemaining).toBe(2)
  })

  it('a sale after the window is ignored', () => {
    const r = runOwnedPool(
      [{ atIso: BUY28, qty: 3 }],
      [{ atIso: '2026-09-10T09:00:00Z', qty: 3 }],
      START, END,
    )
    expect(r.ownedRemaining).toBe(3)
    expect(r.ownedConsumedInWindow).toBe(0)
  })

  it('a refund goes back to the consignment pool, never to ours', () => {
    const r = runOwnedPool(
      [{ atIso: BUY28, qty: 2 }],
      [{ atIso: '2026-08-30T09:00:00Z', qty: -1 }],
      START, END,
    )
    expect(r.ownedRemaining).toBe(2)
    expect(r.ownedConsumedInWindow).toBe(0)
  })

  it('a buyout dated after the window has not happened yet', () => {
    const r = runOwnedPool([{ atIso: '2026-09-20T17:00:00.000Z', qty: 4 }], [], START, END)
    expect(r).toEqual({ ownedRemaining: 0, ownedConsumedInWindow: 0, boughtOutInWindow: 0 })
  })
})

describe('allocateOwnedPlacement', () => {
  it('fills invoiced-unpaid first — that is why the bottles were bought out', () => {
    // Victor Dravigny White Brut: 2 bought out, both invoiced to Spice House.
    expect(allocateOwnedPlacement(2, 2, 0)).toEqual({ inTransit: 2, atPartners: 0, inStore: 0 })
  })

  it('then units standing at a partner, then the shelf', () => {
    // Duo Blanc: 6 bought out, 2 out at Family UFO Burgers, 4 still here.
    expect(allocateOwnedPlacement(6, 0, 2)).toEqual({ inTransit: 0, atPartners: 2, inStore: 4 })
  })

  it('splits across all three buckets in order', () => {
    expect(allocateOwnedPlacement(6, 1, 2)).toEqual({ inTransit: 1, atPartners: 2, inStore: 3 })
  })

  it('never claims more than we own even when more stock is out than we bought', () => {
    expect(allocateOwnedPlacement(1, 5, 5)).toEqual({ inTransit: 1, atPartners: 0, inStore: 0 })
  })

  it('nothing owned → nothing placed', () => {
    expect(allocateOwnedPlacement(0, 3, 3)).toEqual({ inTransit: 0, atPartners: 0, inStore: 0 })
  })

  it('treats a negative pool as empty', () => {
    expect(allocateOwnedPlacement(-2, 3, 0)).toEqual({ inTransit: 0, atPartners: 0, inStore: 0 })
  })
})
