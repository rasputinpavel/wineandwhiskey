'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type Candidate = {
  id: string
  name: string
  loyverse_product_code: string | null
  category: string | null
}

export function MapLineCell({ lineId, defaultQuery }: {
  lineId: string
  defaultQuery: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(defaultQuery)
  const [items, setItems] = useState<Candidate[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Close panel on outside click.
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  // Debounced search.
  useEffect(() => {
    if (!open) return
    if (query.trim().length < 2) { setItems([]); return }
    setLoading(true); setErr(null)
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/m/inventory/sku/search?q=${encodeURIComponent(query)}&limit=15`)
        const j = await res.json()
        if (res.ok) setItems(j.items as Candidate[])
        else throw new Error(j?.error ?? `HTTP ${res.status}`)
      } catch (e: any) {
        setErr(e?.message ?? 'search failed')
      } finally {
        setLoading(false)
      }
    }, 200)
    return () => clearTimeout(handle)
  }, [query, open])

  async function pick(skuId: string) {
    setSaving(skuId); setErr(null)
    try {
      const res = await fetch('/api/m/inventory/invoice-lines', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: lineId, sku_id: skuId }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error ?? `HTTP ${res.status}`)
      }
      setOpen(false)
      router.refresh()
    } catch (e: any) {
      setErr(e?.message ?? 'save failed')
    } finally {
      setSaving(null)
    }
  }

  return (
    <div ref={wrapRef} className="relative inline-block text-left">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="text-xs px-2 py-1 border border-pale-stone hover:border-wine-red hover:text-wine-red text-graphite rounded-sm transition-colors"
        >
          Map to SKU
        </button>
      ) : (
        <div className="absolute right-0 top-0 z-30 w-[min(92vw,420px)] bg-warm-white border border-pale-stone rounded-md shadow-card-hover">
          <div className="p-2 border-b border-pale-stone">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoFocus
              placeholder="Search by name or code…"
              className="w-full px-2 py-1.5 text-sm border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red"
            />
          </div>

          <div className="max-h-72 overflow-y-auto">
            {loading && <div className="px-3 py-2 text-xs text-graphite">Searching…</div>}
            {!loading && err && <div className="px-3 py-2 text-xs text-wine-red">{err}</div>}
            {!loading && !err && query.trim().length < 2 && (
              <div className="px-3 py-2 text-xs text-graphite">Type at least 2 characters.</div>
            )}
            {!loading && !err && query.trim().length >= 2 && items.length === 0 && (
              <div className="px-3 py-2 text-xs text-graphite">No SKUs match.</div>
            )}
            {items.map(it => (
              <button
                key={it.id}
                onClick={() => pick(it.id)}
                disabled={saving !== null}
                className={`w-full text-left px-3 py-2 hover:bg-cream/60 border-b border-pale-stone/40 last:border-0 ${
                  saving === it.id ? 'opacity-50' : ''
                }`}
              >
                <div className="text-[13px] text-deep-black">{it.name}</div>
                <div className="text-[11px] text-graphite font-mono mt-0.5">
                  {it.loyverse_product_code ?? '—'}{it.category ? ` · ${it.category}` : ''}
                </div>
              </button>
            ))}
          </div>

          <div className="px-3 py-2 border-t border-pale-stone flex justify-between items-center">
            <span className="text-[10px] text-graphite">After save: invoice line gets sku_id, this row disappears.</span>
            <button onClick={() => setOpen(false)} className="text-[11px] text-graphite hover:text-wine-red">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
