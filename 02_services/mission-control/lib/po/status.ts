// Single source of truth for the PO-scan review workflow statuses.
// draft: bot default, unreviewed. needs_corrections: waiting on a corrected
// invoice from the supplier. approved: reviewed, PO created in Loyverse.
export const PO_STATUSES = ['draft', 'needs_corrections', 'approved'] as const

export type PoStatus = (typeof PO_STATUSES)[number]

export function isPoStatus(v: unknown): v is PoStatus {
  return typeof v === 'string' && (PO_STATUSES as readonly string[]).includes(v)
}
