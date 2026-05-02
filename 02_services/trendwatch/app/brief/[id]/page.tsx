'use client'

import { useState, useEffect, use } from 'react'
import Shell from '@/components/Shell'
import Link from 'next/link'

type Brief = {
  id: string
  reel_id: string
  hook_options: Array<{ text: string; style: string }> | null
  content_outline: Array<{ step: number; description: string; duration_s: number }> | null
  music_direction: string | null
  text_overlay_copy: string[] | null
  visual_notes: string | null
  filming_instructions: string | null
  visual_prompts: Array<{ scene: string; prompt_en: string; duration_s: number }> | null
  video_url: string | null
  video_status: string
}

const VIDEO_STATUS_LABEL: Record<string, string> = {
  idle: 'Not generated',
  generating: 'Generating clips…',
  assembling: 'Assembling video…',
  ready: 'Ready to download',
  error: 'Generation failed',
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button
      onClick={copy}
      className="ml-2 text-xs text-gray-500 hover:text-gray-300 transition-colors"
    >
      {copied ? '✓' : 'copy'}
    </button>
  )
}

export default function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [brief, setBrief] = useState<Brief | null>(null)
  const [loading, setLoading] = useState(true)
  const [generatingVideo, setGeneratingVideo] = useState(false)

  useEffect(() => {
    loadBrief()
  }, [id])

  useEffect(() => {
    if (brief?.video_status === 'generating' || brief?.video_status === 'assembling') {
      const interval = setInterval(pollVideoStatus, 8000)
      return () => clearInterval(interval)
    }
  }, [brief?.video_status])

  async function loadBrief() {
    const res = await fetch(`/api/brief/${id}`)
    if (res.ok) setBrief(await res.json())
    setLoading(false)
  }

  async function pollVideoStatus() {
    const res = await fetch(`/api/brief/${id}/video-status`)
    if (!res.ok) return
    const { video_status, video_url } = await res.json()
    setBrief(prev => prev ? { ...prev, video_status, video_url } : prev)
  }

  async function handleGenerateVideo() {
    if (!brief?.visual_prompts?.length) return
    setGeneratingVideo(true)
    const res = await fetch(`/api/brief/${id}/generate-video`, { method: 'POST' })
    if (res.ok) {
      setBrief(prev => prev ? { ...prev, video_status: 'generating' } : prev)
    }
    setGeneratingVideo(false)
  }

  async function handlePublish() {
    const url = prompt('Instagram URL of your published reel:')
    if (!url) return
    await fetch('/api/our-reels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reel_id: brief?.reel_id,
        brief_id: id,
        instagram_url: url,
        published_at: new Date().toISOString(),
      }),
    })
    window.location.href = '/track'
  }

  if (loading) {
    return <Shell><div className="flex items-center justify-center h-full text-gray-500">Loading…</div></Shell>
  }

  if (!brief) {
    return <Shell><div className="p-8 text-gray-400">Brief not found. <Link href="/discover" className="text-wine-500 underline">Back</Link></div></Shell>
  }

  const isGenerating = brief.video_status === 'generating' || brief.video_status === 'assembling'

  return (
    <Shell>
      <div className="p-8 max-w-4xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link href="/discover" className="text-gray-500 text-sm hover:text-gray-300 mb-2 inline-block">← Discover</Link>
            <h1 className="text-2xl font-bold text-white">Content Brief</h1>
          </div>
          <div className="flex gap-2">
            {brief.video_status === 'ready' && brief.video_url && (
              <a
                href={brief.video_url}
                target="_blank"
                rel="noreferrer"
                className="px-4 py-2 bg-indigo-700 hover:bg-indigo-600 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Download .mp4
              </a>
            )}
            <button
              onClick={handlePublish}
              className="px-4 py-2 bg-green-800 hover:bg-green-700 text-green-100 text-sm font-medium rounded-lg transition-colors"
            >
              Mark as published
            </button>
          </div>
        </div>

        <div className="space-y-6">
          {/* Hook options */}
          {brief.hook_options && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Hook options</h2>
              <div className="space-y-3">
                {brief.hook_options.map((h, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 bg-gray-800 rounded-lg">
                    <span className="text-gray-500 text-sm w-6 flex-shrink-0 mt-0.5">{i + 1}.</span>
                    <div className="flex-1">
                      <div className="text-white">{h.text}</div>
                      <div className="text-gray-500 text-xs mt-1">{h.style}</div>
                    </div>
                    <CopyButton text={h.text} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Content outline */}
          {brief.content_outline && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Content outline</h2>
              <div className="space-y-2">
                {brief.content_outline.map((step, i) => (
                  <div key={i} className="flex gap-4 items-start">
                    <span className="text-gray-500 text-sm w-8 flex-shrink-0 text-right">{step.duration_s}s</span>
                    <div className="flex-1 text-gray-200 text-sm py-1 border-l border-gray-700 pl-4">
                      {step.description}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Text overlays */}
          {brief.text_overlay_copy && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Text overlays</h2>
              <div className="space-y-2">
                {brief.text_overlay_copy.map((line, i) => (
                  <div key={i} className="flex items-center justify-between p-2 bg-gray-800 rounded-lg">
                    <span className="text-white">{line}</span>
                    <CopyButton text={line} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Music + Visual notes */}
          <div className="grid grid-cols-2 gap-4">
            {brief.music_direction && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Music</h2>
                <p className="text-gray-200 text-sm">{brief.music_direction}</p>
              </div>
            )}
            {brief.visual_notes && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Visual notes</h2>
                <p className="text-gray-200 text-sm">{brief.visual_notes}</p>
              </div>
            )}
          </div>

          {/* Filming instructions (talking head) */}
          {brief.filming_instructions && (
            <div className="bg-amber-950 border border-amber-800 rounded-xl p-6">
              <h2 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-3">
                ⚠ Filming instructions (shoot manually)
              </h2>
              <p className="text-amber-100 text-sm leading-relaxed">{brief.filming_instructions}</p>
            </div>
          )}

          {/* Video generation */}
          {brief.visual_prompts && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  AI video generation (Runway Gen-3)
                </h2>
                <span className={`text-xs px-2 py-0.5 rounded ${
                  brief.video_status === 'ready' ? 'bg-green-900 text-green-300'
                  : isGenerating ? 'bg-blue-900 text-blue-300 animate-pulse'
                  : brief.video_status === 'error' ? 'bg-red-900 text-red-300'
                  : 'bg-gray-800 text-gray-400'
                }`}>
                  {VIDEO_STATUS_LABEL[brief.video_status]}
                </span>
              </div>

              {/* Prompts (editable preview) */}
              <div className="space-y-2 mb-4">
                {brief.visual_prompts.map((p, i) => (
                  <div key={i} className="p-3 bg-gray-800 rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-gray-500 text-xs w-16 flex-shrink-0">Scene {i + 1}</span>
                      <span className="text-gray-400 text-xs">{p.scene} · {p.duration_s}s</span>
                    </div>
                    <p className="text-gray-300 text-sm italic">{p.prompt_en}</p>
                  </div>
                ))}
              </div>

              {brief.video_status === 'idle' && (
                <button
                  onClick={handleGenerateVideo}
                  disabled={generatingVideo}
                  className="px-5 py-2.5 bg-wine-700 hover:bg-wine-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  {generatingVideo ? 'Starting…' : 'Generate video'}
                </button>
              )}

              {isGenerating && (
                <div className="flex items-center gap-3 text-blue-300 text-sm">
                  <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  Runway is generating your clips. This takes 3–8 minutes.
                </div>
              )}

              {brief.video_status === 'ready' && brief.video_url && (
                <div className="flex items-center gap-3">
                  <div className="text-green-300 text-sm">✓ Video ready</div>
                  <a
                    href={brief.video_url}
                    target="_blank"
                    rel="noreferrer"
                    className="px-4 py-2 bg-indigo-700 hover:bg-indigo-600 text-white text-sm rounded-lg transition-colors"
                  >
                    Download .mp4
                  </a>
                </div>
              )}

              {brief.video_status === 'error' && (
                <div className="text-red-400 text-sm">
                  Generation failed. Check Runway token and retry.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Shell>
  )
}
