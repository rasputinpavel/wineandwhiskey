// GET /api/m/sales/scrape/[id]
// Returns scrape_run row + Apify run status (live-polls if not terminal).
// Used by UI to drive the progress chip until status flips to 'succeeded'.

import { NextResponse } from 'next/server'
import { sbSales } from '@/lib/supabase'
import { getScrapeRun } from '@/lib/sales/queries'
import { getRunStatus, isTerminal, apifyConfigured } from '@/lib/sales/apify-places'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const run = await getScrapeRun(id)
  if (!run) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // If already in a terminal app-side state, skip the live poll.
  const terminal: typeof run.status[] = ['succeeded', 'failed', 'aborted', 'imported']
  if (terminal.includes(run.status) || !run.apify_run_id || !apifyConfigured()) {
    return NextResponse.json({ run })
  }

  try {
    const live = await getRunStatus(run.apify_run_id)
    if (isTerminal(live.status)) {
      const nextStatus =
        live.status === 'SUCCEEDED' ? 'succeeded' :
        live.status === 'ABORTED'   ? 'aborted'   : 'failed'
      // Persist datasetItemCount as scraped_count so the UI can show "60 places
      // ready to import" *before* the user clicks Import. The /import route
      // will overwrite this with the actual post-filter count.
      const patch: Record<string, unknown> = {
        status: nextStatus,
        finished_at: new Date().toISOString(),
      }
      if (nextStatus === 'succeeded' && live.stats?.datasetItemCount != null) {
        patch.scraped_count = live.stats.datasetItemCount
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
