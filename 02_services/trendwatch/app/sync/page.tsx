'use client'

import { useState, useEffect, useRef } from 'react'
import Shell from '@/components/Shell'
import Link from 'next/link'

type FoundReel = {
  url:          string
  account:      string
  views:        number
  trigger_type: 'absolute' | 'relative' | 'both'
  ratio:        number
  thumbnail:    string | null
}

type Job = {
  id:             string
  state:          'running' | 'done' | 'failed'
  phase:          string | null
  phase_label:    string | null
  phase_current:  number | null
  phase_total:    number | null
  logs:           string[]
  found_reels:    FoundReel[]
  total_new:      number
  total_accounts: number
  error:          string | null
  created_at:     string
  updated_at:     string
}

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}
function fmtTime(s: number) {
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

export default function SyncPage() {
  const [jobId, setJobId]   = useState<string | null>(null)
  const [job, setJob]       = useState<Job | null>(null)
  const [error, setError]   = useState<string | null>(null)
  const [now, setNow]       = useState(Date.now())
  const logsEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/reels/sync').then(async r => {
      if (!r.ok) return
      const { job } = await r.json()
      if (job) { setJobId(job.id); setJob(job) }
    })
  }, [])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!jobId) return
    let cancelled = false
    async function tick() {
      try {
        const res = await fetch(`/api/reels/sync/${jobId}`)
        if (!res.ok) return
        const data: Job = await res.json()
        if (cancelled) return
        setJob(data)
      } catch {}
    }
    tick()
    const interval = setInterval(tick, 2000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [jobId])

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [job?.logs.length])

  async function handleStart() {
    setError(null)
    try {
      const res = await fetch('/api/reels/sync', { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      const { job_id } = await res.json()
      setJobId(job_id)
      setJob(null)
    } catch (err) {
      setError(`Network error: ${(err as Error).message}`)
    }
  }

  async function handleStop() {
    if (!jobId) return
    await fetch(`/api/reels/sync/${jobId}`, { method: 'DELETE' })
  }

  const running     = job?.state === 'running'
  const elapsed     = job ? Math.floor((now - new Date(job.created_at).getTime()) / 1000) : 0
  const sinceUpdate = job ? Math.floor((now - new Date(job.updated_at).getTime()) / 1000) : 0
  const progressPct = job?.phase_total ? Math.round((job.phase_current! / job.phase_total) * 100) : 0
  const found       = job?.found_reels ?? []

  return (
    <Shell>
      <div className="p-8 max-w-5xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Sync reels</h1>
          <p className="text-gray-400 text-sm mt-1">
            Скрейпит свежие Reels у всех активных аккаунтов. Порог: ≥15K просмотров ИЛИ ≥1.5x от подписчиков.
          </p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
          <div className="flex gap-3">
            <button
              onClick={handleStart}
              disabled={running}
              className="px-5 py-2.5 bg-wine-700 hover:bg-wine-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {running && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {running ? 'Syncing…' : 'Run sync'}
            </button>
            {running && (
              <button
                onClick={handleStop}
                className="px-5 py-2.5 bg-gray-800 hover:bg-red-900 text-gray-300 hover:text-red-200 text-sm font-medium rounded-lg transition-colors"
              >
                Stop
              </button>
            )}
          </div>

          {error && (
            <div className="mt-3 text-red-400 bg-red-950 border border-red-800 rounded-lg p-3 text-xs font-mono whitespace-pre-wrap">
              {error}
            </div>
          )}
        </div>

        {/* Status + log */}
        {job && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
            <div className="flex items-center justify-between mb-3 text-sm">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${
                  job.state === 'done' ? 'bg-green-500'
                  : job.state === 'failed' ? 'bg-red-500'
                  : sinceUpdate < 8 ? 'bg-green-500 animate-pulse'
                  : 'bg-yellow-500 animate-pulse'
                }`} />
                <span className="text-white font-medium">
                  {job.state === 'done' ? `Готово · ${job.total_new} новых роликов` :
                   job.state === 'failed' ? `Ошибка: ${job.error}` :
                   job.phase_label ? `@${job.phase_label.replace(/^@/, '')}` :
                   'Подключаюсь...'}
                </span>
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-400 font-mono">
                {job.phase_total && <span>{job.phase_current} / {job.phase_total}</span>}
                <span>elapsed {fmtTime(elapsed)}</span>
                {running && (
                  <span title={`Last update ${sinceUpdate}s ago`}>
                    {sinceUpdate < 8 ? '🟢 alive' : sinceUpdate < 60 ? '🟡 slow' : '🔴 stuck'}
                  </span>
                )}
              </div>
            </div>

            {job.phase_total ? (
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden mb-4">
                <div className="h-full bg-wine-700 transition-all duration-300" style={{ width: `${progressPct}%` }} />
              </div>
            ) : null}

            <div className="bg-black/40 rounded-lg p-3 max-h-72 overflow-y-auto font-mono text-xs leading-relaxed">
              {job.logs.map((line, i) => (
                <div key={i} className="text-gray-300 whitespace-pre-wrap">{line}</div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}

        {/* Found reels */}
        {found.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white">
                Найдено {found.length} новых роликов
              </h2>
              <Link href="/discover?status=new" className="text-wine-500 text-sm hover:underline">
                Открыть в Discover →
              </Link>
            </div>

            <div className="grid grid-cols-3 gap-4">
              {found.map((r, i) => (
                <a
                  key={i}
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden hover:border-gray-600 transition-colors group"
                >
                  <div className="aspect-[9/6] bg-gray-800 relative overflow-hidden">
                    {r.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/img?url=${encodeURIComponent(r.thumbnail)}`}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-600 text-3xl">▶</div>
                    )}
                    <div className="absolute top-2 right-2">
                      <span
                        title={
                          r.trigger_type === 'both'
                            ? '≥15K просмотров И ≥1.5× от подписчиков'
                            : r.trigger_type === 'absolute'
                              ? '≥15K просмотров (фикс. порог)'
                              : '≥1.5× от подписчиков (вирусный)'
                        }
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          r.trigger_type === 'both' ? 'bg-green-900 text-green-300'
                          : r.trigger_type === 'absolute' ? 'bg-blue-900 text-blue-300'
                          : 'bg-purple-900 text-purple-300'
                        }`}
                      >
                        {r.trigger_type === 'both' ? '🔥 хит'
                          : r.trigger_type === 'absolute' ? '👁 просмотры'
                          : '📈 вирусный'}
                      </span>
                    </div>
                  </div>
                  <div className="p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-gray-400 text-xs">@{r.account}</span>
                      <span className="text-white font-bold text-sm">{fmt(r.views)}</span>
                    </div>
                    {r.ratio > 0 && (
                      <div className="text-gray-500 text-xs">{r.ratio.toFixed(1)}x от подписчиков</div>
                    )}
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </Shell>
  )
}
