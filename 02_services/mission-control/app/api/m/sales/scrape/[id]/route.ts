// GET /api/m/sales/scrape/[id]
// Returns scrape_run row + Apify run status (live-polls if not terminal).
// Used by UI to drive the progress chip until status flips to 'succeeded'.

import { NextResponse } from 'next/server'
import { getScrapeRun, setRunStatus } from '@/lib/sales/queries'
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
      await setRunStatus(id, nextStatus)
      run.status = nextStatus
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
