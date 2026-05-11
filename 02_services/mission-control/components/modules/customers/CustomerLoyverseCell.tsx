'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

type Candidate = { id: string; name: string; total_spent: number }

export function CustomerLoyverseCell({ customerId, initialLoyverseId, initialLoyverseName }: {
  customerId: string
  initialLoyverseId: string | null
  initialLoyverseName: string | null
}) {
  const router = useRouter()
  const [linkedId, setLinkedId] = useState<string | null>(initialLoyverseId)
  const [linkedName, setLinkedName] = useState<string | null>(initialLoyverseName)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<Candidate[]>([])
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

  useEffect(() => {
    if (!open) return
    const t = setTimeout(async () => {
      const res = await fetch(`/api/m/loyverse-customers?q=${encodeURIComponent(query)}`)
      const j = await res.json()
      setCandidates(j.items ?? [])
    }, 200)
    return () => clearTimeout(t)
  }, [open, query])

  async function save(newId: string | null, newName: string | null) {
    setSaving(true); setErr(null)
    try {
      const res = await fetch('/api/m/customers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: customerId, loyverse_customer_id: newId }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error || `HTTP ${res.status}`)
      }
      setLinkedId(newId)
      setLinkedName(newName)
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
          linkedId
            ? 'bg-amber-gold/20 text-deep-black border-amber-gold/60'
            : 'bg-warm-white text-graphite border-pale-stone hover:text-wine-red hover:border-wine-red'
        }`}
        title={linkedId ? `Linked to Loyverse: ${linkedName}. Click to relink/unlink.` : 'Not linked to a Loyverse customer. Click to attach.'}
      >
        {linkedId ? `LV: ${linkedName}` : '+ link Loyverse'}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 w-[340px] bg-warm-white border border-pale-stone rounded-md shadow-card-hover p-2">
          <input
            autoFocus type="search" value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="search Loyverse customer…"
            className="w-full px-2 py-1.5 text-xs border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red mb-2"
          />
          {linkedId && (
            <button
              onClick={() => save(null, null)}
              disabled={saving}
              className="w-full text-left text-xs px-2 py-1 text-wine-red border border-wine-red/40 rounded-sm hover:bg-wine-red/10 disabled:opacity-50 mb-1"
            >
              ✕ Unlink Loyverse
            </button>
          )}
          <div className="max-h-72 overflow-y-auto">
            {candidates.length === 0 ? (
              <div className="text-[11px] text-graphite px-2 py-2">Ничего не нашлось</div>
            ) : candidates.map(c => (
              <button
                key={c.id}
                onClick={() => save(c.id, c.name)}
                disabled={saving}
                className="w-full text-left text-xs px-2 py-1 rounded-sm hover:bg-cream text-deep-black disabled:opacity-50 flex justify-between gap-2"
              >
                <span className="truncate">{c.name}</span>
                <span className="text-[10px] text-graphite tabular-nums whitespace-nowrap">฿{Math.round(c.total_spent).toLocaleString('en-US')}</span>
              </button>
            ))}
          </div>
          {err && <div className="text-[10px] text-wine-red mt-1 px-2">{err}</div>}
        </div>
      )}
    </div>
  )
}
