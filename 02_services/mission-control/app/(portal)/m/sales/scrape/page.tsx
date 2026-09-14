import Link from 'next/link'
import { findItem } from '@/lib/registry'
import { PaneHeader } from '@/components/shell/PaneHeader'
import { ScrapeFormClient } from '@/components/modules/sales/ScrapeFormClient'
import { ScrapeHistoryClient } from '@/components/modules/sales/ScrapeHistoryClient'
import { listScrapeRuns } from '@/lib/sales/queries'
import type { ScrapeRun } from '@/lib/sales/types'

export const dynamic = 'force-dynamic'

export default async function ScrapePage() {
  const item = findItem('sales-crm')!

  let runs: ScrapeRun[] = []
  let runsError: string | null = null
  try {
    runs = await listScrapeRuns(30)
  } catch (err) {
    runsError = (err as Error).message
  }

  return (
    <>
      <PaneHeader
        item={item}
        rightSlot={
          <Link href="/m/sales" className="text-xs px-3 py-1.5 border border-pale-stone hover:border-wine-red hover:text-wine-red text-graphite rounded-sm">
            ← Back to leads
          </Link>
        }
      />
      <div className="flex-1 overflow-y-auto bg-warm-white">
        <div className="max-w-[900px] mx-auto px-6 py-6 space-y-4">
          <div>
            <div className="overline text-graphite">B2B outreach · Apify Google Places</div>
            <h1 className="font-display text-deep-black uppercase tracking-display" style={{ fontSize: 36, lineHeight: 1 }}>
              New scrape
            </h1>
            <p className="text-sm text-graphite mt-1 max-w-2xl">
              One Apify run is launched per selected district. Once status flips to <code>succeeded</code>, hit Import to materialize the leads. Duplicates (matched by <code>google_place_id</code>) get their Google-side fields refreshed; stage and notes are preserved.
            </p>
          </div>
          <ScrapeFormClient />

          <section className="bg-warm-white border border-pale-stone rounded-md p-5 space-y-3">
            <div>
              <h2 className="font-heading font-semibold text-deep-black text-base">Run history</h2>
              <p className="text-xs text-graphite mt-0.5">
                Every scrape ever started, newest first — including the ones launched from a tab that has since been closed. Unfinished runs keep polling here.
              </p>
            </div>
            {runsError
              ? <div className="text-xs text-wine-red bg-wine-red/8 border border-wine-red/30 rounded-sm px-3 py-2">Failed to load run history: {runsError}</div>
              : <ScrapeHistoryClient initialRuns={runs} />}
          </section>
        </div>
      </div>
    </>
  )
}
