'use client'

import { useEffect, useRef, useState } from 'react'

type Candidate = {
  id: string
  name: string
  loyverse_product_code: string | null
  category: string | null
}

// Compact SKU autocomplete used inside the delivery-note line form.
// On pick, calls onPick(sku) — the parent decides what to do with it.

export function SkuPickerInline({
  initialName,
  onPick,
}: {
  initialName?: string
  onPick: (sku: Candidate) => void
}) {
  const [query, setQuery] = useState(initialName ?? '')
  const [items, setItems] = useState<Candidate[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [highlight, setHighlight] = useState(0)
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
    if (query.trim().length < 2) { setItems([]); setHighlight(0); return }
    setLoading(true)
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/m/inventory/sku/search?q=${encodeURIComponent(query)}&limit=10`)
        const j = await res.json()
        if (res.ok) { setItems(j.items as Candidate[]); setHighlight(0) }
      } finally { setLoading(false) }
    }, 180)
    return () => clearTimeout(handle)
  }, [query])

  function pick(it: Candidate) {
    onPick(it)
    setQuery(it.name)
    setOpen(false)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault(); setOpen(true)
      if (items.length) setHighlight(h => Math.min(items.length - 1, h + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (items.length) setHighlight(h => Math.max(0, h - 1))
    } else if (e.key === 'Enter') {
      if (open && items[highlight]) { e.preventDefault(); pick(items[highlight]) }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search SKU…"
        autoComplete="off"
        className="w-full px-2 py-1 text-sm border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red"
      />
      {open && query.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-warm-white border border-pale-stone rounded-md shadow-card-hover overflow-hidden">
          {loading && items.length === 0 && (
            <div className="px-3 py-2 text-xs text-graphite">Searching…</div>
          )}
          {!loading && items.length === 0 && (
            <div className="px-3 py-2 text-xs text-graphite">No SKUs match.</div>
          )}
          {items.map((it, i) => (
            <button
              key={it.id} type="button"
              onMouseEnter={() => setHighlight(i)}
              onClick={() => pick(it)}
              className={`w-full text-left px-3 py-2 border-b border-pale-stone/40 last:border-0 ${
                i === highlight ? 'bg-cream/70' : 'hover:bg-cream/40'
              }`}
            >
              <div className="text-[13px] text-deep-black">{it.name}</div>
              <div className="text-[11px] text-graphite font-mono mt-0.5">
                {it.loyverse_product_code ?? '—'}{it.category ? ` · ${it.category}` : ''}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
