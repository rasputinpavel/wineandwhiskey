'use client'

import { useState, useEffect, use } from 'react'
import Shell from '@/components/Shell'
import Link from 'next/link'

type Reel = {
  id: string
  status: string
  views_count: number
  likes_count: number | null
  caption: string | null
  thumbnail_url: string | null
  video_url: string | null
  duration_s: number | null
  url: string | null
  trend_accounts: { username: string } | null
}

type Frame = {
  id: string
  timestamp_s: number
  storage_path: string
  url: string | null
}

type Analysis = {
  hook_type: string | null
  hook_text: string | null
  hook_duration_s: number | null
  format_type: string | null
  music_type: string | null
  text_overlays: string[] | null
  why_performs: string | null
  adaptation_score: number | null
  content_structure: Array<{ second: number; description: string; type: string }> | null
  visual_elements: { lighting: string; setting: string; props: string } | null
}

const STATUS_COLOR: Record<string, string> = {
  new: 'bg-gray-700 text-gray-200',
  analyzing: 'bg-blue-900 text-blue-300 animate-pulse',
  analyzed: 'bg-yellow-900 text-yellow-300',
  approved: 'bg-green-900 text-green-300',
  skipped: 'bg-gray-800 text-gray-500',
  briefed: 'bg-purple-900 text-purple-300',
  published: 'bg-indigo-900 text-indigo-300',
}

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

function ScoreDot({ score }: { score: number }) {
  const color = score >= 8 ? 'bg-green-400' : score >= 5 ? 'bg-yellow-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-2">
      <div className={`w-3 h-3 rounded-full ${color}`} />
      <span className="text-white font-semibold">{score}/10</span>
    </div>
  )
}

export default function ReelDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [reel, setReel] = useState<Reel | null>(null)
  const [frames, setFrames] = useState<Frame[]>([])
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [briefLoading, setBriefLoading] = useState(false)

  useEffect(() => {
    loadData()
  }, [id])

  // Poll while analyzing
  useEffect(() => {
    if (reel?.status !== 'analyzing') return
    const interval = setInterval(loadData, 5000)
    return () => clearInterval(interval)
  }, [reel?.status])

  async function loadData() {
    const [reelRes, framesRes, anaRes] = await Promise.all([
      fetch(`/api/reels/${id}`),
      fetch(`/api/reels/${id}/frames`),
      fetch(`/api/reels/${id}/analysis`),
    ])

    if (reelRes.ok) setReel(await reelRes.json())
    if (framesRes.ok) setFrames(await framesRes.json())
    if (anaRes.ok) setAnalysis(await anaRes.json())

    setLoading(false)
  }

  async function handleAnalyze() {
    setAnalyzing(true)
    await fetch(`/api/reels/${id}/analyze`, { method: 'POST' })
    await loadData()
    setAnalyzing(false)
  }

  async function handleStatus(status: string) {
    setActionLoading(true)
    await fetch(`/api/reels/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    await loadData()
    setActionLoading(false)
  }

  async function handleGenerateBrief() {
    setBriefLoading(true)
    const res = await fetch(`/api/reels/${id}/brief`, { method: 'POST' })
    setBriefLoading(false)
    if (res.ok) {
      const brief = await res.json()
      window.location.href = `/brief/${brief.id}`
    }
  }

  if (loading) {
    return (
      <Shell>
        <div className="flex items-center justify-center h-full text-gray-500">Loading…</div>
      </Shell>
    )
  }

  if (!reel) {
    return (
      <Shell>
        <div className="p-8 text-gray-400">Reel not found. <Link href="/discover" className="text-wine-500 underline">Back</Link></div>
      </Shell>
    )
  }

  const account = reel.trend_accounts?.username

  return (
    <Shell>
      <div className="p-8 max-w-5xl">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <Link href="/discover" className="text-gray-500 text-sm hover:text-gray-300 mb-2 inline-block">
              ← Discover
            </Link>
            <div className="flex items-center gap-3 mt-1">
              <h1 className="text-2xl font-bold text-white">@{account}</h1>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLOR[reel.status] ?? ''}`}>
                {reel.status}
              </span>
            </div>
            <div className="flex gap-4 mt-1 text-gray-400 text-sm">
              <span>{fmt(reel.views_count)} views</span>
              {reel.likes_count && <span>{fmt(reel.likes_count)} likes</span>}
              {reel.duration_s && <span>{Math.round(reel.duration_s)}s</span>}
              {reel.url && (
                <a href={reel.url} target="_blank" rel="noreferrer" className="text-wine-500 hover:underline">
                  View on Instagram ↗
                </a>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            {reel.status === 'new' && (
              <button
                onClick={handleAnalyze}
                disabled={analyzing}
                className="px-4 py-2 bg-wine-700 hover:bg-wine-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {analyzing ? 'Analyzing…' : 'Analyze'}
              </button>
            )}
            {reel.status === 'analyzing' && (
              <div className="px-4 py-2 bg-blue-900 text-blue-300 text-sm rounded-lg animate-pulse">
                Analyzing frames…
              </div>
            )}
            {reel.status === 'analyzed' && (
              <>
                <button
                  onClick={() => handleStatus('approved')}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-green-800 hover:bg-green-700 text-green-100 text-sm rounded-lg transition-colors disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  onClick={() => handleStatus('skipped')}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors disabled:opacity-50"
                >
                  Skip
                </button>
              </>
            )}
            {reel.status === 'approved' && (
              <button
                onClick={handleGenerateBrief}
                disabled={briefLoading}
                className="px-4 py-2 bg-purple-800 hover:bg-purple-700 text-purple-100 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {briefLoading ? 'Generating…' : 'Generate Brief'}
              </button>
            )}
            {reel.status === 'briefed' && (
              <Link
                href={`/discover`}
                className="px-4 py-2 bg-purple-900 text-purple-300 text-sm rounded-lg"
              >
                Brief ready →
              </Link>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-8">
          {/* Left: Thumbnail */}
          <div className="col-span-1">
            {reel.thumbnail_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={reel.thumbnail_url}
                alt=""
                className="w-full rounded-xl border border-gray-800 object-cover"
              />
            )}
            {reel.caption && (
              <p className="mt-4 text-gray-400 text-sm leading-relaxed">{reel.caption}</p>
            )}
          </div>

          {/* Right: Frames + Analysis */}
          <div className="col-span-2 space-y-6">
            {/* Frames */}
            {frames.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  Frames ({frames.length})
                </h2>
                <div className="grid grid-cols-3 gap-2">
                  {frames.map(frame => (
                    <div key={frame.id} className="relative rounded-lg overflow-hidden bg-gray-800 aspect-[9/16]">
                      {frame.url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={frame.url} alt="" className="w-full h-full object-cover" />
                      )}
                      <div className="absolute bottom-1 left-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                        {frame.timestamp_s}s
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Analysis */}
            {analysis && (
              <div className="space-y-4">
                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Analysis</h2>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <div className="text-gray-400 text-xs mb-1">Hook type</div>
                    <div className="text-white font-medium">{analysis.hook_type ?? '—'}</div>
                    {analysis.hook_text && (
                      <div className="text-gray-400 text-xs mt-1 italic">"{analysis.hook_text}"</div>
                    )}
                  </div>
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <div className="text-gray-400 text-xs mb-1">Format</div>
                    <div className="text-white font-medium">{analysis.format_type ?? '—'}</div>
                    <div className="text-gray-500 text-xs mt-1">{analysis.music_type}</div>
                  </div>
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <div className="text-gray-400 text-xs mb-1">Adaptation score</div>
                    {analysis.adaptation_score && <ScoreDot score={analysis.adaptation_score} />}
                  </div>
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <div className="text-gray-400 text-xs mb-1">Text overlays</div>
                    <div className="text-white text-sm">
                      {analysis.text_overlays?.length
                        ? analysis.text_overlays.map((t, i) => <div key={i}>"{t}"</div>)
                        : <span className="text-gray-500">None detected</span>
                      }
                    </div>
                  </div>
                </div>

                {analysis.why_performs && (
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <div className="text-gray-400 text-xs mb-2">Why it performs</div>
                    <p className="text-gray-200 text-sm leading-relaxed">{analysis.why_performs}</p>
                  </div>
                )}

                {analysis.content_structure && (
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <div className="text-gray-400 text-xs mb-3">Content structure</div>
                    <div className="space-y-2">
                      {analysis.content_structure.map((item, i) => (
                        <div key={i} className="flex gap-3 text-sm">
                          <span className="text-gray-500 w-8 flex-shrink-0">{item.second}s</span>
                          <span className={`w-14 flex-shrink-0 text-xs px-1.5 py-0.5 rounded text-center ${
                            item.type === 'hook' ? 'bg-wine-900 text-wine-300'
                            : item.type === 'cta' ? 'bg-green-900 text-green-300'
                            : 'bg-gray-800 text-gray-400'
                          }`}>{item.type}</span>
                          <span className="text-gray-300">{item.description}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {reel.status === 'new' && !analysis && (
              <div className="bg-gray-900 border border-dashed border-gray-700 rounded-xl p-8 text-center text-gray-500">
                Click <span className="text-white">Analyze</span> to extract frames and run AI analysis.
              </div>
            )}
          </div>
        </div>
      </div>
    </Shell>
  )
}
