'use client'
import { useState } from 'react'
import { COUNTRIES, GRAPES, regionsFor } from '@/lib/wine-data'
import type { Hint, WineColor } from '@/lib/types'

export type EditableWine = {
  id: string; order_no: number; label: string; name: string
  country: string | null; region: string | null; grape: string | null
  vintage: number | null; style: string | null; color: WineColor | null
  abv: number | null; image_url: string | null; hints: Hint[]
}

type Props = {
  gameId: string
  wine: EditableWine
  onSaved: () => void
}

/** Edits one bottle. Saving re-derives the answer key, the board and — unless
 *  the hints were hand-edited — the hint texts. */
export function WineEditor({ gameId, wine, onSaved }: Props) {
  const [form, setForm] = useState(wine)
  const [hints, setHints] = useState<Hint[]>(wine.hints)
  const [busy, setBusy] = useState(false)

  function set<K extends keyof EditableWine>(key: K, value: EditableWine[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function save(regenerateHints: boolean) {
    setBusy(true)
    await fetch(`/api/admin/games/${gameId}/wines/${wine.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: form.name, country: form.country, region: form.region, grape: form.grape,
        vintage: form.vintage, style: form.style, color: form.color, abv: form.abv,
        imageUrl: form.image_url,
        hints: regenerateHints ? [] : hints,
      }),
    })
    setBusy(false)
    onSaved()
  }

  async function remove() {
    if (!confirm(`Remove "${wine.name}" from this game?`)) return
    await fetch(`/api/admin/games/${gameId}/wines/${wine.id}`, { method: 'DELETE' })
    onSaved()
  }

  const field = 'rounded-md bg-graphite/40 px-3 py-2 outline-none'

  return (
    <div className="space-y-3 rounded-lg border border-pale-stone/20 p-4">
      <div className="flex items-center justify-between">
        <span className="font-display text-2xl text-amber-gold">{wine.label}</span>
        <button onClick={remove} className="text-xs text-wine-red underline">remove</button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <input className={`${field} col-span-2`} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Name" />
        <input
          className={field} list="dl-countries" value={form.country ?? ''}
          onChange={e => set('country', e.target.value || null)} placeholder="Country"
        />
        <input
          className={field} list="dl-regions" value={form.region ?? ''}
          onChange={e => set('region', e.target.value || null)} placeholder="Region"
        />
        <input
          className={field} list="dl-grapes" value={form.grape ?? ''}
          onChange={e => set('grape', e.target.value || null)} placeholder="Grape"
        />
        <input
          className={field} type="number" value={form.vintage ?? ''}
          onChange={e => set('vintage', e.target.value ? Number(e.target.value) : null)} placeholder="Vintage"
        />
        <select className={field} value={form.style ?? ''} onChange={e => set('style', e.target.value || null)}>
          <option value="">— style —</option>
          <option value="dry">dry</option>
          <option value="semi-dry">semi-dry</option>
          <option value="semi-sweet">semi-sweet</option>
          <option value="sweet">sweet</option>
        </select>
        <select className={field} value={form.color ?? ''} onChange={e => set('color', (e.target.value || null) as WineColor | null)}>
          <option value="">— colour —</option>
          <option value="red">red</option>
          <option value="white">white</option>
          <option value="rose">rosé</option>
          <option value="sparkling">sparkling</option>
          <option value="orange">orange</option>
        </select>
        <input
          className={field} type="number" step="0.1" value={form.abv ?? ''}
          onChange={e => set('abv', e.target.value ? Number(e.target.value) : null)} placeholder="ABV %"
        />
        <input className={field} value={form.image_url ?? ''} onChange={e => set('image_url', e.target.value || null)} placeholder="Image URL" />
      </div>

      {/* Free text is still allowed — some bottles are not in our dictionaries —
          but a value we do not recognise silently drops its category from the
          board, and the admin deserves to know why the question vanished. */}
      <datalist id="dl-countries">
        {COUNTRIES.map(c => <option key={c.value} value={c.en} />)}
      </datalist>
      <datalist id="dl-grapes">
        {GRAPES.map(g => <option key={g.value} value={g.en} />)}
      </datalist>
      <datalist id="dl-regions">
        {regionsFor(form.country).map(r => <option key={r.value} value={r.ru} />)}
      </datalist>

      {form.country && !COUNTRIES.some(c => c.value === form.country!.trim().toLowerCase()) && (
        <p className="text-xs text-wine-red">
          Country not in our list — the Old/New World and Country categories will be
          skipped for this wine, and no country hint will be offered.
        </p>
      )}
      {form.vintage != null && form.vintage >= new Date().getFullYear() && (
        <p className="text-xs text-wine-red">
          Current-year vintage — the Vintage category will be skipped, because the board
          could only be built one way and the answer would always be the last button.
        </p>
      )}

      <div className="space-y-2">
        <h4 className="text-xs uppercase tracking-overline text-pale-stone">Hints</h4>
        {hints.length === 0 && <p className="text-sm text-pale-stone">None — difficulty is “pro”, or no facts to hint at.</p>}
        {hints.map((h, i) => (
          <div key={i} className="grid grid-cols-[4rem_1fr_1fr_2rem] gap-2">
            <input
              className={field} type="number" value={h.at}
              onChange={e => setHints(hs => hs.map((x, j) => j === i ? { ...x, at: Number(e.target.value) } : x))}
            />
            <input
              className={field} value={h.ru}
              onChange={e => setHints(hs => hs.map((x, j) => j === i ? { ...x, ru: e.target.value } : x))}
            />
            <input
              className={field} value={h.en}
              onChange={e => setHints(hs => hs.map((x, j) => j === i ? { ...x, en: e.target.value } : x))}
            />
            <button onClick={() => setHints(hs => hs.filter((_, j) => j !== i))} className="text-wine-red">×</button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button disabled={busy} onClick={() => save(false)} className="rounded-md bg-amber-gold px-4 py-2 text-deep-black">
          Save
        </button>
        <button disabled={busy} onClick={() => save(true)} className="rounded-md border border-pale-stone/40 px-4 py-2 text-sm">
          Save &amp; regenerate hints
        </button>
      </div>
    </div>
  )
}
