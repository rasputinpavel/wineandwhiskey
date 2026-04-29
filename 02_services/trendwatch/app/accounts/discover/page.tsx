'use client'

import { useState, useRef, useEffect } from 'react'
import Shell from '@/components/Shell'
import Link from 'next/link'

type Candidate = {
  username:        string
  display_name:    string | null
  followers_count: number
  avg_reel_views:  number
  relevance_score: number
  category:        string
  sample_reel_url: string | null
  selected?:       boolean
}

type Job = {
  id:            string
  state:         'running' | 'done' | 'failed'
  hashtags:      string[]
  phase:         string | null
  phase_label:   string | null
  phase_current: number | null
  phase_total:   number | null
  logs:          string[]
  candidates:    Candidate[]
  error:         string | null
  created_at:    string
  updated_at:    string
}

const SEED_HASHTAGS = [
  'winestore', 'wineshop', 'wineretail', 'finewine', 'bottleshop',
  'winebar', 'winelounge', 'enoteca',
  'naturalwine', 'orangewine',
  'sommelier', 'wineeducator',
  'whiskybar', 'winelovers',
]

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

export default function AccountDiscoverPage() {
  const [hashtags, setHashtags]     = useState(SEED_HASHTAGS.join(', '))
  const [jobId, setJobId]           = useState<string | null>(null)
  const [job, setJob]               = useState<Job | null>(null)
  const [selected, setSelected]     = useState<Set<string>>(new Set())
  const [saving, setSaving]         = useState(false)
  const [saved, setSaved]           = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [now, setNow]               = useState(Date.now())
  const logsEndRef = useRef<HTMLDivElement>(null)

  // 1. On mount: check for active job to resume
  useEffect(() => {
    fetch('/api/accounts/discover').then(async r => {
      if (!r.ok) return
      const { job } = await r.json()
      if (job) {
        setJobId(job.id)
        setJob(job)
      }
    })
  }, [])

  // 2. Tick clock every second for elapsed display + alive indicator
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // 3. Poll job status while running
  useEffect(() => {
    if (!jobId) return
    let cancelled = false
    async function tick() {
      try {
        const res = await fetch(`/api/accounts/discover/${jobId}`)
        if (!res.ok) return
        const data: Job = await res.json()
        if (cancelled) return
        setJob(data)
        // Auto-pre-select strong candidates that user hasn't touched yet
        setSelected(prev => {
          if (prev.size > 0) return prev
          const next = new Set<string>()
          for (const c of data.candidates) if (c.relevance_score >= 7) next.add(c.username)
          return next
        })
      } catch {}
    }
    tick()
    const interval = setInterval(tick, 2000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [jobId])

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [job?.logs.length])

  async function handleStart() {
    setSaved(false)
    setSelected(new Set())
    setStartError(null)
    const tags = hashtags.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean)

    try {
      const res = await fetch('/api/accounts/discover', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ hashtags: tags }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setStartError(body.error ?? `HTTP ${res.status} — возможно миграция 004 не применена`)
        return
      }
      const { job_id } = await res.json()
      setJobId(job_id)
      setJob(null)
    } catch (err) {
      setStartError(`Network error: ${(err as Error).message}`)
    }
  }

  function toggle(username: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(username)) next.delete(username); else next.add(username)
      return next
    })
  }

  async function handleStop() {
    if (!jobId) return
    await fetch(`/api/accounts/discover/${jobId}`, { method: 'DELETE' })
    // The next poll will pick up the failed state
  }

  async function handleSave() {
    if (!job) return
    const picked = job.candidates.filter(c => selected.has(c.username))
    if (!picked.length) return
    setSaving(true)
    for (const c of picked) {
      await fetch('/api/accounts', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username: c.username, display_name: c.display_name, category: c.category }),
      })
    }
    setSaving(false)
    setSaved(true)
  }

  const running       = job?.state === 'running'
  const candidates    = job?.candidates ?? []
  const sortedCands   = [...candidates].sort((a, b) => b.relevance_score - a.relevance_score)
  const elapsed       = job ? Math.floor((now - new Date(job.created_at).getTime()) / 1000) : 0
  const sinceUpdate   = job ? Math.floor((now - new Date(job.updated_at).getTime()) / 1000) : 0
  const progressPct   = job?.phase_total ? Math.round((job.phase_current! / job.phase_total) * 100) : 0
  const selectedCount = selected.size

  return (
    <Shell>
      <div className="p-8 max-w-4xl">
        <div className="mb-8">
          <Link href="/accounts" className="text-gray-500 text-sm hover:text-gray-300 mb-2 inline-block">← Accounts</Link>
          <h1 className="text-2xl font-bold text-white">Find accounts</h1>
          <p className="text-gray-400 text-sm mt-1">
            Searches recent Reels by hashtag, scores accounts for relevance.
          </p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Hashtags to search
          </label>
          <textarea
            value={hashtags}
            onChange={e => setHashtags(e.target.value)}
            rows={3}
            disabled={running}
            className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-gray-500 resize-none disabled:opacity-50"
            placeholder="winestore, wineshop, sommelier…"
          />
          <p className="text-gray-500 text-xs mt-2">Comma-separated. No # needed. Each hashtag takes ~30–90 sec on Apify.</p>

          <div className="mt-4 flex gap-3">
            <button
              onClick={handleStart}
              disabled={running}
              className="px-5 py-2.5 bg-wine-700 hover:bg-wine-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {running && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {running ? 'Running…' : 'Find accounts'}
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

          {startError && (
            <div className="mt-3 text-red-400 bg-red-950 border border-red-800 rounded-lg p-3 text-xs font-mono whitespace-pre-wrap">
              {startError}
            </div>
          )}
        </div>

        {/* Status + log — survives reload */}
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
                  {job.state === 'done' ? 'Готово' :
                   job.state === 'failed' ? `Ошибка: ${job.error}` :
                   job.phase ? `${job.phase === 'hashtag' ? 'Сканирование хэштегов' : 'Проверка профилей'} · ${job.phase_label}` :
                   'Подключаюсь к Apify…'}
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
              {running && (
                <div className="text-gray-600 italic mt-1">
                  Apify сейчас крутит actor — обычно 30–90 сек на хэштег.
                </div>
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}

        {sortedCands.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white">
                {sortedCands.length} candidates {running ? '(пополняется...)' : 'found'} · {selectedCount} selected
              </h2>
              {saved ? (
                <div className="flex items-center gap-3">
                  <span className="text-green-400 text-sm">✓ Saved to accounts</span>
                  <Link href="/accounts" className="text-wine-500 text-sm hover:underline">Go to accounts →</Link>
                </div>
              ) : (
                <button
                  onClick={handleSave}
                  disabled={saving || !selectedCount}
                  className="px-4 py-2 bg-green-800 hover:bg-green-700 text-green-100 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  {saving ? 'Saving…' : `Save ${selectedCount} accounts`}
                </button>
              )}
            </div>

            <div className="space-y-2">
              {sortedCands.map(c => {
                const isSel = selected.has(c.username)
                return (
                  <div
                    key={c.username}
                    role="button"
                    tabIndex={0}
                    onClick={() => toggle(c.username)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(c.username) } }}
                    className={`w-full text-left flex items-center gap-4 px-4 py-3 rounded-xl border transition-colors cursor-pointer ${
                      isSel
                        ? 'bg-wine-950 border-wine-800'
                        : 'bg-gray-900 border-gray-800 hover:border-gray-700'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded border flex-shrink-0 flex items-center justify-center ${
                      isSel ? 'bg-wine-700 border-wine-600' : 'border-gray-600'
                    }`}>
                      {isSel && <span className="text-white text-xs">✓</span>}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <a
                          href={`https://www.instagram.com/${c.username}/`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="text-white font-medium hover:text-wine-400 hover:underline"
                          title="Открыть в Instagram"
                        >
                          @{c.username} ↗
                        </a>
                        {c.display_name && <span className="text-gray-500 text-sm">{c.display_name}</span>}
                        <span className="text-xs px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded">{c.category}</span>
                      </div>
                    </div>

                    <div className="flex gap-5 text-sm text-gray-400 flex-shrink-0">
                      <span>{fmt(c.followers_count)} followers</span>
                      <span>{fmt(c.avg_reel_views)} avg views</span>
                      <span className={
                        c.relevance_score >= 8 ? 'text-green-400 font-semibold'
                        : c.relevance_score >= 5 ? 'text-yellow-400'
                        : 'text-gray-500'
                      }>
                        {c.relevance_score}/10
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </Shell>
  )
}
