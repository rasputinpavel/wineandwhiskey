// Catalog freshness. Versioning is EXPLICIT: only price lists that share a
// version_group_id are versions of one catalog. Within a group the newest-dated
// one is "current", the rest "expired". Unrelated lists (no group, or the only
// member) are standalone → always "current". Two different lists of the same
// supplier are NOT versions of each other.
import { supabase } from './supabase'

export type Freshness = 'current' | 'expired'

export type CatalogFreshness = {
  statusById: Map<string, Freshness>   // done price_list id → current | expired
  dateById: Map<string, string | null> // price_list id → effective date (for display)
  versionedIds: Set<string>            // lists that belong to a group with >1 member
}

function effectiveTime(pl: { date: string | null; uploaded_at: string }): number {
  const t = new Date(pl.date ?? pl.uploaded_at).getTime()
  return Number.isNaN(t) ? new Date(pl.uploaded_at).getTime() : t
}

export async function catalogFreshness(): Promise<CatalogFreshness> {
  const statusById = new Map<string, Freshness>()
  const dateById = new Map<string, string | null>()
  const versionedIds = new Set<string>()

  const { data, error } = await supabase
    .from('price_lists')
    .select('id,version_group_id,date,uploaded_at')
    .eq('status', 'done')

  // Degrade gracefully before migration 011 (version_group_id column missing).
  if (error || !data) return { statusById, dateById, versionedIds }

  const groups = new Map<string, { id: string; key: number }[]>()
  for (const pl of data) {
    dateById.set(pl.id, pl.date ?? null)
    if (pl.version_group_id) {
      const arr = groups.get(pl.version_group_id) ?? []
      arr.push({ id: pl.id, key: effectiveTime(pl) })
      groups.set(pl.version_group_id, arr)
    } else {
      statusById.set(pl.id, 'current') // standalone
    }
  }

  for (const arr of groups.values()) {
    const newest = arr.reduce((a, b) => (b.key > a.key ? b : a))
    const multi = arr.length > 1
    for (const x of arr) {
      statusById.set(x.id, x.id === newest.id ? 'current' : 'expired')
      if (multi) versionedIds.add(x.id)
    }
  }

  return { statusById, dateById, versionedIds }
}
