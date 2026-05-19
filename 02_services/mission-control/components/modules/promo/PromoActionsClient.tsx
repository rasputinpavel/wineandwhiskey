'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PROMO_STATUSES, PROMO_STATUS_LABEL, type PromoStatus } from '@/lib/promo/types'

// Phase 1 actions: flip status (draft ↔ ready) and delete. Phase 2 and 3 will
// add "Generate copy" and "Generate visuals" buttons here.

export function PromoActionsClient({
  id, status: initialStatus, hasCopy, hasPrompt, hasVisuals,
}: { id: string; status: PromoStatus; hasCopy: boolean; hasPrompt: boolean; hasVisuals: boolean }) {
  const router = useRouter()
  const [status, setStatus]      = useState<PromoStatus>(initialStatus)
  const [busy, setBusy]          = useState(false)
  const [generating, setGen]     = useState(false)
  const [renderingVis, setVis]   = useState(false)
  const [error, setError]        = useState<string | null>(null)

  async function setStatusTo(next: PromoStatus) {
    if (next === status) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/m/promo/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to update')
      setStatus(next)
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function generateCopy() {
    if (hasCopy && !confirm('Regenerate copy? Current text will be overwritten.')) return
    setGen(true); setError(null)
    try {
      const res = await fetch(`/api/m/promo/${id}/generate-copy`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to generate')
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setGen(false)
    }
  }

  async function generateVisuals() {
    if (!hasPrompt) { setError('Run "Generate copy" first — it authors the image prompt used here'); return }
    if (hasVisuals && !confirm('Regenerate all 7 visuals? Current assets will be overwritten.')) return
    setVis(true); setError(null)
    try {
      const res = await fetch(`/api/m/promo/${id}/generate-visuals`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to render')
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setVis(false)
    }
  }

  async function remove() {
    if (!confirm('Delete this promo? This cannot be undone.')) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/m/promo/${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to delete')
      router.push('/m/promo')
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <button onClick={generateCopy} disabled={busy || generating || renderingVis}
          className="text-xs px-3 py-1.5 bg-deep-black text-warm-white rounded-sm hover:bg-burgundy-deep disabled:opacity-50">
          {generating ? 'Generating…' : hasCopy ? 'Regenerate copy' : 'Generate copy'}
        </button>
        <button onClick={generateVisuals} disabled={busy || generating || renderingVis || !hasPrompt}
          title={!hasPrompt ? 'Generate copy first — it writes the NBP image prompt' : undefined}
          className="text-xs px-3 py-1.5 bg-wine-red text-warm-white rounded-sm hover:bg-burgundy-deep disabled:opacity-50">
          {renderingVis ? 'Rendering 7 assets…' : hasVisuals ? 'Regenerate visuals' : 'Generate visuals'}
        </button>
        <select
          value={status}
          onChange={e => setStatusTo(e.target.value as PromoStatus)}
          disabled={busy || generating || renderingVis}
          className="text-xs border border-pale-stone bg-warm-white rounded-sm px-2 py-1.5"
        >
          {PROMO_STATUSES.map(s => (
            <option key={s} value={s}>{PROMO_STATUS_LABEL[s]}</option>
          ))}
        </select>
        <button onClick={remove} disabled={busy || generating || renderingVis}
          className="text-xs px-2 py-1.5 border border-pale-stone text-graphite rounded-sm hover:border-wine-red hover:text-wine-red disabled:opacity-50">
          Delete
        </button>
      </div>
      {error && (
        <span className="text-[11px] text-wine-red max-w-sm text-right">{error}</span>
      )}
    </div>
  )
}
