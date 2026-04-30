'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

type PriceList = {
  id: string
  supplier_name: string | null
  date: string | null
  status: string
  item_count: number
  uploaded_at: string
  error_message: string | null
}

type EnrichState = 'idle' | 'starting' | 'running' | 'paused' | 'done' | 'error'

type EnrichStatus = {
  state: EnrichState
  enriched: number
  total: number
  failed: number
  cacheHits: number
  apifyRuns: number
  jobId: string | null
  msg?: string
}

type StatusRes = {
  total: number
  enriched: number
  failed: number
  job: null | {
    id: string
    state: 'queued' | 'running' | 'paused' | 'done' | 'failed'
    mode: 'missing' | 'failed' | 'all'
    total: number
    processed: number
    enriched: number
    not_found: number
    cache_hits: number
    apify_runs: number
    last_error: string | null
  }
}

const EMPTY_STATUS: EnrichStatus = { state: 'idle', enriched: 0, total: 0, failed: 0, cacheHits: 0, apifyRuns: 0, jobId: null }

function applyStatusRes(s: StatusRes): EnrichStatus {
  const total = s.total
  const enriched = s.enriched
  const failed = s.failed
  const job = s.job

  // Decide UI state. wine_items counters drive "done" when enriched >= total
  // unless there's an active job in another state.
  if (job && job.state === 'running')  return { state: 'running', enriched, total, failed, cacheHits: job.cache_hits, apifyRuns: job.apify_runs, jobId: job.id }
  if (job && job.state === 'queued')   return { state: 'starting', enriched, total, failed, cacheHits: job.cache_hits, apifyRuns: job.apify_runs, jobId: job.id }
  if (job && job.state === 'paused')   return { state: 'paused', enriched, total, failed, cacheHits: job.cache_hits, apifyRuns: job.apify_runs, jobId: job.id }
  if (job && job.state === 'failed')   return { state: 'error', enriched, total, failed, cacheHits: job.cache_hits, apifyRuns: job.apify_runs, jobId: job.id, msg: job.last_error ?? 'Ошибка' }

  if (total > 0 && enriched >= total) return { state: 'done', enriched, total, failed, cacheHits: job?.cache_hits ?? 0, apifyRuns: job?.apify_runs ?? 0, jobId: job?.id ?? null }
  // No active job. Even if some wines were enriched in a previous run,
  // remaining ones are eligible for a fresh `missing` job — show idle so the
  // primary 🍇 button appears (resume on a done/failed job is a no-op).
  return { ...EMPTY_STATUS, total, enriched, failed }
}

export default function PriceListsPage() {
  const [lists, setLists] = useState<PriceList[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [enrichStatus, setEnrichStatus] = useState<Record<string, EnrichStatus>>({})
  const pollRef = useRef<Record<string, ReturnType<typeof setInterval>>>({})

  function setStatus(id: string, patch: Partial<EnrichStatus>) {
    setEnrichStatus(prev => ({ ...prev, [id]: { ...EMPTY_STATUS, ...prev[id], ...patch } }))
  }

  function stopPoll(id: string) {
    if (pollRef.current[id]) {
      clearInterval(pollRef.current[id])
      delete pollRef.current[id]
    }
  }

  function startPoll(id: string) {
    stopPoll(id)
    pollRef.current[id] = setInterval(async () => {
      const res = await fetch(`/api/vivino/status?price_list_id=${id}`)
      if (!res.ok) return
      const data = await res.json() as StatusRes
      const next = applyStatusRes(data)
      setEnrichStatus(prev => ({ ...prev, [id]: next }))
      if (next.state === 'done' || next.state === 'error' || next.state === 'paused') {
        stopPoll(id)
      }
    }, 4000)
  }

  async function load(): Promise<PriceList[]> {
    const res = await fetch('/api/price-lists')
    const data: PriceList[] = res.ok ? await res.json() : []
    setLists(data)
    setLoading(false)
    return data
  }

  useEffect(() => {
    load().then(async all => {
      await Promise.all(
        all.filter(pl => pl.status === 'done' && pl.item_count > 0).map(async pl => {
          const sr = await fetch(`/api/vivino/status?price_list_id=${pl.id}`)
          if (!sr.ok) return
          const data = await sr.json() as StatusRes
          const next = applyStatusRes(data)
          setEnrichStatus(prev => ({ ...prev, [pl.id]: next }))
          if (next.state === 'running' || next.state === 'starting') startPoll(pl.id)
        })
      )
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => { Object.keys(pollRef.current).forEach(stopPoll) }, [])

  async function handleEnrich(id: string, mode: 'missing' | 'failed' | 'all' = 'missing') {
    setStatus(id, { state: 'starting' })
    const res = await fetch('/api/vivino/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price_list_id: id, mode }),
    })
    const json = await res.json()
    if (res.ok) {
      setStatus(id, { state: 'running', jobId: json.job_id ?? null })
      startPoll(id)
    } else {
      setStatus(id, { state: 'error', msg: json.error ?? json.message ?? 'Ошибка' })
    }
  }

  async function handlePause(id: string) {
    const jobId = enrichStatus[id]?.jobId
    if (!jobId) return
    stopPoll(id)
    setStatus(id, { state: 'paused' })
    await fetch(`/api/vivino/jobs/${jobId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pause' }),
    })
  }

  async function handleResume(id: string) {
    const jobId = enrichStatus[id]?.jobId
    if (!jobId) return
    const res = await fetch(`/api/vivino/jobs/${jobId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resume' }),
    })
    if (res.ok) {
      setStatus(id, { state: 'running' })
      startPoll(id)
    }
  }

  async function handleStop(id: string) {
    const jobId = enrichStatus[id]?.jobId
    stopPoll(id)
    setStatus(id, { state: 'idle' })
    if (jobId) {
      await fetch(`/api/vivino/jobs/${jobId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      })
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Удалить прайс «${name}»? Все позиции будут удалены.`)) return
    setDeleting(id)
    await fetch(`/api/price-lists/${id}`, { method: 'DELETE' })
    setLists(prev => prev.filter(l => l.id !== id))
    setDeleting(null)
  }

  return (
    <div className="min-h-screen bg-[#f8f7f5]">
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-2">
          <Link href="/" className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <span className="text-wine-600 font-bold text-lg tracking-tight">Загруженные прайсы</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-2">
        {loading && (
          <div className="text-center py-12 text-gray-400 text-sm">Загрузка...</div>
        )}
        {!loading && lists.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">Нет загруженных прайсов</div>
        )}
        {lists.map(pl => {
          const name = (pl.supplier_name && pl.supplier_name !== 'null') ? pl.supplier_name : 'Без поставщика'
          const date = pl.date ? new Date(pl.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : null
          const uploadedAt = new Date(pl.uploaded_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
          const es = enrichStatus[pl.id] ?? { state: 'idle', enriched: 0, total: 0 }

          return (
            <div key={pl.id} className="bg-white rounded-2xl border border-gray-100 px-5 py-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900 truncate">{name}</span>
                  {pl.status === 'processing' && (
                    <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full animate-pulse">Обработка</span>
                  )}
                  {pl.status === 'error' && (
                    <span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded-full" title={pl.error_message ?? ''}>Ошибка</span>
                  )}
                </div>
                <div className="text-xs text-gray-400 mt-0.5 flex gap-2">
                  {date && <span>{date}</span>}
                  {date && <span>·</span>}
                  <span>{pl.item_count} позиций</span>
                  <span>·</span>
                  <span>загружен {uploadedAt}</span>
                </div>
              </div>

              {pl.status === 'done' && pl.item_count > 0 && (
                <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
                  <div className="flex items-center gap-1">
                    {/* Main Vivino / Заново / Повторить ошибки */}
                    {(es.state === 'idle' || es.state === 'done' || es.state === 'error') && (
                      <>
                        {es.failed > 0 && (
                          <button
                            onClick={() => handleEnrich(pl.id, 'failed')}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors"
                            title={`Повторить только не загруженные (${es.failed})`}
                          >
                            🔁 Ошибки ({es.failed})
                          </button>
                        )}
                        <button
                          onClick={() => handleEnrich(pl.id, es.state === 'idle' ? 'missing' : 'all')}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors"
                          title={
                            es.state === 'done'  ? 'Запустить заново (все позиции)' :
                            es.state === 'error' ? 'Запустить заново' :
                            'Обогатить недостающие'
                          }
                        >
                          🍇 {es.state === 'done' ? 'Заново' : es.state === 'error' ? 'Повторить' : 'Vivino'}
                        </button>
                      </>
                    )}

                    {/* Starting: spinner + Stop (so a stuck queued job can be cancelled) */}
                    {es.state === 'starting' && (
                      <>
                        <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-400">
                          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                          </svg>
                          Запуск...
                        </div>
                        <button
                          onClick={() => handleStop(pl.id)}
                          className="p-1.5 text-xs text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                          title="Отменить запуск"
                        >
                          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                            <rect x="5" y="5" width="14" height="14" rx="1"/>
                          </svg>
                        </button>
                      </>
                    )}

                    {/* Running controls: Pause + Stop */}
                    {es.state === 'running' && (
                      <>
                        <button
                          onClick={() => handlePause(pl.id)}
                          className="p-1.5 text-xs text-amber-600 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors"
                          title="Пауза"
                        >
                          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                            <rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>
                          </svg>
                        </button>
                        <button
                          onClick={() => handleStop(pl.id)}
                          className="p-1.5 text-xs text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                          title="Стоп"
                        >
                          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                            <rect x="5" y="5" width="14" height="14" rx="1"/>
                          </svg>
                        </button>
                      </>
                    )}

                    {/* Paused controls: Resume + Stop */}
                    {es.state === 'paused' && (
                      <>
                        <button
                          onClick={() => handleResume(pl.id)}
                          className="p-1.5 text-xs text-green-600 bg-green-50 hover:bg-green-100 rounded-lg transition-colors"
                          title="Продолжить"
                        >
                          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z"/>
                          </svg>
                        </button>
                        <button
                          onClick={() => handleStop(pl.id)}
                          className="p-1.5 text-xs text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                          title="Стоп"
                        >
                          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                            <rect x="5" y="5" width="14" height="14" rx="1"/>
                          </svg>
                        </button>
                      </>
                    )}
                  </div>

                  {/* Status text */}
                  {es.state === 'running' && (
                    <span className="flex items-center gap-1 text-xs text-purple-500 tabular-nums">
                      <svg className="w-3 h-3 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                      {es.total > 0 ? `${es.enriched} из ${es.total}` : 'Ждём...'}
                    </span>
                  )}
                  {es.state === 'paused' && (
                    <span className="text-xs text-amber-500 tabular-nums">
                      Пауза {es.total > 0 ? `· ${es.enriched} из ${es.total}` : ''}
                    </span>
                  )}
                  {es.state === 'done' && (
                    <span className="text-xs text-green-600 tabular-nums">
                      Готово: {es.enriched} из {es.total}
                      {es.cacheHits > 0 && <span className="text-gray-400"> · кэш: {es.cacheHits}</span>}
                    </span>
                  )}
                  {es.state === 'error' && (
                    <span className="text-xs text-red-500">{es.msg}</span>
                  )}
                </div>
              )}

              <button
                onClick={() => handleDelete(pl.id, name)}
                disabled={deleting === pl.id}
                className="flex-shrink-0 p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors disabled:opacity-40"
                title="Удалить прайс"
              >
                {deleting === pl.id ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                )}
              </button>
            </div>
          )
        })}
      </main>
    </div>
  )
}
