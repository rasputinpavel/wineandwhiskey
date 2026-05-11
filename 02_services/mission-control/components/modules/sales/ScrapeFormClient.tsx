'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  PHUKET_DISTRICTS, BUSINESS_KINDS, BUSINESS_KIND_LABEL,
  KIND_SEARCH_PRESETS, KIND_CATEGORY_FILTER,
  MIN_STARS_OPTIONS, MIN_STARS_LABEL, APIFY_USD_PER_PLACE,
  type District, type BusinessKind, type MinStars,
} from '@/lib/sales/config'
import type { ScrapeRun } from '@/lib/sales/types'

const PRICE_LEVELS = ['$', '$$', '$$$', '$$$$'] as const

export function ScrapeFormClient() {
  const router = useRouter()
  const [districts, setDistricts]   = useState<District[]>([])
  const [kind, setKind]             = useState<BusinessKind>('restaurant')
  const [terms, setTerms]           = useState<string>(KIND_SEARCH_PRESETS.restaurant.join(', '))
  const [categories, setCategories] = useState<string>(KIND_CATEGORY_FILTER.restaurant.join(', '))
  const [minStars, setMinStars]     = useState<MinStars>('')
  const [minReviews, setMinReviews] = useState<number>(0)
  const [prices, setPrices]         = useState<string[]>([])
  const [maxPer, setMaxPer]         = useState<number>(30)
  const [submitting, setSubmitting] = useState(false)
  const [runs, setRuns]             = useState<Array<{ id: string; district: string; run: ScrapeRun | null }>>([])
  const [error, setError]           = useState<string | null>(null)

  const searchTerms = useMemo(() => terms.split(',').map(t => t.trim()).filter(Boolean), [terms])
  const categoryFilter = useMemo(() => categories.split(',').map(t => t.trim()).filter(Boolean), [categories])
  const estimatedPlaces = districts.length * searchTerms.length * maxPer
  const estimatedCost   = estimatedPlaces * APIFY_USD_PER_PLACE

  function onKindChange(next: BusinessKind) {
    setKind(next)
    // Refill presets — saves typing for the common case but caller can edit.
    setTerms(KIND_SEARCH_PRESETS[next].join(', '))
    setCategories(KIND_CATEGORY_FILTER[next].join(', '))
  }

  function toggleDistrict(d: District) {
    setDistricts(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])
  }
  function togglePrice(p: string) {
    setPrices(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])
  }

  async function submit() {
    setError(null)
    if (districts.length === 0)     return setError('Pick at least one district')
    if (searchTerms.length === 0)   return setError('Add at least one search term')

    setSubmitting(true)
    try {
      const res = await fetch('/api/m/sales/scrape', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          districts, business_kind: kind,
          search_terms: searchTerms, category_filter: categoryFilter,
          min_stars: minStars, min_reviews: minReviews, price_levels: prices,
          max_per_search: maxPer,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to start scrape'); return }
      const created = (json.runs as Array<{ id: string; district: string }>).map(r => ({ ...r, run: null }))
      setRuns(created)
      // Kick off polling.
      pollAll(created)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  async function pollAll(items: Array<{ id: string; district: string; run: ScrapeRun | null }>) {
    // Naive interval poll — 10s, until all rows hit a terminal app-side status.
    const ids = items.map(i => i.id)
    const interval = setInterval(async () => {
      const next = await Promise.all(ids.map(async id => {
        const r = await fetch(`/api/m/sales/scrape/${id}`).then(x => x.json()).catch(() => null)
        return { id, run: r?.run ?? null }
      }))
      setRuns(prev => prev.map(row => {
        const fresh = next.find(n => n.id === row.id)
        return fresh && fresh.run ? { ...row, run: fresh.run as ScrapeRun } : row
      }))
      const allDone = next.every(n => {
        const s = (n.run as ScrapeRun | null)?.status
        return s === 'succeeded' || s === 'failed' || s === 'aborted' || s === 'imported'
      })
      if (allDone) clearInterval(interval)
    }, 10_000)
  }

  async function importRun(id: string) {
    const res = await fetch(`/api/m/sales/scrape/${id}/import`, { method: 'POST' })
    const json = await res.json()
    if (!res.ok) { setError(json.error ?? 'Import failed'); return }
    setRuns(prev => prev.map(r => r.id === id
      ? { ...r, run: r.run ? { ...r.run, status: 'imported', imported_count: json.imported, duplicate_count: json.duplicate, rejected_count: json.rejected, scraped_count: json.scraped } : r.run }
      : r))
  }
  async function importAll() {
    const ready = runs.filter(r => r.run?.status === 'succeeded')
    for (const r of ready) await importRun(r.id)
    router.refresh()
  }

  const anyReady = runs.some(r => r.run?.status === 'succeeded')

  return (
    <div className="space-y-6">
      <section className="bg-warm-white border border-pale-stone rounded-md p-5 space-y-4">
        <h2 className="font-heading font-semibold text-deep-black text-base">Scrape parameters</h2>

        <Field label="Districts (Phuket)">
          <div className="flex flex-wrap gap-1.5">
            {PHUKET_DISTRICTS.map(d => (
              <button
                key={d} type="button" onClick={() => toggleDistrict(d)}
                className={
                  districts.includes(d)
                    ? 'text-xs px-2.5 py-1 rounded-sm bg-deep-black text-warm-white'
                    : 'text-xs px-2.5 py-1 rounded-sm bg-cream/40 border border-pale-stone text-graphite hover:border-wine-red hover:text-wine-red'
                }
              >{d}</button>
            ))}
          </div>
        </Field>

        <Field label="Business kind">
          <div className="flex flex-wrap gap-1.5">
            {BUSINESS_KINDS.map(k => (
              <button key={k} type="button" onClick={() => onKindChange(k as BusinessKind)}
                className={
                  kind === k
                    ? 'text-xs px-2.5 py-1 rounded-sm bg-wine-red text-warm-white'
                    : 'text-xs px-2.5 py-1 rounded-sm bg-cream/40 border border-pale-stone text-graphite hover:border-wine-red hover:text-wine-red'
                }
              >{BUSINESS_KIND_LABEL[k as BusinessKind]}</button>
            ))}
          </div>
        </Field>

        <Field label="Search terms (comma-separated)">
          <input value={terms} onChange={e => setTerms(e.target.value)}
            className="w-full text-sm border border-pale-stone bg-warm-white rounded-sm px-2 py-1.5"
          />
        </Field>

        <Field label="Category filter (Apify-side, optional)">
          <input value={categories} onChange={e => setCategories(e.target.value)}
            className="w-full text-sm border border-pale-stone bg-warm-white rounded-sm px-2 py-1.5"
          />
        </Field>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Min rating">
            <select value={minStars} onChange={e => setMinStars(e.target.value as MinStars)}
              className="w-full text-sm border border-pale-stone bg-warm-white rounded-sm px-2 py-1.5">
              {MIN_STARS_OPTIONS.map(s => <option key={s} value={s}>{MIN_STARS_LABEL[s]}</option>)}
            </select>
          </Field>
          <Field label="Min reviews (post-filter)">
            <input type="number" min={0} value={minReviews}
              onChange={e => setMinReviews(parseInt(e.target.value) || 0)}
              className="w-full text-sm border border-pale-stone bg-warm-white rounded-sm px-2 py-1.5"
            />
          </Field>
          <Field label="Max places per search term">
            <input type="number" min={5} max={200} value={maxPer}
              onChange={e => setMaxPer(parseInt(e.target.value) || 30)}
              className="w-full text-sm border border-pale-stone bg-warm-white rounded-sm px-2 py-1.5"
            />
          </Field>
        </div>

        <Field label="Price level (post-filter)">
          <div className="flex gap-1.5">
            {PRICE_LEVELS.map(p => (
              <button key={p} type="button" onClick={() => togglePrice(p)}
                className={
                  prices.includes(p)
                    ? 'text-xs px-2.5 py-1 rounded-sm bg-deep-black text-warm-white'
                    : 'text-xs px-2.5 py-1 rounded-sm bg-cream/40 border border-pale-stone text-graphite hover:border-wine-red hover:text-wine-red'
                }
              >{p}</button>
            ))}
            <span className="text-[11px] text-graphite ml-2 self-center">empty = any</span>
          </div>
        </Field>

        <div className="flex items-center justify-between pt-2 border-t border-pale-stone">
          <div className="text-xs text-graphite">
            Estimate: <span className="text-deep-black">~{estimatedPlaces} places</span>
            {' '}· <span className="text-deep-black">${estimatedCost.toFixed(2)}</span>
            <span className="text-[10px] ml-1">(Apify $2.10 / 1k)</span>
          </div>
          <button disabled={submitting} onClick={submit}
            className="text-sm px-4 py-2 bg-wine-red text-warm-white rounded-sm hover:bg-burgundy-deep disabled:opacity-50 transition-colors"
          >{submitting ? 'Starting…' : 'Run scrape'}</button>
        </div>
        {error && <div className="text-xs text-wine-red bg-wine-red/8 border border-wine-red/30 rounded-sm px-3 py-2">{error}</div>}
      </section>

      {runs.length > 0 && (
        <section className="bg-warm-white border border-pale-stone rounded-md p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-heading font-semibold text-deep-black text-base">Active scrapes</h2>
            {anyReady && (
              <button onClick={importAll}
                className="text-xs px-3 py-1.5 bg-wine-red text-warm-white rounded-sm hover:bg-burgundy-deep transition-colors">
                Import all ready
              </button>
            )}
          </div>
          <table className="w-full text-sm">
            <thead className="text-graphite text-xs">
              <tr className="text-left">
                <th className="py-1">District</th>
                <th className="py-1">Status</th>
                <th className="py-1 text-right">Scraped</th>
                <th className="py-1 text-right">Imported</th>
                <th className="py-1 text-right">Duplicate</th>
                <th className="py-1 text-right">Rejected</th>
                <th className="py-1 text-right">Apify</th>
                <th className="py-1"></th>
              </tr>
            </thead>
            <tbody>
              {runs.map(r => {
                const s = r.run?.status ?? 'pending'
                // Empty = actor finished + we already pulled the dataset and it had nothing
                // (or post-filters dropped everything). scraped_count is the live datasetItemCount
                // after status='succeeded', and the actual fetched count after status='imported'.
                const empty = s === 'imported' && (r.run?.scraped_count ?? 0) === 0
                return (
                  <tr key={r.id} className="border-t border-pale-stone">
                    <td className="py-2">{r.district}</td>
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <StatusChip status={s} />
                        {empty && <span className="text-[11px] text-wine-red" title="Apify returned 0 items — open Console for the log">empty ⚠</span>}
                      </div>
                    </td>
                    <td className="py-2 text-right text-xs">{r.run?.scraped_count ?? '—'}</td>
                    <td className="py-2 text-right text-xs">{r.run?.imported_count ?? '—'}</td>
                    <td className="py-2 text-right text-xs">{r.run?.duplicate_count ?? '—'}</td>
                    <td className="py-2 text-right text-xs">{r.run?.rejected_count ?? '—'}</td>
                    <td className="py-2 text-right">
                      {r.run?.apify_run_id ? (
                        <a
                          href={`https://console.apify.com/actors/compass~crawler-google-places/runs/${r.run.apify_run_id}`}
                          target="_blank" rel="noopener"
                          className="text-[11px] text-wine-red hover:underline"
                        >open ↗</a>
                      ) : '—'}
                    </td>
                    <td className="py-2 text-right">
                      {s === 'succeeded' && (
                        <button onClick={() => importRun(r.id)}
                          className="text-xs px-2 py-0.5 border border-wine-red text-wine-red rounded-sm hover:bg-wine-red hover:text-warm-white">
                          Import
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {runs.some(r => r.run?.status === 'imported' && (r.run?.scraped_count ?? 0) === 0) && (
            <p className="text-[11px] text-graphite mt-3 leading-snug">
              Actor returned no places. Most likely the <code>locationQuery</code> didn’t resolve cleanly or the filters (category / min rating / min reviews / price) are too tight. Open Apify Console for the run log; the input JSON and search progress are there.
            </p>
          )}
        </section>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="overline text-graphite block">{label}</label>
      {children}
    </div>
  )
}

function StatusChip({ status }: { status: string }) {
  const color =
    status === 'imported'  ? 'bg-deep-black text-warm-white' :
    status === 'succeeded' ? 'bg-amber-gold text-deep-black' :
    status === 'failed' || status === 'aborted' ? 'bg-wine-red text-warm-white' :
    'bg-cream text-graphite'
  return <span className={`text-[11px] px-2 py-0.5 rounded-sm uppercase ${color}`}>{status}</span>
}
