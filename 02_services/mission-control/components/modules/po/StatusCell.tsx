'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PO_STATUSES, type PoStatus } from '@/lib/po/status'

const LABELS: Record<PoStatus, string> = {
  draft: 'Draft',
  needs_corrections: 'Need corrections',
  approved: 'Approved',
}

const BADGE: Record<PoStatus, string> = {
  draft: 'bg-neutral-100 text-neutral-600',
  needs_corrections: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
}

// Status badge + inline dropdown for a PO scan. Changing the dropdown PATCHes
// immediately (optimistic, rolls back on error) — no full-row edit needed, same
// independent-cell pattern as NoteCell.
export function StatusCell({ scanId, initial }: { scanId: string; initial: PoStatus }) {
  const router = useRouter()
  const [value, setValue] = useState<PoStatus>(initial)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function change(next: PoStatus) {
    const prev = value
    setValue(next); setSaving(true); setErr(null)
    try {
      const res = await fetch('/api/m/purchase-orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: scanId, status: next }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error || `HTTP ${res.status}`)
      }
      router.refresh()
    } catch (e: any) {
      setValue(prev)
      setErr(e?.message ?? 'save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${BADGE[value]}`}>
        {LABELS[value]}
      </span>
      <select
        value={value}
        disabled={saving}
        onChange={(e) => change(e.target.value as PoStatus)}
        aria-label="Change status"
        className="rounded border border-neutral-300 bg-white px-1 py-0.5 text-xs focus:border-blue-500 focus:outline-none disabled:opacity-50"
      >
        {PO_STATUSES.map((s) => (
          <option key={s} value={s}>{LABELS[s]}</option>
        ))}
      </select>
      {err && <span className="ml-1 text-xs text-red-600">{err}</span>}
    </span>
  )
}
