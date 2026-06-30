import { describe, it, expect } from 'vitest'
import { consignmentLineCost } from './consignment-math'

describe('consignmentLineCost', () => {
  it('cost_plus returns the HC unchanged', () => {
    expect(consignmentLineCost({ mode: 'cost_plus', basePrice: 100, discountPct: 0 })).toBe(100)
  })

  it('cost_plus ignores any discount', () => {
    expect(consignmentLineCost({ mode: 'cost_plus', basePrice: 100, discountPct: 30 })).toBe(100)
  })

  it('retail_minus applies the discount to the list price (pre-VAT)', () => {
    // Lauk Daun: list 690, 30% off → 483 pre-VAT.
    expect(consignmentLineCost({ mode: 'retail_minus', basePrice: 690, discountPct: 30 })).toBeCloseTo(483, 6)
  })

  it('retail_minus with zero discount returns the list price', () => {
    expect(consignmentLineCost({ mode: 'retail_minus', basePrice: 690, discountPct: 0 })).toBe(690)
  })

  it('matches the Cigar Empire delivery note once the caller adds 7% VAT (516.81 incl VAT)', () => {
    const pre = consignmentLineCost({ mode: 'retail_minus', basePrice: 690, discountPct: 30 })!
    expect(pre * 1.07).toBeCloseTo(516.81, 2)
  })

  it('returns null when the base price is unset', () => {
    expect(consignmentLineCost({ mode: 'cost_plus', basePrice: null, discountPct: 0 })).toBeNull()
    expect(consignmentLineCost({ mode: 'retail_minus', basePrice: null, discountPct: 30 })).toBeNull()
  })
})
