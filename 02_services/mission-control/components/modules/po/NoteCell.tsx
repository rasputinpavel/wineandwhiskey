'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Inline-editable free-text note for a PO scan. Click to edit, Enter/✓ to save,
// Escape/✕ to cancel. Persists via PATCH /api/m/purchase-orders.
export function NoteCell({ scanId, initial }: { scanId: string; initial: string | null }) {
  const router = useRouter()
  const [value, setValue] = useState(initial ?? '')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    const note = value.trim() === '' ? null : value.trim()
    setSaving(true); setErr(null)
    try {
      const res = await fetch('/api/m/purchase-orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: scanId, note }),
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
    return (
      <button
        onClick={() => setEditing(true)}
        title="Click to edit"
        className={`text-left ${initial ? 'text-neutral-700' : 'text-neutral-400 italic'} hover:text-blue-600`}
      >
        {initial || 'add note…'}
      </button>
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
        placeholder="note…"
        disabled={saving}
        className="w-56 rounded border border-neutral-300 px-1.5 py-0.5 text-sm focus:border-blue-500 focus:outline-none"
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
