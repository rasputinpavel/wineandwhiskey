import { supabase } from '@/lib/supabase'
import { lookupCache, saveCache } from './cache'
import { runVivinoActorWithRetry, ApifyError } from './apify'
import { buildEnrichmentUpdate } from './match'
import { buildVivinoQuery } from './normalize'
import type { VivinoResult, WineItemRow } from './types'

export const TICK_BATCH_SIZE = 20

export type JobMode = 'missing' | 'failed' | 'all'

type JobRow = {
  id: string
  price_list_id: string
  state: string
  mode: JobMode
  total: number
  processed: number
  enriched: number
  not_found: number
  cache_hits: number
  apify_runs: number
  apify_items: number
}

// ---------------------------------------------------------------------------
// Job creation: enumerates wine_items eligible under the chosen mode and
// writes one vivino_job_items row per wine, with normalized query string.
// ---------------------------------------------------------------------------
export async function createJob(price_list_id: string, mode: JobMode): Promise<{ job_id: string; total: number }> {
  let q = supabase
    .from('wine_items')
    .select('id, name, grape_variety, winery, wine_type, country, year, vivino_enriched_at, vivino_failed_at')
    .eq('price_list_id', price_list_id)
    .not('name', 'is', null)

  if (mode === 'missing') q = q.is('vivino_enriched_at', null)
  if (mode === 'failed')  q = q.not('vivino_failed_at', 'is', null)
  // mode === 'all' — no extra filter; will retry every wine in the list

  const { data: items, error } = await q
  if (error) throw new Error(`select wines: ${error.message}`)
  if (!items || items.length === 0) {
    return { job_id: '', total: 0 }
  }

  // For mode='all' we wipe prior enrichment markers so the job reprocesses cleanly.
  if (mode === 'all') {
    const ids = items.map(i => i.id)
    const CHUNK = 500
    for (let i = 0; i < ids.length; i += CHUNK) {
      await supabase.from('wine_items')
        .update({ vivino_enriched_at: null, vivino_failed_at: null })
        .in('id', ids.slice(i, i + CHUNK))
    }
  }

  const { data: jobRow, error: jobErr } = await supabase
    .from('vivino_jobs')
    .insert({ price_list_id, mode, total: items.length, state: 'queued' })
    .select('id')
    .single()
  if (jobErr || !jobRow) throw new Error(`create job: ${jobErr?.message}`)

  const jobItems = items.map(it => ({
    job_id: jobRow.id,
    wine_item_id: it.id,
    query: buildVivinoQuery({ name: it.name as string, winery: it.winery, year: it.year }),
    state: 'pending' as const,
  }))

  const CHUNK = 500
  for (let i = 0; i < jobItems.length; i += CHUNK) {
    const { error: insErr } = await supabase.from('vivino_job_items').insert(jobItems.slice(i, i + CHUNK))
    if (insErr) {
      console.error('[vivino:enrich] job_items insert failed:', insErr.message)
      throw new Error(`insert job_items: ${insErr.message}`)
    }
  }

  return { job_id: jobRow.id, total: items.length }
}

// ---------------------------------------------------------------------------
// One tick: process up to TICK_BATCH_SIZE pending items in the given job.
// Idempotent: safe to call repeatedly. Returns whether more work remains.
// ---------------------------------------------------------------------------
export async function tickJob(job_id: string): Promise<{ remaining: number; finished: boolean }> {
  const { data: job, error: jobErr } = await supabase
    .from('vivino_jobs')
    .select('*')
    .eq('id', job_id)
    .single()
  if (jobErr || !job) throw new Error(`load job: ${jobErr?.message}`)

  if (job.state === 'done' || job.state === 'failed' || job.state === 'paused') {
    return { remaining: 0, finished: job.state !== 'paused' }
  }

  // Mark running + heartbeat
  await supabase.from('vivino_jobs').update({
    state: 'running',
    started_at: job.started_at ?? new Date().toISOString(),
    heartbeat_at: new Date().toISOString(),
  }).eq('id', job_id)

  const { data: pending, error: pendErr } = await supabase
    .from('vivino_job_items')
    .select('id, wine_item_id, query, attempts')
    .eq('job_id', job_id)
    .eq('state', 'pending')
    .order('id')
    .limit(TICK_BATCH_SIZE)
  if (pendErr) throw new Error(`load pending: ${pendErr.message}`)
  if (!pending || pending.length === 0) {
    await finalizeJob(job_id)
    return { remaining: 0, finished: true }
  }

  // Fetch the underlying wine_items rows we need for matching/updating.
  const wineIds = pending.map(p => p.wine_item_id)
  const { data: wines, error: wineErr } = await supabase
    .from('wine_items')
    .select('id, name, grape_variety, winery, wine_type, country, region, year')
    .in('id', wineIds)
  if (wineErr) throw new Error(`load wines: ${wineErr.message}`)
  const wineById = new Map<string, WineItemRow>((wines ?? []).map(w => [w.id as string, w as WineItemRow]))

  // 1) Cache lookup
  const queries = [...new Set(pending.map(p => p.query))]
  const cache = await lookupCache(queries)

  let cacheHits = 0
  let enriched = 0
  let notFound = 0
  let apifyRuns = 0
  let apifyItems = 0

  // Items that need a fresh Apify run, grouped by query.
  const queryToJobItems = new Map<string, typeof pending>()
  for (const ji of pending) {
    if (cache.has(ji.query)) continue
    const arr = queryToJobItems.get(ji.query) ?? []
    arr.push(ji)
    queryToJobItems.set(ji.query, arr)
  }

  // 2) Apply cache hits immediately.
  for (const ji of pending) {
    const hit = cache.get(ji.query)
    if (!hit) continue
    cacheHits++
    const wine = wineById.get(ji.wine_item_id)
    if (!wine) {
      await markJobItem(ji.id, 'error', 'wine_item missing')
      continue
    }
    if (hit.found && hit.raw) {
      const ok = await applyResult(wine, ji.query, hit.raw)
      await markJobItem(ji.id, ok ? 'done' : 'error', ok ? null : 'apply failed')
      if (ok) enriched++
    } else {
      await markWineNotFound(wine.id, ji.query)
      await markJobItem(ji.id, 'not_found', null)
      notFound++
    }
  }

  // 3) Apify call for the rest (one run, all unique queries).
  const uncachedQueries = [...queryToJobItems.keys()]
  if (uncachedQueries.length > 0) {
    let results: VivinoResult[] | null = null
    try {
      results = await runVivinoActorWithRetry(uncachedQueries)
      apifyRuns = 1
      apifyItems = uncachedQueries.length
    } catch (err) {
      const msg = err instanceof ApifyError ? err.message : String(err)
      console.error('[vivino:enrich] apify batch failed:', msg)
      // Bump attempts on the affected job_items; mark as error after 3 attempts.
      for (const [, jis] of queryToJobItems) {
        for (const ji of jis) {
          const attempts = (ji.attempts ?? 0) + 1
          await supabase.from('vivino_job_items')
            .update({ attempts, state: attempts >= 3 ? 'error' : 'pending', last_error: msg, updated_at: new Date().toISOString() })
            .eq('id', ji.id)
          if (attempts >= 3) {
            const wine = wineById.get(ji.wine_item_id)
            if (wine) await markWineFailed(wine.id, ji.query)
          }
        }
      }
      await supabase.from('vivino_jobs').update({
        last_error: msg,
        heartbeat_at: new Date().toISOString(),
      }).eq('id', job_id)
    }

    if (results) {
      // Map searchQuery → result. Matching is by exact query string we sent.
      const byQuery = new Map<string, VivinoResult>()
      for (const r of results) {
        if (r.searchQuery) byQuery.set(r.searchQuery, r)
      }

      // Save cache entries for all queries we asked about — both hits and misses.
      const cacheRows: { query: string; found: boolean; raw: VivinoResult | null }[] = []
      for (const q of uncachedQueries) {
        const hit = byQuery.get(q)
        cacheRows.push({ query: q, found: !!hit, raw: hit ?? null })
      }
      await saveCache(cacheRows)

      for (const [q, jis] of queryToJobItems) {
        const r = byQuery.get(q) ?? null
        for (const ji of jis) {
          const wine = wineById.get(ji.wine_item_id)
          if (!wine) {
            await markJobItem(ji.id, 'error', 'wine_item missing')
            continue
          }
          if (r) {
            const ok = await applyResult(wine, q, r)
            await markJobItem(ji.id, ok ? 'done' : 'error', ok ? null : 'apply failed')
            if (ok) enriched++
          } else {
            await markWineNotFound(wine.id, q)
            await markJobItem(ji.id, 'not_found', null)
            notFound++
          }
        }
      }
    }
  }

  // 4) Update job counters.
  await supabase.from('vivino_jobs').update({
    processed: (job.processed ?? 0) + enriched + notFound,
    enriched: (job.enriched ?? 0) + enriched,
    not_found: (job.not_found ?? 0) + notFound,
    cache_hits: (job.cache_hits ?? 0) + cacheHits,
    apify_runs: (job.apify_runs ?? 0) + apifyRuns,
    apify_items: (job.apify_items ?? 0) + apifyItems,
    heartbeat_at: new Date().toISOString(),
  }).eq('id', job_id)

  // 5) Check if we're done.
  const { count: pendingLeft } = await supabase
    .from('vivino_job_items')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', job_id)
    .eq('state', 'pending')

  const remaining = pendingLeft ?? 0
  if (remaining === 0) {
    await finalizeJob(job_id)
    return { remaining: 0, finished: true }
  }
  return { remaining, finished: false }
}

async function applyResult(wine: WineItemRow, query: string, result: VivinoResult): Promise<boolean> {
  const update = buildEnrichmentUpdate(wine, result, query, new Date().toISOString())
  const { error } = await supabase.from('wine_items').update(update).eq('id', wine.id)
  if (error) {
    console.error('[vivino:enrich] update wine failed:', error.message)
    return false
  }
  return true
}

async function markWineNotFound(wine_id: string, query: string): Promise<void> {
  await supabase.from('wine_items').update({
    vivino_enriched_at: new Date().toISOString(),
    vivino_failed_at: null,
    vivino_query: query,
    vivino_match_confidence: 0,
  }).eq('id', wine_id)
}

async function markWineFailed(wine_id: string, query: string): Promise<void> {
  await supabase.from('wine_items').update({
    vivino_failed_at: new Date().toISOString(),
    vivino_query: query,
  }).eq('id', wine_id)
}

async function markJobItem(id: string, state: 'done' | 'not_found' | 'error', error_msg: string | null): Promise<void> {
  await supabase.from('vivino_job_items').update({
    state,
    last_error: error_msg,
    updated_at: new Date().toISOString(),
  }).eq('id', id)
}

async function finalizeJob(job_id: string): Promise<void> {
  // Determine if any items errored; mark failed in that case, otherwise done.
  const { count: errored } = await supabase
    .from('vivino_job_items')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', job_id)
    .eq('state', 'error')

  await supabase.from('vivino_jobs').update({
    state: (errored ?? 0) > 0 ? 'failed' : 'done',
    finished_at: new Date().toISOString(),
    heartbeat_at: new Date().toISOString(),
  }).eq('id', job_id)
}

export type { JobRow }
