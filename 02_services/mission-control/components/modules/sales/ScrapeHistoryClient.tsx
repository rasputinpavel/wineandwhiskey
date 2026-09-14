'use client'

// Run history for /m/sales/scrape.
//
// A scrape used to live only in the state of the tab that started it: leave the
// page and a finished run had no Import button anywhere, so the paid dataset
// just sat on Apify (that is exactly how the 2026-09-14 Nai Harn run got
// stranded). This table reads scrape_run from the DB, keeps polling anything
// unfinished, and offers Import wherever it still applies.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BUSINESS_KIND_LABEL, type BusinessKind } from '@/lib/sales/config'
import type { ScrapeRun } from '@/lib/sales/types'
import { ScrapeStatusChip } from './ScrapeStatusChip'

const UNFINISHED: ScrapeRun['status'][] = ['pending', 'running']

export function ScrapeHistoryClient({ initialRuns }: { initialRuns: ScrapeRun[] }) {
  const router = useRouter()
  const [runs, setRuns]   = useState<ScrapeRun[]>(initialRuns)
  const [busy, setBusy]   = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Server rows win on refresh — otherwise an import done here would be
  // overwritten by a stale snapshot on the next navigation.
  useEffect(() => { setRuns(initialRuns) }, [initialRuns])

  const runsRef = useRef(runs)
  runsRef.current = runs

  // Poll only while something is unfinished. The GET route flips our row to
  // succeeded/failed once Apify reports a terminal status, so a run started in
  // a tab that got closed still lands correctly here.
  useEffect(() => {
    const pending = runs.filter(r => UNFINISHED.includes(r.status))
    if (pending.length === 0) return
    const timer = setInterval(async () => {
      const ids = runsRef.current.filter(r => UNFINISHED.includes(r.status)).map(r => r.id)
      if (ids.length === 0) return
      const fresh = await Promise.all(ids.map(id => refetch(id)))
      applyFresh(fresh)
    }, 10_000)
    return () => clearInterval(timer)
  }, [runs])

  async function refetch(id: string): Promise<ScrapeRun | null> {
    const json = await fetch(`/api/m/sales/scrape/${id}`).then(r => r.json()).catch(() => null)
    return (json?.run as ScrapeRun) ?? null
  }

  function applyFresh(fresh: Array<ScrapeRun | null>) {
    const byId = new Map(fresh.filter(Boolean).map(r => [r!.id, r!]))
    if (byId.size === 0) return
    setRuns(prev => prev.map(r => byId.get(r.id) ?? r))
  }

  async function refresh(id: string) {
    setError(null); setBusy(id)
    try { applyFresh([await refetch(id)]) } finally { setBusy(null) }
  }

  async function importRun(id: string, force = false) {
    setError(null); setBusy(id)
    try {
      const res  = await fetch(`/api/m/sales/scrape/${id}/import${force ? '?force=1' : ''}`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Import failed'); return }
      applyFresh([await refetch(id)])
      // New leads landed — the leads table behind this page is now stale.
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  if (runs.length === 0) {
    return <p className="text-sm text-graphite">No scrapes yet.</p>
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="text-xs text-wine-red bg-wine-red/8 border border-wine-red/30 rounded-sm px-3 py-2">{error}</div>
      )}
      <div className="overflow-x-auto">
        {/* pr-4 on every cell — district/kind/filters sit shoulder to shoulder otherwise */}
        <table className="w-full text-sm [&_th]:pr-4 [&_td]:pr-4">
          <thead className="text-graphite text-xs">
            <tr className="text-left">
              <th className="py-1 font-normal">Started</th>
              <th className="py-1 font-normal">Scope &amp; filters</th>
              <th className="py-1 font-normal">Status</th>
              <th className="py-1 font-normal text-right">Result</th>
              <th className="py-1 font-normal text-right">Apify</th>
              <th className="py-1"></th>
            </tr>
          </thead>
          <tbody>
            {runs.map(r => {
              const input = r.input ?? ({} as ScrapeRun['input'])
              // Nothing came back from Apify at all — filters can't be blamed.
              const empty = r.status === 'imported' && r.scraped_count === 0
              // Scraped something but imported nothing: post-filters ate the run.
              const allRejected = r.status === 'imported' && r.scraped_count > 0
                && r.imported_count === 0 && r.duplicate_count === 0
              return (
                <tr key={r.id} className="border-t border-pale-stone align-top">
                  <td className="py-2 text-xs whitespace-nowrap">{formatStarted(r.created_at)}</td>
                  {/* Scope on top, the filter recipe underneath — keeps the numeric
                      columns and the action buttons on screen without a scrollbar. */}
                  <td className="py-2 min-w-[200px]">
                    <div className="whitespace-nowrap">
                      {typeof input.district === 'string' ? input.district : '—'}
                      <span className="text-graphite text-xs">
                        {' · '}{input.business_kind ? BUSINESS_KIND_LABEL[input.business_kind as BusinessKind] : '—'}
                      </span>
                    </div>
                    <div className="text-[11px] text-graphite">{describeFilters(input)}</div>
                  </td>
                  <td className="py-2">
                    <div className="flex flex-col items-start gap-1">
                      <ScrapeStatusChip status={r.status} />
                      {empty && <span className="text-[11px] text-wine-red whitespace-nowrap" title="Apify returned 0 items — open the run in Console for the log">empty ⚠</span>}
                      {allRejected && <span className="text-[11px] text-wine-red whitespace-nowrap" title="Every scraped place was dropped by the post-filters">all rejected ⚠</span>}
                    </div>
                    {r.error && <div className="text-[11px] text-wine-red mt-1 max-w-[220px]">{r.error}</div>}
                  </td>
                  {/* One column instead of four — the buttons on the right are
                      what matters and they were getting pushed off screen. */}
                  <td className="py-2 text-right whitespace-nowrap">
                    <div className="text-xs">{r.scraped_count} scraped</div>
                    {r.status === 'imported' && (
                      <div className="text-[11px] text-graphite">
                        {r.imported_count} new · {r.duplicate_count} updated · {r.rejected_count} rejected
                      </div>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {r.apify_run_id ? (
                      <a
                        href={`https://console.apify.com/actors/compass~crawler-google-places/runs/${r.apify_run_id}`}
                        target="_blank" rel="noopener"
                        className="text-[11px] text-wine-red hover:underline"
                      >open ↗</a>
                    ) : '—'}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {UNFINISHED.includes(r.status) && (
                      <button onClick={() => refresh(r.id)} disabled={busy === r.id}
                        className="text-xs px-2 py-0.5 border border-pale-stone text-graphite rounded-sm hover:border-wine-red hover:text-wine-red disabled:opacity-50">
                        {busy === r.id ? '…' : 'Refresh'}
                      </button>
                    )}
                    {r.status === 'succeeded' && (
                      <button onClick={() => importRun(r.id)} disabled={busy === r.id}
                        className="text-xs px-2 py-0.5 border border-wine-red text-wine-red rounded-sm hover:bg-wine-red hover:text-warm-white disabled:opacity-50">
                        {busy === r.id ? '…' : 'Import'}
                      </button>
                    )}
                    {allRejected && (
                      <button onClick={() => importRun(r.id, true)} disabled={busy === r.id}
                        title="Pull the dataset again with the current filter rules"
                        className="text-xs px-2 py-0.5 border border-pale-stone text-graphite rounded-sm hover:border-wine-red hover:text-wine-red disabled:opacity-50">
                        {busy === r.id ? '…' : 'Re-import'}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-graphite leading-snug">
        Apify keeps a run’s dataset for a limited time — import soon after a run finishes, or the places are gone and the scrape has to be paid for again.
      </p>
    </div>
  )
}

function formatStarted(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

function describeFilters(input: ScrapeRun['input']): string {
  const parts: string[] = []
  if (input.search_terms?.length) parts.push(input.search_terms.join(', '))
  if (input.min_stars)            parts.push(`★ ${input.min_stars}`)
  if (input.min_reviews)          parts.push(`${input.min_reviews}+ reviews`)
  if (input.price_levels?.length) parts.push(input.price_levels.join('/'))
  return parts.join(' · ') || '—'
}
