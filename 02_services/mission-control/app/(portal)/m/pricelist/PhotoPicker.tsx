'use client'
import { useEffect, useRef, useState } from 'react'
import type { LineItem } from '@/lib/pricelist/types'

// Per-card photo control: shows the current bottle shot and opens a popover to
// pick one from the existing library (exact, no wrong bottle) or upload a
// screenshot that the server background-removes. For inventory items (code set)
// the choice is persisted per-SKU so it prefills next time.
export function PhotoPicker({ item, images, onChange }: {
  item: LineItem
  images: string[]
  onChange: (patch: Partial<LineItem>) => void
}) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'library' | 'upload'>('library')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click / Escape so a left-open popover never overlays and
  // swallows clicks on the card's other controls (e.g. Remove).
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const current = item.imageUrl ?? (item.imageSlug ? `/brand/products/${item.imageSlug}.png` : null)

  async function persist(patch: { image_slug?: string | null; image_url?: string | null }) {
    if (!item.code) return // manual/CSV items live only in the saved list JSON
    await fetch('/api/m/pricelist/image/attach', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: item.code, ...patch }),
    }).catch(() => {})
  }

  function pickLibrary(slug: string) {
    onChange({ imageSlug: slug, imageUrl: undefined })
    persist({ image_slug: slug, image_url: null })
    setOpen(false)
  }

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (item.code) fd.append('code', item.code)
      fd.append('name', item.name)
      const res = await fetch('/api/m/pricelist/image', { method: 'POST', body: fd })
      const { url, error } = await res.json()
      if (error) { alert(error); return }
      onChange({ imageUrl: url, imageSlug: undefined })
      setOpen(false)
    } finally { setBusy(false) }
  }

  function clear() {
    onChange({ imageUrl: undefined, imageSlug: undefined })
    persist({ image_slug: null, image_url: null })
    setOpen(false)
  }

  const matches = q.trim()
    ? images.filter(s => s.includes(q.trim().toLowerCase().replace(/\s+/g, '-'))).slice(0, 60)
    : images.slice(0, 60)

  return (
    <div className="relative inline-block" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-11 h-11 rounded border border-pale-stone bg-white flex items-center justify-center overflow-hidden shrink-0"
        title="Photo">
        {current
          ? <img src={current} alt="" className="max-w-full max-h-full object-contain" />
          : <span className="text-lg">📷</span>}
      </button>

      {open && (
        <div className="absolute z-20 mt-1 left-0 w-72 rounded-lg border border-pale-stone bg-white shadow-lg p-2 text-sm">
          <div className="flex gap-1 mb-2">
            <button type="button" onClick={() => setTab('library')} className={`px-2 py-1 rounded text-xs ${tab === 'library' ? 'bg-wine-red text-white' : 'bg-cream'}`}>Library</button>
            <button type="button" onClick={() => setTab('upload')} className={`px-2 py-1 rounded text-xs ${tab === 'upload' ? 'bg-wine-red text-white' : 'bg-cream'}`}>Upload</button>
            {current && <button type="button" onClick={clear} className="ml-auto px-2 py-1 rounded text-xs text-graphite hover:text-wine-red">Remove</button>}
          </div>

          {tab === 'library' && (
            <div>
              <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search bottle shots…"
                className="w-full px-2 py-1 border border-pale-stone rounded text-xs mb-2" />
              <div className="grid grid-cols-4 gap-1 max-h-56 overflow-auto">
                {matches.map(slug => (
                  <button type="button" key={slug} onClick={() => pickLibrary(slug)} title={slug}
                    className="aspect-square border border-pale-stone rounded bg-white flex items-center justify-center overflow-hidden hover:border-wine-red">
                    <img src={`/brand/products/${slug}.png`} alt="" loading="lazy" className="max-w-full max-h-full object-contain" />
                  </button>
                ))}
                {matches.length === 0 && <div className="col-span-4 text-xs text-graphite/60 py-3 text-center">No matches</div>}
              </div>
            </div>
          )}

          {tab === 'upload' && (
            <div className="space-y-2">
              <p className="text-xs text-graphite/70">Upload a bottle screenshot — the background is removed automatically.</p>
              <input type="file" accept="image/*" onChange={upload} disabled={busy} className="text-xs" />
              {busy && <p className="text-xs text-graphite">Processing…</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
