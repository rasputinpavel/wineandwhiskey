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
