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
  selected:        boolean
}

const SEED_HASHTAGS = [
  'winestore', 'wineshop', 'winebar', 'sommelier',
  'naturalwine', 'wineretail', 'finewine', 'winelover', 'whiskybar',
]

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

type Phase = { phase: 'hashtag' | 'account'; current: number; total: number; label: string } | null

export default function AccountDiscoverPage() {
  const [hashtags, setHashtags]     = useState(SEED_HASHTAGS.join(', '))
  const [running, setRunning]       = useState(false)
  const [logs, setLogs]             = useState<string[]>([])
  const [phase, setPhase]           = useState<Phase>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [saving, setSaving]         = useState(false)
  const [saved, setSaved]           = useState(false)
  const logsEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [logs])

  async function handleDiscover() {
    setRunning(true)
    setCandidates([])
    setLogs([])
    setPhase(null)
    setSaved(false)
    const tags = hashtags.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean)

    const res = await fetch('/api/accounts/discover', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ hashtags: tags }),
    })

    if (!res.ok || !res.body) {
      setLogs(prev => [...prev, `✗ HTTP ${res.status}`])
      setRunning(false)
      return
    }

    const reader  = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const event = JSON.parse(line)
          if (event.type === 'log') {
            setLogs(prev => [...prev, event.message])
          } else if (event.type === 'phase') {
            setPhase({ phase: event.phase, current: event.current, total: event.total, label: event.label })
          } else if (event.type === 'candidate') {
            setCandidates(prev => [...prev, { ...event.candidate, selected: event.candidate.relevance_score >= 7 }])
          } else if (event.type === 'done') {
            setCandidates(event.candidates.map((c: Omit<Candidate, 'selected'>) => ({ ...c, selected: c.relevance_score >= 7 })))
          }
        } catch {}
      }
    }

    setRunning(false)
    setPhase(null)
  }

  function toggle(username: string) {
    setCandidates(prev => prev.map(c => c.username === username ? { ...c, selected: !c.selected } : c))
  }

  async function handleSave() {
    const selected = candidates.filter(c => c.selected)
    if (!selected.length) return
    setSaving(true)
    for (const c of selected) {
      await fetch('/api/accounts', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username: c.username, display_name: c.display_name, category: c.category }),
      })
    }
    setSaving(false)
    setSaved(true)
  }

  const selectedCount = candidates.filter(c => c.selected).length
  const progressPct   = phase ? Math.round((phase.current / phase.total) * 100) : 0

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
            rows={2}
            disabled={running}
            className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-gray-500 resize-none disabled:opacity-50"
            placeholder="winestore, wineshop, sommelier…"
          />
          <p className="text-gray-500 text-xs mt-2">Comma-separated. No # needed. Each hashtag takes ~10–30 sec on Apify.</p>

          <button
            onClick={handleDiscover}
            disabled={running}
            className="mt-4 px-5 py-2.5 bg-wine-700 hover:bg-wine-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {running && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {running ? 'Searching…' : 'Find accounts'}
          </button>
        </div>

        {/* Progress + log */}
        {(running || logs.length > 0) && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
            {phase && (
              <>
                <div className="flex items-center justify-between mb-2 text-sm">
                  <span className="text-gray-300 font-medium">
                    {phase.phase === 'hashtag' ? 'Сканирование хэштегов' : 'Проверка профилей'} · {phase.label}
                  </span>
                  <span className="text-gray-500 font-mono">{phase.current} / {phase.total}</span>
                </div>
                <div className="h-2 bg-gray-800 rounded-full overflow-hidden mb-4">
                  <div
                    className="h-full bg-wine-700 transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </>
            )}

            <div className="bg-black/40 rounded-lg p-3 max-h-72 overflow-y-auto font-mono text-xs leading-relaxed">
              {logs.map((line, i) => (
                <div key={i} className="text-gray-300 whitespace-pre-wrap">{line}</div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}

        {candidates.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white">
                {candidates.length} candidates found · {selectedCount} selected
              </h2>
              {saved ? (
                <div className="flex items-center gap-3">
                  <span className="text-green-400 text-sm">✓ Saved to accounts</span>
                  <Link href="/accounts" className="text-wine-500 text-sm hover:underline">Go to accounts →</Link>
                </div>
              ) : (
                <button
                  onClick={handleSave}
                  disabled={saving || !selectedCount || running}
                  className="px-4 py-2 bg-green-800 hover:bg-green-700 text-green-100 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  {saving ? 'Saving…' : `Save ${selectedCount} accounts`}
                </button>
              )}
            </div>

            <div className="space-y-2">
              {candidates
                .sort((a, b) => b.relevance_score - a.relevance_score)
                .map(c => (
                  <button
                    key={c.username}
                    onClick={() => toggle(c.username)}
                    className={`w-full text-left flex items-center gap-4 px-4 py-3 rounded-xl border transition-colors ${
                      c.selected
                        ? 'bg-wine-950 border-wine-800'
                        : 'bg-gray-900 border-gray-800 hover:border-gray-700'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded border flex-shrink-0 flex items-center justify-center ${
                      c.selected ? 'bg-wine-700 border-wine-600' : 'border-gray-600'
                    }`}>
                      {c.selected && <span className="text-white text-xs">✓</span>}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-medium">@{c.username}</span>
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
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>
    </Shell>
  )
}
