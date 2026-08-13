import { describe, it, expect } from 'vitest'
import { descriptionMatchesCategory, reconcileMonthObligations } from './mandatory'
import type { Obligation } from './mandatory'

const ob = (over: Partial<Obligation>): Obligation => ({
  fixedCostId: 'f1', category: 'Rent', period: '2026-08', date: '2026-08-15', planned: 28000, ...over,
})

describe('descriptionMatchesCategory', () => {
  it('matches a combined Rent+Utilities payment to both plan lines', () => {
    expect(descriptionMatchesCategory('Аренда + Коммуналка', 'Rent')).toBe(true)
    expect(descriptionMatchesCategory('Аренда + Коммуналка', 'Utilities')).toBe(true)
  })

  it('does not match Rent+Utilities payment to unrelated categories', () => {
    expect(descriptionMatchesCategory('Аренда + Коммуналка', 'Taxes')).toBe(false)
    expect(descriptionMatchesCategory('Аренда + Коммуналка', 'Accounting')).toBe(false)
  })

  it('matches a salary payment to Salary and Bonuses (bonuses ride inside salary) but not Advance', () => {
    expect(descriptionMatchesCategory('Зарплата Som + депозит', 'Salary')).toBe(true)
    expect(descriptionMatchesCategory('Зарплата Grace', 'Salary Bonuses')).toBe(true)
    expect(descriptionMatchesCategory('Зарплата Som + депозит', 'Salary Advance')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(descriptionMatchesCategory('АРЕНДА офиса', 'Rent')).toBe(true)
  })
})

describe('reconcileMonthObligations', () => {
  const today = '2026-08-13'
  const obligations: Obligation[] = [
    ob({ fixedCostId: 'rent', category: 'Rent',           date: '2026-08-15', planned: 28000 }),
    ob({ fixedCostId: 'util', category: 'Utilities',      date: '2026-08-15', planned: 12000 }),
    ob({ fixedCostId: 'tax',  category: 'Taxes',          date: '2026-08-11', planned: 9914  }),
    ob({ fixedCostId: 'acc',  category: 'Accounting',     date: '2026-08-11', planned: 8000  }),
    ob({ fixedCostId: 'adv',  category: 'Salary Advance', date: '2026-08-15', planned: 9000  }),
  ]

  it('drops obligations paid this month (matched by category)', () => {
    const out = reconcileMonthObligations(obligations, ['Аренда + Коммуналка'], today)
    // Rent + Utilities matched → not present
    expect(out.find(r => r.amount === 28000)).toBeUndefined()
    expect(out.find(r => r.amount === 12000)).toBeUndefined()
  })

  it('pulls unpaid overdue obligations to today', () => {
    const out = reconcileMonthObligations(obligations, ['Аренда + Коммуналка'], today)
    // Taxes + Accounting due day 11 (< today), unpaid → pulled to today
    expect(out).toContainEqual({ date: today, amount: 9914 })
    expect(out).toContainEqual({ date: today, amount: 8000 })
  })

  it('keeps unpaid future obligations on their due date', () => {
    const out = reconcileMonthObligations(obligations, ['Аренда + Коммуналка'], today)
    expect(out).toContainEqual({ date: '2026-08-15', amount: 9000 })
  })

  it('with no actuals, projects every obligation (overdue pulled to today)', () => {
    const out = reconcileMonthObligations(obligations, [], today)
    expect(out).toHaveLength(5)
    // the two day-11 lines pulled to today
    expect(out.filter(r => r.date === today)).toHaveLength(2)
  })
})
