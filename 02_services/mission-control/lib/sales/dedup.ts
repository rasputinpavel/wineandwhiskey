// Duplicate-detection + ownership helpers for the sales CRM.

// Normalized lead name for duplicate detection. MUST produce the identical
// string to the SQL generated column sales.lead.name_norm
// (lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))) — see migration 033.
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim()
}

// Which lead set to show: the logged-in user's own leads ('mine') or all.
// - an explicit param always wins (but 'mine' needs a sales_name to be meaningful)
// - otherwise a manager with a sales_name defaults to 'mine', everyone else 'all'
export function resolveOwner(
  { paramOwner, salesName, isAdmin }: { paramOwner?: string; salesName?: string; isAdmin?: boolean },
): 'mine' | 'all' {
  const wantMine = paramOwner === 'mine' || (paramOwner !== 'all' && !!salesName && !isAdmin)
  return wantMine && !!salesName ? 'mine' : 'all'
}

// Sentinel for "nobody owns this lead" in the owner dropdown — an empty value
// there already means "everyone", and a URL param can't carry null.
export const UNASSIGNED = '__none__'

export type LeadOwnerFilter =
  | { kind: 'all' }
  | { kind: 'person'; name: string }
  | { kind: 'unassigned' }

// Which leads the list should show. Picking a person from the dropdown beats
// the My/All toggle — that is the whole point of picking someone — and the
// toggle keeps working when no one is picked.
export function resolveOwnerFilter(
  { paramOwner, paramAssignee, salesName, isAdmin }:
  { paramOwner?: string; paramAssignee?: string; salesName?: string; isAdmin?: boolean },
): LeadOwnerFilter {
  const picked = paramAssignee?.trim()
  if (picked === UNASSIGNED) return { kind: 'unassigned' }
  if (picked) return { kind: 'person', name: picked }
  if (resolveOwner({ paramOwner, salesName, isAdmin }) === 'mine' && salesName) {
    return { kind: 'person', name: salesName }
  }
  return { kind: 'all' }
}
