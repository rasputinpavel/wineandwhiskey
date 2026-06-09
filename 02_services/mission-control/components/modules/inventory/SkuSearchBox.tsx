'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

type Candidate = {
  id: string
  name: string
  loyverse_product_code: string | null
  category: string | null
}

export function SkuSearchBox({
  defaultValue, sort, dir,
}: {
  defaultValue: string
  sort: string
  dir: string
}) {
  const router = useRouter()
  const [query, setQuery] = useState(defaultValue)
  const [items, setItems] = useState<Candidate[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  // Outside click closes the suggestion panel.
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  // Debounced suggestion fetch — same /api/m/inventory/sku/search the
  // /admin/unmapped Map-to-SKU widget uses. Two char minimum.
  useEffect(() => {
    if (query.trim().length < 2) { setItems([]); setHighlight(0); return }
    setLoading(true)
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/m/inventory/sku/search?q=${encodeURIComponent(query)}&limit=10`)
        const j = await res.json()
        if (res.ok) {
          setItems(j.items as Candidate[])
          setHighlight(0)
        }
      } finally {
        setLoading(false)
      }
    }, 180)
    return () => clearTimeout(handle)
  }, [query])

  function navigateTo(it: Candidate) {
    if (!it.loyverse_product_code) return
    setOpen(false)
    router.push(`/m/inventory/sku/${encodeURIComponent(it.loyverse_product_code)}`)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      if (items.length) setHighlight(h => Math.min(items.length - 1, h + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (items.length) setHighlight(h => Math.max(0, h - 1))
    } else if (e.key === 'Enter') {
      // If a suggestion is open and highlighted, navigate to it. Otherwise
      // let the form submit (filter the table).
      if (open && items[highlight]) {
        e.preventDefault()
        navigateTo(items[highlight])
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <form ref={formRef} className="mb-6 flex flex-wrap gap-2 items-start">
      <div ref={wrapRef} className="relative w-full md:w-[360px]">
        <input
          name="q"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search by SKU code or name…"
          autoComplete="off"
          className="w-full border border-pale-stone bg-warm-white px-3 py-2 rounded-sm text-sm focus:outline-none focus:border-wine-red"
        />
        {open && query.trim().length >= 2 && (
          <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-warm-white border border-pale-stone rounded-md shadow-card-hover overflow-hidden">
            {loading && items.length === 0 && (
              <div className="px-3 py-2 text-xs text-graphite">Searching…</div>
            )}
            {!loading && items.length === 0 && (
              <div className="px-3 py-2 text-xs text-graphite">No SKUs match.</div>
            )}
            {items.map((it, i) => {
              const isHi = i === highlight
              return (
                <button
                  key={it.id}
                  type="button"
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => navigateTo(it)}
                  className={`w-full text-left px-3 py-2 border-b border-pale-stone/40 last:border-0 ${
                    isHi ? 'bg-cream/70' : 'hover:bg-cream/40'
                  }`}
                >
                  <div className="text-[13px] text-deep-black">{it.name}</div>
                  <div className="text-[11px] text-graphite font-mono mt-0.5">
                    {it.loyverse_product_code ?? '—'}{it.category ? ` · ${it.category}` : ''}
                  </div>
                </button>
              )
            })}
            {items.length > 0 && (
              <div className="px-3 py-1.5 bg-cream/60 text-[10px] text-graphite border-t border-pale-stone/60">
                ↑↓ to move · Enter to open · Esc to close
              </div>
            )}
          </div>
        )}
      </div>

      <input type="hidden" name="sort" value={sort} />
      <input type="hidden" name="dir" value={dir} />

      <button
        type="submit"
        className="bg-wine-red hover:bg-burgundy-deep text-warm-white text-sm px-4 py-2 rounded-sm transition-colors"
      >
        Search
      </button>
      {defaultValue && (
        <Link href="/m/inventory" className="px-4 py-2 border border-pale-stone hover:border-wine-red hover:text-wine-red text-graphite text-sm rounded-sm transition-colors">
          Reset
        </Link>
      )}
    </form>
  )
}
