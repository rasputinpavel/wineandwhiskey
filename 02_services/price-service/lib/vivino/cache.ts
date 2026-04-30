import { supabase } from '@/lib/supabase'
import type { VivinoResult } from './types'

// `raw` may hold multiple candidates (from maxResultsPerSearch=5) for a single
// query. Older entries store a single object — readers must accept either.
export type CacheHit = { query: string; found: boolean; raw: VivinoResult[] | VivinoResult | null }

export function candidatesFromHit(raw: CacheHit['raw']): VivinoResult[] {
  if (!raw) return []
  return Array.isArray(raw) ? raw : [raw]
}

// 90 days — Vivino ratings shift slowly; not worth re-paying for the same wine.
const CACHE_TTL_DAYS = 90

export async function lookupCache(queries: string[]): Promise<Map<string, CacheHit>> {
  const out = new Map<string, CacheHit>()
  if (queries.length === 0) return out

  const cutoff = new Date(Date.now() - CACHE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // chunk to avoid blowing the IN-list size on big lists
  const CHUNK = 200
  for (let i = 0; i < queries.length; i += CHUNK) {
    const slice = queries.slice(i, i + CHUNK)
    const { data, error } = await supabase
      .from('vivino_cache')
      .select('query, found, raw, fetched_at')
      .in('query', slice)
      .gte('fetched_at', cutoff)
    if (error) {
      console.error('[vivino:cache] lookup failed:', error.message)
      continue
    }
    for (const row of data ?? []) {
      out.set(row.query as string, {
        query: row.query as string,
        found: row.found as boolean,
        raw: (row.raw as VivinoResult[] | VivinoResult | null) ?? null,
      })
    }
  }
  return out
}

export async function saveCache(entries: { query: string; found: boolean; raw: VivinoResult[] | VivinoResult | null }[]): Promise<void> {
  if (entries.length === 0) return
  // Dedupe within batch — last write wins.
  const dedup = new Map<string, { query: string; found: boolean; raw: VivinoResult[] | VivinoResult | null }>()
  for (const e of entries) dedup.set(e.query, e)
  const rows = [...dedup.values()].map(e => ({
    query: e.query,
    found: e.found,
    raw: e.raw,
    fetched_at: new Date().toISOString(),
  }))
  const { error } = await supabase.from('vivino_cache').upsert(rows, { onConflict: 'query' })
  if (error) console.error('[vivino:cache] upsert failed:', error.message)
}
