'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function DocsUrlCell({ poId, initial }: {
  poId: number
  initial: string | null
}) {
  const router = useRouter()
  const [url, setUrl] = useState<string | null>(initial)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string>(initial ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save(value: string | null) {
    setSaving(true); setErr(null)
    try {
      const res = await fetch('/api/m/purchases', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: poId, docs_url: value }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error || `HTTP ${res.status}`)
      }
      setUrl(value)
      setEditing(false)
    } catch (e: any) {
      setErr(e?.message ?? 'save failed')
    } finally { setSaving(false) }
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          type="url" autoFocus value={draft}
          placeholder="https://drive.google.com/…"
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') save(draft.trim() || null)
            if (e.key === 'Escape') { setEditing(false); setDraft(url ?? ''); setErr(null) }
          }}
          className="w-56 px-1.5 py-0.5 text-xs border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red"
          disabled={saving}
        />
        <button onClick={() => save(draft.trim() || null)} disabled={saving}
                className="text-[10px] px-1.5 py-0.5 bg-wine-red text-warm-white rounded-sm disabled:opacity-50">
          {saving ? '…' : '✓'}
        </button>
        <button onClick={() => { setEditing(false); setDraft(url ?? ''); setErr(null) }} disabled={saving}
                className="text-[10px] text-graphite hover:text-wine-red">✕</button>
        {err && <span className="text-[10px] text-wine-red">{err}</span>}
      </span>
    )
  }

  if (!url) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="text-xs px-2 py-0.5 rounded-sm border bg-cream text-graphite border-pale-stone hover:border-wine-red hover:text-wine-red"
        title="Прикрепить ссылку на папку Drive с tax invoice + receipt"
      >
        + docs
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      <a href={url} target="_blank" rel="noreferrer"
         className="text-xs text-wine-red hover:underline" title={url}>
        📁 docs
      </a>
      <button onClick={() => setEditing(true)} className="text-[10px] text-graphite hover:text-wine-red" title="Изменить">
        ✎
      </button>
    </span>
  )
}
