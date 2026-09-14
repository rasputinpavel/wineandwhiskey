// POST /api/m/sales/scrape/[id]/import[?force=1]
// Pulls dataset items from the Apify run referenced by the scrape_run row,
// applies post-filters (min_reviews, price_levels), and upserts into sales.lead.
// Existing leads (same google_place_id) get their Google-derived fields
// refreshed; stage/notes/assignee are preserved.
//
// ?force=1 re-imports a run that is already marked 'imported'. Used when the
// filter rules changed after the fact — upserts are idempotent, so the worst
// case is that the same places get refreshed.

import { NextResponse } from 'next/server'
import { fetchDatasetItems, apifyConfigured } from '@/lib/sales/apify-places'
import { passesPostFilters } from '@/lib/sales/filters'
import {
  getScrapeRun, setRunStatus, setRunImportCounts,
  placeToLead, upsertLeads,
} from '@/lib/sales/queries'
import type { ScrapeInput } from '@/lib/sales/types'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const force = new URL(req.url).searchParams.get('force') === '1'
  if (!apifyConfigured()) {
    return NextResponse.json({ error: 'APIFY_TOKEN not configured' }, { status: 500 })
  }

  const run = await getScrapeRun(id)
  if (!run) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (run.status === 'imported' && !force) {
    return NextResponse.json({ already: true, run })
  }
  if (run.status !== 'succeeded' && run.status !== 'imported') {
    return NextResponse.json({ error: `cannot import — run status is "${run.status}"` }, { status: 409 })
  }
  if (!run.apify_dataset_id) {
    return NextResponse.json({ error: 'no dataset id on run' }, { status: 500 })
  }

  let items
  try {
    items = await fetchDatasetItems(run.apify_dataset_id)
  } catch (err) {
    // On a re-import leave the row alone: the scrape itself did succeed, the
    // dataset has simply expired on Apify's side.
    const msg = `dataset fetch: ${(err as Error).message}`
    if (!force) await setRunStatus(id, 'failed', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  const input = run.input as ScrapeInput
  const scraped = items.length

  // Post-filter — Apify's place filter is OK on rating but doesn't enforce
  // reviews_count, and price_levels filtering on Apify side is unreliable.
  // Rules live in lib/sales/filters.ts (tested there).
  const passes = items.filter(p => passesPostFilters(p, input))

  const rows = passes.map(p => placeToLead(p, {
    business_kind: input.business_kind,
    district:      (typeof input.district === 'string' ? input.district : null) as never,
    source_run_id: id,
  }))

  let counts
  try {
    counts = await upsertLeads(rows)
  } catch (err) {
    await setRunStatus(id, 'failed', `upsert: ${(err as Error).message}`)
    return NextResponse.json({ error: `upsert: ${(err as Error).message}` }, { status: 500 })
  }

  await setRunImportCounts(id, {
    scraped,
    imported:  counts.inserted,
    duplicate: counts.updated,
    rejected:  scraped - passes.length,
  })

  return NextResponse.json({
    scraped, imported: counts.inserted, duplicate: counts.updated, rejected: scraped - passes.length,
  })
}
