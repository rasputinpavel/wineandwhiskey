'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SOURCES, nextCronAt, type SourceKey } from '@/lib/dataSources'

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
  const [showAdvanced, setShowAdvanced] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const ts  = status?.finished_at
  const ago = ts ? timeAgo(ts) : 'never'
  const when = ts ? formatBkkShort(ts) : 'never'
  const ok  = status?.ok !== false
  const dotCls =
    !ts                                     ? 'bg-pale-stone' :
    !ok                                     ? 'bg-wine-red' :
    isStale(ts)                             ? 'bg-amber-gold' :
                                              'bg-graphite/60'

  // Compute next scheduled run for any source with a cron (web sources can
  // also be on a schedule — e.g. Loyverse runs every 8h AND has a button).
  const nextCron = nextCronAt(def)
  const nextLabel = nextCron ? formatBkkTime(nextCron) : null
  const inLabel   = nextCron ? formatIn(nextCron) : null

  async function runSync() {
    setRunning(true); setMsg(null)
    try {
      const res = await fetch(`/api/m/sync/${sourceKey}`, { method: 'POST' })
      const j = await res.json()
      if (res.ok) {
        setMsg('✓ Done')
        onSynced()
        router.refresh()
      } else {
        setMsg(`Error: ${j.error ?? `HTTP ${res.status}`}`)
      }
    } catch (e: any) {
      setMsg(`Error: ${e?.message ?? String(e)}`)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        onClick={() => setOpen(o => !o)}
        title={ts ? `${ago} · ${formatBkkDateTime(new Date(ts))} BKK` : 'never synced'}
        className="inline-flex items-center gap-1.5 px-2 py-1 bg-warm-white border border-pale-stone rounded-sm hover:border-wine-red transition-colors text-[11px] font-mono text-graphite"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${dotCls}`} />
        <span className="text-deep-black">{def.label}</span>
        <span>· {when}</span>
        {ts && <span className="text-graphite/60">({ago})</span>}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-[min(92vw,400px)] bg-warm-white border border-pale-stone rounded-md shadow-card-hover p-4 text-left">
          <div className="font-heading text-sm text-deep-black mb-1">{def.label}</div>
          <p className="text-xs text-graphite leading-relaxed mb-3">{def.description}</p>

          <div className="text-[11px] text-graphite mb-3 space-y-1">
            <div>
              <span className="font-mono">Last update:</span>{' '}
              <span className={status?.ok === false ? 'text-wine-red' : 'text-deep-black'}>
                {ts ? `${ago} (${formatBkkDateTime(new Date(ts))})` : 'never'}
              </span>
            </div>
            {nextCron && (
              <div>
                <span className="font-mono">Next update:</span>{' '}
                <span className="text-deep-black">{nextLabel} BKK</span>{' '}
                <span className="text-graphite">· через {inLabel}</span>
              </div>
            )}
            {status?.error && (
              <div className="text-wine-red mt-1 font-mono break-words">{status.error}</div>
            )}
          </div>

          {/* Action area depends on runnable */}
          {def.runnable === 'web' && (
            <div className="flex gap-2 items-center border-t border-pale-stone pt-3">
              <button
                onClick={runSync}
                disabled={running}
                className="text-xs px-3 py-1.5 bg-wine-red hover:bg-burgundy-deep text-warm-white rounded-sm disabled:opacity-50"
              >
                {running ? 'Running…' : 'Sync now'}
              </button>
              {msg && <span className="text-[11px] text-graphite">{msg}</span>}
            </div>
          )}

          {def.runnable === 'cron' && (
            <div className="border-t border-pale-stone pt-3 text-[11px] text-graphite">
              Обновляется автоматически — ничего нажимать не нужно. Если данные срочно нужны
              сейчас — попроси Павла запустить вручную.
            </div>
          )}

          {/* Advanced — hidden by default. CLI command for power users. */}
          <details className="mt-3 border-t border-pale-stone pt-2" open={showAdvanced} onToggle={e => setShowAdvanced((e.target as HTMLDetailsElement).open)}>
            <summary className="text-[10px] text-graphite cursor-pointer hover:text-wine-red list-none">
              {showAdvanced ? '▼' : '▶'} Advanced
            </summary>
            <div className="mt-2 text-[10px] text-graphite">
              CLI:{' '}
              <code className="font-mono px-1.5 py-0.5 bg-cream rounded-sm text-deep-black inline-block break-all">
                {def.command}
              </code>
              {def.workflow && (
                <div className="mt-1">
                  Cron workflow: <code className="font-mono">.github/workflows/{def.workflow}</code>
                </div>
              )}
            </div>
          </details>
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

function formatIn(target: Date): string {
  const ms = target.getTime() - Date.now()
  if (ms <= 0) return 'now'
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ${Math.round(m - h * 60)}m`
  return `${Math.round(h / 24)}d`
}

function formatBkkTime(d: Date): string {
  const bkk = new Date(d.getTime() + 7 * 3_600_000)
  const hh = String(bkk.getUTCHours()).padStart(2, '0')
  const mm = String(bkk.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function formatBkkDateTime(d: Date): string {
  const bkk = new Date(d.getTime() + 7 * 3_600_000)
  return bkk.toISOString().slice(0, 16).replace('T', ' ')
}

// Compact absolute BKK stamp for the chip face: "14 Jun 09:32".
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function formatBkkShort(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 3_600_000)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

function isStale(iso: string): boolean {
  // For cron-driven sources, "stale" = > 24h since last successful run.
  return Date.now() - new Date(iso).getTime() > 24 * 60 * 60 * 1000
}
