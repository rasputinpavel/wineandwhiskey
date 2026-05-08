'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SOURCES, type SourceKey } from '@/lib/dataSources'

type Status = {
  finished_at: string | null
  ok: boolean | null
  error: string | null
}

export function DataFreshness({ sources }: { sources: SourceKey[] }) {
  const [byKey, setByKey] = useState<Record<string, Status>>({})

  async function refresh() {
    const res = await fetch(`/api/m/sync/last?sources=${sources.join(',')}`, { cache: 'no-store' })
    const j = await res.json()
    setByKey(j.items ?? {})
  }

  useEffect(() => { refresh() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sources.join(',')])

  return (
    <div className="flex flex-wrap gap-2">
      {sources.map(k => (
        <SourceBadge key={k} sourceKey={k} status={byKey[k]} onSynced={refresh} />
      ))}
    </div>
  )
}

function SourceBadge({ sourceKey, status, onSynced }: {
  sourceKey: SourceKey
  status?: Status
  onSynced: () => void
}) {
  const def = SOURCES[sourceKey]
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const ts = status?.finished_at
  const ago = ts ? timeAgo(ts) : 'never'
  const ok  = status?.ok !== false
  const dotCls =
    !ts                                     ? 'bg-pale-stone' :
    !ok                                     ? 'bg-wine-red' :
    isStale(ts)                             ? 'bg-amber-gold' :
                                              'bg-graphite/60'

  async function runSync() {
    setRunning(true); setMsg(null)
    try {
      const res = await fetch(`/api/m/sync/${sourceKey}`, { method: 'POST' })
      const j = await res.json()
      if (res.ok) {
        setMsg('✓ Done')
        onSynced()
        router.refresh()
      } else if (res.status === 503) {
        setMsg(`Run from laptop:`)
      } else {
        setMsg(`Error: ${j.error ?? `HTTP ${res.status}`}`)
      }
    } catch (e: any) {
      setMsg(`Error: ${e?.message ?? String(e)}`)
    } finally {
      setRunning(false)
    }
  }

  async function copyCmd() {
    try { await navigator.clipboard.writeText(def.command); setMsg('✓ Copied') } catch { setMsg(def.command) }
  }

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 px-2 py-1 bg-warm-white border border-pale-stone rounded-sm hover:border-wine-red transition-colors text-[11px] font-mono text-graphite"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${dotCls}`} />
        <span className="text-deep-black">{def.label}</span>
        <span>· {ago}</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 w-[420px] bg-warm-white border border-pale-stone rounded-md shadow-card-hover p-4 text-left">
          <div className="font-heading text-sm text-deep-black mb-1">{def.label}</div>
          <p className="text-xs text-graphite leading-relaxed mb-3">{def.description}</p>

          <div className="text-[11px] text-graphite mb-2">
            <span className="font-mono">Last run:</span>{' '}
            <span className={status?.ok === false ? 'text-wine-red' : 'text-deep-black'}>
              {ts ? `${new Date(ts).toLocaleString('sv-SE')} (${ago})` : 'never'}
            </span>
            {status?.error && (
              <div className="text-wine-red mt-1 font-mono break-words">{status.error}</div>
            )}
          </div>

          <div className="border-t border-pale-stone pt-3">
            <div className="overline text-graphite mb-2">CLI command</div>
            <code className="font-mono text-xs px-2 py-1 bg-cream rounded-sm text-deep-black inline-block break-all">
              {def.command}
            </code>
          </div>

          <div className="mt-3 flex gap-2 items-center">
            {def.runnable === 'server' ? (
              <button
                onClick={runSync}
                disabled={running}
                className="text-xs px-3 py-1.5 bg-wine-red hover:bg-burgundy-deep text-warm-white rounded-sm disabled:opacity-50"
              >
                {running ? 'Running…' : 'Sync now'}
              </button>
            ) : (
              <button
                onClick={copyCmd}
                className="text-xs px-3 py-1.5 border border-pale-stone hover:border-wine-red hover:text-wine-red text-graphite rounded-sm transition-colors"
              >
                Copy command (run from laptop)
              </button>
            )}
            {msg && <span className="text-[11px] text-graphite">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.round(ms / 60_000)
  if (m < 1)   return 'just now'
  if (m < 60)  return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24)  return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}

function isStale(iso: string): boolean {
  // > 24h since last successful run = amber.
  return Date.now() - new Date(iso).getTime() > 24 * 60 * 60 * 1000
}
