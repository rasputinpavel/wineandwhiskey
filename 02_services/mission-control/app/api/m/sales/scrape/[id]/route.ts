// GET /api/m/sales/scrape/[id]
// Returns scrape_run row + Apify run status (live-polls if not terminal).
// Used by UI to drive the progress chip until status flips to 'succeeded'.

import { NextResponse } from 'next/server'
import { sbSales } from '@/lib/supabase'
import { getScrapeRun } from '@/lib/sales/queries'
import {
  getRunStatus, getDatasetItemCount, isTerminal, apifyConfigured,
} from '@/lib/sales/apify-places'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const run = await getScrapeRun(id)
  if (!run) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // 'imported' is the only truly final state — no point polling after that.
  // For 'succeeded' / 'failed' / 'aborted' we still backfill scraped_count if
  // we never managed to capture it (race between status flip and stats latency).
  if (run.status === 'imported' || !run.apify_run_id || !apifyConfigured()) {
    return NextResponse.json({ run })
  }

  // For terminal-but-not-imported runs with scraped_count=0, fetch dataset size directly.
  const terminal: typeof run.status[] = ['succeeded', 'failed', 'aborted']
  if (terminal.includes(run.status)) {
    if (run.status === 'succeeded' && run.scraped_count === 0 && run.apify_dataset_id) {
      const count = await getDatasetItemCount(run.apify_dataset_id).catch(() => null)
      if (count !== null) {
        await sbSales.from('scrape_run').update({ scraped_count: count }).eq('id', id)
        run.scraped_count = count
      }
    }
    return NextResponse.json({ run })
  }

  try {
    const live = await getRunStatus(run.apify_run_id)
    if (isTerminal(live.status)) {
      const nextStatus =
        live.status === 'SUCCEEDED' ? 'succeeded' :
        live.status === 'ABORTED'   ? 'aborted'   : 'failed'
      const patch: Record<string, unknown> = {
        status: nextStatus,
        finished_at: new Date().toISOString(),
      }
      // /datasets/{id} is authoritative — /actor-runs/{id}.stats lags briefly
      // after status flips to SUCCEEDED, which is why scraped_count was 0 before.
      if (nextStatus === 'succeeded' && run.apify_dataset_id) {
        const count = await getDatasetItemCount(run.apify_dataset_id).catch(() => null)
        if (count !== null) patch.scraped_count = count
      }
      const { error } = await sbSales.from('scrape_run').update(patch).eq('id', id)
      if (error) console.warn('[scrape status] patch failed:', error.message)
      run.status = nextStatus
      if (typeof patch.scraped_count === 'number') run.scraped_count = patch.scraped_count
    }
    return NextResponse.json({
      run,
      apify_status: live.status,
      dataset_item_count: live.stats?.datasetItemCount ?? null,
    })
  } catch (err) {
    return NextResponse.json({ run, poll_error: (err as Error).message })
  }
}
