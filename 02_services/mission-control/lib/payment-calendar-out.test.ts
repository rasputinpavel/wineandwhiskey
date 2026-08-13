import { describe, it, expect } from 'vitest'
import { outStatus, buildBigRows } from './payment-calendar-out'
import type { RollingBigPayment } from './supabase'
import { buildFixedRows } from './payment-calendar-out'
import type { FixedCost, MandatoryActual } from './supabase'

const big = (over: Partial<RollingBigPayment>): RollingBigPayment => ({
  id: 'b1', name: 'Som deposit', amount: 15000, due_date: '2026-08-20',
  status: 'planned', note: null, created_at: '2026-08-01T00:00:00Z', ...over,
})

describe('outStatus', () => {
  it('past → overdue, same day → today, future → future', () => {
    expect(outStatus('2026-08-10', '2026-08-11')).toBe('overdue')
    expect(outStatus('2026-08-11', '2026-08-11')).toBe('today')
    expect(outStatus('2026-08-12', '2026-08-11')).toBe('future')
  })
})

describe('buildBigRows', () => {
  it('month view: shows big payments due in that month, paid ones marked paid', () => {
    const rows = buildBigRows(
      [big({ id: 'b1', due_date: '2026-08-20' }), big({ id: 'b2', due_date: '2026-09-01' }),
       big({ id: 'b3', due_date: '2026-08-05', status: 'paid' })],
      { view: 'month', month: '2026-08', today: '2026-08-11' },
    )
    expect(rows.map(r => r.big!.id).sort()).toEqual(['b1', 'b3'])
    expect(rows.find(r => r.big!.id === 'b3')!.status).toBe('paid')
    expect(rows.find(r => r.big!.id === 'b1')!.amount).toBe(15000)
    expect(rows.find(r => r.big!.id === 'b1')!.status).toBe('future')
    expect(rows.every(r => r.dir === 'out')).toBe(true)
  })

  it('open view: unpaid only, overdue pulled to today, capped at end of next month', () => {
    const rows = buildBigRows(
      [big({ id: 'overdue', due_date: '2026-08-03' }),
       big({ id: 'soon', due_date: '2026-09-10' }),
       big({ id: 'far', due_date: '2026-10-05' }),
       big({ id: 'done', due_date: '2026-08-15', status: 'paid' })],
      { view: 'open', today: '2026-08-11' },
    )
    const byId = Object.fromEntries(rows.map(r => [r.big!.id, r]))
    expect(Object.keys(byId).sort()).toEqual(['overdue', 'soon'])
    expect(byId.overdue.date).toBe('2026-08-11')
    expect(byId.overdue.status).toBe('today')
  })

  it('open view: skips big payments with no due_date', () => {
    const rows = buildBigRows([big({ id: 'nd', due_date: null })], { view: 'open', today: '2026-08-11' })
    expect(rows).toEqual([])
  })
})

const fc = (over: Partial<FixedCost>): FixedCost => ({
  id: 'fc', category: 'Rent', amount_thb: 28000, active: true, notes: null,
  sort_order: 100, created_at: '', updated_at: '', percent_revenue: null,
  due_day: 15, match_category: null, ...over,
})
// Flat revenue run-rate: ฿220,000/month → Taxes 3.5% = ฿7,700.
const revenueOf = () => 220000

describe('buildFixedRows', () => {
  it('month view: one dated row per active obligation, %-rows use revenue', () => {
    const rows = buildFixedRows(
      [fc({ id: 'rent', category: 'Rent', amount_thb: 28000, due_day: 15 }),
       fc({ id: 'tax', category: 'Taxes', amount_thb: null, percent_revenue: 3.5, due_day: 11 }),
       fc({ id: 'off', active: false })],
      [], revenueOf, { view: 'month', month: '2026-08', today: '2026-08-11' },
    )
    const byId = Object.fromEntries(rows.map(r => [r.fixed!.fixedCostId, r]))
    expect(Object.keys(byId).sort()).toEqual(['rent', 'tax'])
    expect(byId.rent.date).toBe('2026-08-15')
    expect(byId.rent.amount).toBe(28000)
    expect(byId.tax.date).toBe('2026-08-11')
    expect(byId.tax.amount).toBeCloseTo(7700, 2)
    expect(byId.tax.status).toBe('today')
  })

  it('month view: override amount wins and paid flag greens the row', () => {
    const ov: MandatoryActual = {
      fixed_cost_id: 'rent', period: '2026-08', paid: true,
      amount_thb: 30000, paid_at: '2026-08-14', note: null, updated_at: '',
    }
    const rows = buildFixedRows([fc({ id: 'rent', due_day: 15 })], [ov], revenueOf,
      { view: 'month', month: '2026-08', today: '2026-08-20' })
    expect(rows[0].amount).toBe(30000)
    expect(rows[0].status).toBe('paid')
    expect(rows[0].date).toBe('2026-08-14')
    expect(rows[0].fixed!.paid).toBe(true)
  })

  it('open view: due_day still ahead this month → current month occurrence', () => {
    const rows = buildFixedRows([fc({ id: 'rent', due_day: 15 })], [], revenueOf,
      { view: 'open', today: '2026-08-11' })
    expect(rows[0].date).toBe('2026-08-15')
  })

  it('open view: due_day passed & unpaid → pulled to today (not rolled forward)', () => {
    const rows = buildFixedRows([fc({ id: 'tax', category: 'Taxes', amount_thb: 8000, due_day: 11 })], [], revenueOf,
      { view: 'open', today: '2026-08-13' })
    expect(rows[0].date).toBe('2026-08-13')
    expect(rows[0].status).toBe('today')   // pulled to today, like an overdue PO/big
    expect(rows[0].fixed!.period).toBe('2026-08')
  })

  it('open view: due_day passed but paid in the sheet (matched by category) → next month occurrence', () => {
    const rows = buildFixedRows([fc({ id: 'rent', category: 'Rent', due_day: 15 })], [], revenueOf,
      { view: 'open', today: '2026-08-16' }, ['Аренда + Коммуналка'])
    expect(rows[0].date).toBe('2026-09-15')
    expect(rows[0].status).toBe('future')
    expect(rows[0].fixed!.period).toBe('2026-09')
  })

  it('open view: current month marked paid → shows next month occurrence', () => {
    const ov: MandatoryActual = {
      fixed_cost_id: 'rent', period: '2026-08', paid: true,
      amount_thb: null, paid_at: '2026-08-10', note: null, updated_at: '',
    }
    const rows = buildFixedRows([fc({ id: 'rent', due_day: 15 })], [ov], revenueOf,
      { view: 'open', today: '2026-08-11' })
    expect(rows[0].date).toBe('2026-09-15')
    expect(rows[0].status).toBe('future')
    expect(rows[0].fixed!.period).toBe('2026-09')
  })

  it('open view: obligations with no due_day are skipped', () => {
    const rows = buildFixedRows([fc({ id: 'x', due_day: null })], [], revenueOf,
      { view: 'open', today: '2026-08-11' })
    expect(rows).toEqual([])
  })

  it('month view: due_day past end of month clamps to last day', () => {
    const rows = buildFixedRows([fc({ id: 'rent', due_day: 31 })], [], revenueOf,
      { view: 'month', month: '2026-02', today: '2026-02-01' })
    expect(rows[0].date).toBe('2026-02-28')
  })
})
