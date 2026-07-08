'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

function bangkokToday(): string {
  const d = new Date(Date.now() + 7 * 3600_000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function fmtShort(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y.slice(2)}`
}

export function PaidAtCell({ poId, initial, onSaved }: {
  poId: number
  initial: string | null
  // Если задан — родитель сам решает, что делать после сохранения (анимация ухода
  // строки + ресинк). Иначе делаем router.refresh() как раньше.
  onSaved?: (value: string | null) => void
}) {
  const router = useRouter()
  const [paidAt, setPaidAt] = useState<string | null>(initial)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string>(initial ?? bangkokToday())
  const [saving, setSaving] = useState(false)

  async function save(value: string | null) {
    setSaving(true)
    try {
      const res = await fetch('/api/m/purchases', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: poId, paid_at: value }),
      })
      if (res.ok) {
        setPaidAt(value)
        setEditing(false)
        if (onSaved) onSaved(value)
        else router.refresh()
      }
    } finally { setSaving(false) }
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          type="date" autoFocus value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') save(draft)
            if (e.key === 'Escape') { setEditing(false); setDraft(paidAt ?? bangkokToday()) }
          }}
          className="px-1.5 py-0.5 text-xs border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red"
          disabled={saving}
        />
        <button onClick={() => save(draft)} disabled={saving}
                className="text-[10px] px-1.5 py-0.5 bg-wine-red text-warm-white rounded-sm disabled:opacity-50">
          {saving ? '…' : '✓'}
        </button>
        {paidAt && (
          <button onClick={() => save(null)} disabled={saving}
                  className="text-[10px] px-1.5 py-0.5 text-wine-red border border-wine-red/40 rounded-sm hover:bg-wine-red/10">
            clear
          </button>
        )}
        <button onClick={() => { setEditing(false); setDraft(paidAt ?? bangkokToday()) }} disabled={saving}
                className="text-[10px] text-graphite hover:text-wine-red">✕</button>
      </span>
    )
  }

  if (!paidAt) {
    return (
      <button
        onClick={() => setEditing(true)}
        disabled={saving}
        title="Click — открыть форму оплаты (дата сегодня по умолчанию, подтвердить ✓)."
        className="text-xs px-2 py-0.5 rounded-sm border bg-cream text-graphite border-pale-stone hover:border-wine-red hover:text-wine-red disabled:opacity-50"
      >
        + paid
      </button>
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="text-xs px-2 py-0.5 rounded-sm border bg-amber-gold/20 text-deep-black border-amber-gold/60 hover:opacity-80 tabular-nums"
      title="Click — изменить дату или снять отметку"
    >
      {fmtShort(paidAt)}
    </button>
  )
}
