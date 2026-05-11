'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

type Candidate = { id: string; flowaccount_name: string }

export function CustomerParentCell({
  customerId,
  initialParentId,
  initialParentName,
  candidates,
}: {
  customerId: string
  initialParentId: string | null
  initialParentName: string | null
  candidates: Candidate[]      // только потенциальные head office (parent_id = null, не self)
}) {
  const router = useRouter()
  const [parentId, setParentId] = useState<string | null>(initialParentId)
  const [parentName, setParentName] = useState<string | null>(initialParentName)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const filtered = !query.trim() ? candidates.slice(0, 8) :
    candidates.filter(c => c.flowaccount_name.toLowerCase().includes(query.toLowerCase())).slice(0, 12)

  async function save(newParentId: string | null, newParentName: string | null) {
    setSaving(true); setErr(null)
    try {
      const res = await fetch('/api/m/customers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: customerId, parent_id: newParentId }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error || `HTTP ${res.status}`)
      }
      setParentId(newParentId)
      setParentName(newParentName)
      setOpen(false)
      setQuery('')
      router.refresh()
    } catch (e: any) {
      setErr(e?.message ?? 'save failed')
    } finally { setSaving(false) }
  }

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={saving}
        className={`text-xs px-2 py-0.5 rounded-sm border transition-colors hover:opacity-80 disabled:opacity-50 ${
          parentId
            ? 'bg-cream text-deep-black border-pale-stone'
            : 'bg-warm-white text-graphite border-pale-stone hover:text-wine-red hover:border-wine-red'
        }`}
        title={parentId ? `Branch of ${parentName}. Click to change.` : 'Standalone. Click to attach as branch of another customer.'}
      >
        {parentId ? `↪ ${parentName}` : '+ parent'}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 w-[320px] bg-warm-white border border-pale-stone rounded-md shadow-card-hover p-2">
          <input
            autoFocus
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="search head office…"
            className="w-full px-2 py-1.5 text-xs border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red mb-2"
          />
          {parentId && (
            <button
              onClick={() => save(null, null)}
              disabled={saving}
              className="w-full text-left text-xs px-2 py-1 text-wine-red border border-wine-red/40 rounded-sm hover:bg-wine-red/10 disabled:opacity-50 mb-1"
            >
              ✕ Unlink (стать standalone)
            </button>
          )}
          <div className="max-h-72 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="text-[11px] text-graphite px-2 py-2">Ничего не нашлось</div>
            ) : filtered.map(c => (
              <button
                key={c.id}
                onClick={() => save(c.id, c.flowaccount_name)}
                disabled={saving}
                className="w-full text-left text-xs px-2 py-1 rounded-sm hover:bg-cream text-deep-black disabled:opacity-50"
              >
                {c.flowaccount_name}
              </button>
            ))}
          </div>
          {err && <div className="text-[10px] text-wine-red mt-1 px-2">{err}</div>}
        </div>
      )}
    </div>
  )
}
