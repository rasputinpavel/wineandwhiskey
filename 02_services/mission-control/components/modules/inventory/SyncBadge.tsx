import { lastSync, type SyncSource } from '@/lib/supabase'

export async function SyncBadge({ source }: { source: SyncSource }) {
  let log: Awaited<ReturnType<typeof lastSync>> = null
  let err: string | null = null
  try { log = await lastSync(source) } catch (e: any) { err = e?.message ?? 'error' }

  const ts = log?.finished_at
    ? new Date(log.finished_at).toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 16)
    : err ? 'unavailable' : '—'

  return (
    <div className="text-[11px] text-graphite font-mono">
      <span className="overline mr-2">{source.replace('_', ' ')}</span>
      <span className={err ? 'text-amber-gold' : ''}>updated&nbsp;{ts}</span>
    </div>
  )
}
