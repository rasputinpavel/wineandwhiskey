import { describe, it, expect } from 'vitest'
import { PO_STATUSES, isPoStatus } from './status'

describe('isPoStatus', () => {
  it('accepts every valid status', () => {
    for (const s of PO_STATUSES) expect(isPoStatus(s)).toBe(true)
  })

  it('exposes exactly the three workflow statuses', () => {
    expect(PO_STATUSES).toEqual(['draft', 'needs_corrections', 'approved'])
  })

  it('rejects unknown / malformed values', () => {
    expect(isPoStatus('done')).toBe(false)
    expect(isPoStatus('Draft')).toBe(false)
    expect(isPoStatus('')).toBe(false)
    expect(isPoStatus(null)).toBe(false)
    expect(isPoStatus(undefined)).toBe(false)
    expect(isPoStatus(3)).toBe(false)
  })
})
