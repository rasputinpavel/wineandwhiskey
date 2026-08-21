'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Inline editor for the link/number of the PO created in Loyverse from this scan.
// An http(s) value renders as a link; anything else as plain text. Click ✎ to
// edit, Enter/✓ to save, Escape/✕ to cancel. Same pattern as NoteCell.
export function LoyversePoCell({ scanId, initial }: { scanId: string; initial: string | null }) {
  const router = useRouter()
  const [value, setValue] = useState(initial ?? '')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    const loyverse_po = value.trim() === '' ? null : value.trim()
    setSaving(true); setErr(null)
    try {
      const res = await fetch('/api/m/purchase-orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: scanId, loyverse_po }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error || `HTTP ${res.status}`)
      }
      setEditing(false)
      router.refresh()
    } catch (e: any) {
      setErr(e?.message ?? 'save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    const isLink = !!initial && /^https?:\/\//i.test(initial)
    return (
      <span className="inline-flex items-center gap-1">
        {isLink ? (
          <a href={initial!} target="_blank" rel="noreferrer" className="text-blue-600 underline">PO ↗</a>
        ) : (
          <span className={initial ? 'text-neutral-700' : 'text-neutral-400 italic'}>{initial || 'add…'}</span>
        )}
        <button
          onClick={() => setEditing(true)}
          title="Edit Loyverse PO"
          className="text-neutral-400 hover:text-blue-600"
        >
          ✎
        </button>
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="text"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') { setEditing(false); setValue(initial ?? ''); setErr(null) }
        }}
        placeholder="Loyverse PO link or №…"
        disabled={saving}
        className="w-48 rounded border border-neutral-300 px-1.5 py-0.5 text-sm focus:border-blue-500 focus:outline-none"
      />
      <button
        onClick={save}
        disabled={saving}
        className="rounded bg-neutral-900 px-1.5 py-0.5 text-xs text-white disabled:opacity-50"
      >
        {saving ? '…' : '✓'}
      </button>
      <button
        onClick={() => { setEditing(false); setValue(initial ?? ''); setErr(null) }}
        disabled={saving}
        className="text-xs text-neutral-500 hover:text-blue-600"
      >
        ✕
      </button>
      {err && <span className="ml-1 text-xs text-red-600">{err}</span>}
    </span>
  )
}
