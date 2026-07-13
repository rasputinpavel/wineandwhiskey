// Catalog freshness: with catalogs kept as dated versions (no reconcile/merge),
// the newest-dated price list per supplier is "current", older ones "expired".
// Derived at query time — no stored state.
import { supabase } from './supabase'

export type Freshness = 'current' | 'expired'

export type CatalogFreshness = {
  currentIds: Set<string>          // price_list ids that are the newest for their supplier
  versionedSuppliers: Set<string>  // supplier ids with more than one done catalog
}

function effectiveTime(pl: { date: string | null; uploaded_at: string }): number {
  const t = new Date(pl.date ?? pl.uploaded_at).getTime()
  return Number.isNaN(t) ? new Date(pl.uploaded_at).getTime() : t
}

export async function catalogFreshness(): Promise<CatalogFreshness> {
  const { data } = await supabase
    .from('price_lists')
    .select('id,supplier_id,date,uploaded_at')
    .eq('status', 'done')

  const best = new Map<string, { id: string; key: number }>()
  const count = new Map<string, number>()
  for (const pl of data ?? []) {
    if (!pl.supplier_id) continue
    count.set(pl.supplier_id, (count.get(pl.supplier_id) ?? 0) + 1)
    const key = effectiveTime(pl)
    const cur = best.get(pl.supplier_id)
    if (!cur || key > cur.key) best.set(pl.supplier_id, { id: pl.id, key })
  }

  return {
    currentIds: new Set([...best.values()].map(v => v.id)),
    versionedSuppliers: new Set([...count].filter(([, n]) => n > 1).map(([s]) => s)),
  }
}
