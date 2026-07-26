'use client'
import { useMemo, useReducer, useState } from 'react'
import { Preview } from './preview'
import type { PriceListDoc, LineItem, PageSettings, Grouping, PlaqueZone, RowLayout, CatalogRow } from '@/lib/pricelist/types'
import { catalogRowToLineItem } from '@/lib/pricelist/types'
import { PLAQUE_TOKENS } from '@/lib/pricelist/plaques'
import { COUNTRIES } from '@/lib/pricelist/flags'
import { PhotoPicker } from './PhotoPicker'

const DEFAULT_SETTINGS: PageSettings = {
  title: 'Wine & Whiskey', grouping: 'type', showDividers: false, tierThresholds: [600, 1000],
  oddItemMode: 'solo-wide', headerContact: 'WhatsApp · Irina +66 93 914 0004',
  vatNote: '7% VAT NOT INCLUDED', cardsPerPage: 14, qrUrl: 'https://wa.me/66939140004',
}

const ZONES: PlaqueZone[] = ['white', 'red', 'sparkling', 'rose', 'spirits']
const GROUPINGS: Grouping[] = ['producer', 'type', 'region', 'tier', 'grape', 'curated', 'manual']

type Action =
  | { t: 'add'; item: LineItem } | { t: 'remove'; id: string }
  | { t: 'update'; id: string; patch: Partial<LineItem> }
  | { t: 'reorder'; from: number; to: number }
  | { t: 'settings'; patch: Partial<PageSettings> }
  | { t: 'load'; doc: PriceListDoc }

function reducer(doc: PriceListDoc, a: Action): PriceListDoc {
  switch (a.t) {
    case 'add': return { ...doc, items: [...doc.items, a.item] }
    case 'remove': return { ...doc, items: doc.items.filter(i => i.id !== a.id) }
    case 'update': return { ...doc, items: doc.items.map(i => i.id === a.id ? { ...i, ...a.patch } : i) }
    case 'reorder': { const items = [...doc.items]; const [mv] = items.splice(a.from, 1); items.splice(a.to, 0, mv); return { ...doc, items } }
    case 'settings': return { ...doc, settings: { ...doc.settings, ...a.patch } }
    // Merge onto defaults so a saved list with partial/empty settings ({} DB
    // default) can't produce undefined fields → uncontrolled inputs / bad layout.
    case 'load': return { settings: { ...DEFAULT_SETTINGS, ...a.doc.settings }, items: a.doc.items ?? [] }
  }
}

let uidN = 0
const uid = () => `ui_${++uidN}`

type SavedRef = { id: string; title: string; updated_at: string }
type SourceMode = 'catalog' | 'import' | 'manual'
type ImportResult = { items: LineItem[]; report: { total: number; missingName: number; missingPrice: number; matchedHeaders: string[] } }

const inputCls = 'w-full px-2 py-1 border border-pale-stone rounded text-sm bg-white'
const labelCls = 'text-[11px] uppercase tracking-wide text-graphite/70'

export function PricelistBuilderClient({ catalog, saved, imageSlugs }: { catalog: CatalogRow[]; saved: SavedRef[]; imageSlugs: string[] }) {
  const [doc, dispatch] = useReducer(reducer, { settings: DEFAULT_SETTINGS, items: [] })
  const [rendering, setRendering] = useState(false)
  const availableImages = useMemo(() => new Set(imageSlugs), [imageSlugs])

  // LEFT-pane local state
  const [mode, setMode] = useState<SourceMode>('catalog')
  const [search, setSearch] = useState('')
  const [imported, setImported] = useState<ImportResult | null>(null)
  const [manual, setManual] = useState<{ name: string; price: string; zone: PlaqueZone }>({ name: '', price: '', zone: 'red' })

  // Save state
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function exportDoc() {
    setRendering(true)
    try {
      const res = await fetch('/api/m/pricelist/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc) })
      const { pdf, pngs, error } = await res.json()
      if (error) { alert(error); return }
      downloadB64(pdf, 'application/pdf', `${doc.settings.title}.pdf`)
      pngs.forEach((p: string, i: number) => downloadB64(p, 'image/png', `${doc.settings.title}-${i + 1}.png`))
    } finally { setRendering(false) }
  }

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/m/pricelist/import', { method: 'POST', body: fd })
    const json = await res.json()
    if (json.error) { alert(json.error); return }
    setImported(json as ImportResult)
  }

  async function save() {
    // Prompt for a name on first save so lists aren't all "Wine & Whiskey".
    // Editing an existing list keeps its name (rename via the Title field).
    let title = doc.settings.title
    if (!currentId) {
      const name = window.prompt('Name this price list', title || 'Wine & Whiskey')
      if (name === null) return // cancelled
      title = name.trim() || title
    }
    const toSave = { ...doc, settings: { ...doc.settings, title } }
    setSaving(true)
    try {
      if (currentId) {
        await fetch(`/api/m/pricelist/lists/${currentId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(toSave) })
      } else {
        const res = await fetch('/api/m/pricelist/lists', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(toSave) })
        const { id, error } = await res.json()
        if (error) { alert(error); return }
        if (id) { setCurrentId(id); dispatch({ t: 'settings', patch: { title } }) }
      }
    } finally { setSaving(false) }
  }

  async function loadList(id: string) {
    if (!id) return
    const res = await fetch(`/api/m/pricelist/lists/${id}`)
    const row = await res.json()
    if (row.error) { alert(row.error); return }
    dispatch({ t: 'load', doc: { settings: row.settings, items: row.items } })
    setCurrentId(id)
  }

  const filtered = search.trim()
    ? catalog.filter(r => r.name.toLowerCase().includes(search.trim().toLowerCase()))
    : catalog
  const shown = filtered.slice(0, 100)

  return (
    <div className="flex flex-1 min-h-0">
      <datalist id="pl-countries">{COUNTRIES.map(c => <option key={c} value={c} />)}</datalist>
      {/* LEFT — sources */}
      <aside className="w-72 border-r border-pale-stone overflow-auto p-3">
        <div className="flex gap-1 mb-3">
          {(['catalog', 'import', 'manual'] as SourceMode[]).map(m => (
            <button type="button" key={m} onClick={() => setMode(m)}
              className={`flex-1 px-2 py-1 rounded text-xs capitalize ${mode === m ? 'bg-wine-red text-white' : 'bg-cream text-graphite'}`}>
              {m}
            </button>
          ))}
        </div>

        {mode === 'catalog' && (
          <div>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search catalog…" className={`${inputCls} mb-2`} />
            <div className="text-[11px] text-graphite/60 mb-1">{filtered.length} items{filtered.length > 100 ? ' (showing 100)' : ''}</div>
            <ul className="space-y-1">
              {shown.map(row => (
                <li key={row.code} className="flex items-center gap-2 text-sm">
                  <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PLAQUE_TOKENS[row.zone] }} />
                  <span className="flex-1 truncate" title={row.name}>{row.name}</span>
                  <span className="text-graphite/70 tabular-nums">{row.price ?? '—'}</span>
                  <button type="button" onClick={() => dispatch({ t: 'add', item: catalogRowToLineItem(row, uid()) })}
                    className="px-1.5 py-0.5 bg-cream rounded text-xs hover:bg-pale-stone">Add</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {mode === 'import' && (
          <div className="space-y-3">
            <div className="text-xs text-graphite/80 space-y-2 rounded-md border border-pale-stone bg-white/60 p-2.5">
              <p>Upload a <b>CSV</b> or <b>Excel</b> (.xlsx/.xls) — the first sheet, first row = column headers. Headers are matched case-insensitively (EN or RU); unknown columns are ignored.</p>
              <div>
                <div className={labelCls}>Recognized columns</div>
                <ul className="mt-1 space-y-0.5">
                  <li><b>name</b> <span className="text-graphite/60">(required) — наименование / вино</span></li>
                  <li><b>price</b> <span className="text-graphite/60">(required) — цена, THB</span></li>
                  <li><b>type</b> <span className="text-graphite/60">— white / red / sparkling / rosé / spirits (белое/красное/игристое/розе/крепкое)</span></li>
                  <li><b>country</b> · <b>region</b> · <b>grape</b> <span className="text-graphite/60">— страна / регион / сорт</span></li>
                  <li><b>producer</b> · <b>volume</b> <span className="text-graphite/60">— производитель / объём (750ml)</span></li>
                  <li><b>image</b> <span className="text-graphite/60">— ссылка на фото (http/https)</span></li>
                </ul>
              </div>
              <p className="text-graphite/60">Rows without <b>name</b> or <b>price</b> are flagged below but still imported — you can fix them in the editor. <b>type</b> sets the plaque colour; if omitted it defaults to White (change it per card).</p>
            </div>
            <input type="file" accept=".csv,.xlsx,.xls" onChange={onImportFile} className="text-sm" />
            {imported && (
              <div className="text-xs text-graphite/80 space-y-1">
                <div>Total: {imported.report.total}</div>
                <div>Missing name: {imported.report.missingName}</div>
                <div>Missing price: {imported.report.missingPrice}</div>
                <div>Headers: {imported.report.matchedHeaders.join(', ') || '—'}</div>
                <button type="button" onClick={() => imported.items.forEach(it => dispatch({ t: 'add', item: { ...it, id: uid() } }))}
                  className="mt-1 px-2 py-1 bg-wine-red text-white rounded text-xs">Add all ({imported.items.length})</button>
              </div>
            )}
          </div>
        )}

        {mode === 'manual' && (
          <form className="space-y-2" onSubmit={e => {
            e.preventDefault()
            if (!manual.name.trim()) return
            const price = manual.price.trim() === '' ? null : Number(manual.price)
            dispatch({ t: 'add', item: { id: uid(), name: manual.name.trim(), price: Number.isNaN(price as number) ? null : price, zone: manual.zone } })
            setManual({ name: '', price: '', zone: manual.zone })
          }}>
            <input value={manual.name} onChange={e => setManual(s => ({ ...s, name: e.target.value }))} placeholder="Name" className={inputCls} />
            <input value={manual.price} onChange={e => setManual(s => ({ ...s, price: e.target.value }))} placeholder="Price" type="number" className={inputCls} />
            <select value={manual.zone} onChange={e => setManual(s => ({ ...s, zone: e.target.value as PlaqueZone }))} className={inputCls}>
              {ZONES.map(z => <option key={z} value={z}>{z}</option>)}
            </select>
            <button type="submit" className="w-full px-2 py-1 bg-wine-red text-white rounded text-sm">Add item</button>
          </form>
        )}
      </aside>

      {/* CENTER — editor */}
      <section className="w-96 border-r border-pale-stone overflow-auto p-3">
        {/* Settings */}
        <div className="space-y-2 pb-3 mb-3 border-b border-pale-stone">
          <div className="font-heading text-sm text-graphite">Settings</div>
          <div>
            <label className={labelCls}>Title</label>
            <input value={doc.settings.title} onChange={e => dispatch({ t: 'settings', patch: { title: e.target.value } })} className={inputCls} />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className={labelCls}>Grouping</label>
              <select value={doc.settings.grouping} onChange={e => dispatch({ t: 'settings', patch: { grouping: e.target.value as Grouping } })} className={inputCls}>
                {GROUPINGS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className={labelCls}>Odd item</label>
              <select value={doc.settings.oddItemMode} onChange={e => dispatch({ t: 'settings', patch: { oddItemMode: e.target.value as PageSettings['oddItemMode'] } })} className={inputCls}>
                <option value="solo-wide">solo-wide</option>
                <option value="tight">tight</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2 items-end">
            <div className="w-24">
              <label className={labelCls}>Cards/page</label>
              <input type="number" value={doc.settings.cardsPerPage} onChange={e => dispatch({ t: 'settings', patch: { cardsPerPage: Number(e.target.value) || 0 } })} className={inputCls} />
            </div>
            <label className="flex items-center gap-1 text-sm text-graphite pb-1">
              <input type="checkbox" checked={doc.settings.showDividers} onChange={e => dispatch({ t: 'settings', patch: { showDividers: e.target.checked } })} />
              Dividers
            </label>
          </div>
          <div>
            <label className={labelCls}>Header contact</label>
            <input value={doc.settings.headerContact} onChange={e => dispatch({ t: 'settings', patch: { headerContact: e.target.value } })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>VAT note</label>
            <input value={doc.settings.vatNote} onChange={e => dispatch({ t: 'settings', patch: { vatNote: e.target.value } })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>QR link (header)</label>
            <input value={doc.settings.qrUrl ?? ''} placeholder="https://wa.me/66939140004" onChange={e => dispatch({ t: 'settings', patch: { qrUrl: e.target.value } })} className={inputCls} />
          </div>
        </div>

        {/* Working list */}
        <div className="font-heading text-sm text-graphite mb-2">Items ({doc.items.length})</div>
        <div className="space-y-2">
          {doc.items.map((it, idx) => (
            <div key={it.id} className="border border-pale-stone rounded p-2 space-y-1 bg-warm-white">
              <div className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PLAQUE_TOKENS[it.zone] }} />
                <input value={it.name} onChange={e => dispatch({ t: 'update', id: it.id, patch: { name: e.target.value } })} className={`${inputCls} flex-1`} placeholder="Name" />
                <PhotoPicker item={it} images={imageSlugs} onChange={patch => dispatch({ t: 'update', id: it.id, patch })} />
              </div>
              <div className="flex gap-1">
                <input type="number" value={it.price ?? ''} onChange={e => dispatch({ t: 'update', id: it.id, patch: { price: e.target.value === '' ? null : Number(e.target.value) } })} className={`${inputCls} w-20`} placeholder="Price" />
                <select value={it.zone} onChange={e => dispatch({ t: 'update', id: it.id, patch: { zone: e.target.value as PlaqueZone } })} className={`${inputCls} flex-1`}>
                  {ZONES.map(z => <option key={z} value={z}>{z}</option>)}
                </select>
                <select value={it.rowLayout ?? 'auto'} onChange={e => dispatch({ t: 'update', id: it.id, patch: { rowLayout: e.target.value === 'auto' ? undefined : (e.target.value as RowLayout) } })} className={`${inputCls} w-24`}>
                  <option value="auto">auto</option>
                  <option value="pair">pair</option>
                  <option value="solo-wide">solo-wide</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <input value={it.producer ?? ''} onChange={e => dispatch({ t: 'update', id: it.id, patch: { producer: e.target.value || undefined } })} className={inputCls} placeholder="Producer" />
                <input value={it.region ?? ''} onChange={e => dispatch({ t: 'update', id: it.id, patch: { region: e.target.value || undefined } })} className={inputCls} placeholder="Region" />
                <input value={it.country ?? ''} list="pl-countries" onChange={e => dispatch({ t: 'update', id: it.id, patch: { country: e.target.value || undefined } })} className={inputCls} placeholder="Country" />
                <input value={it.grape ?? ''} onChange={e => dispatch({ t: 'update', id: it.id, patch: { grape: e.target.value || undefined } })} className={inputCls} placeholder="Grape" />
                <input value={it.volume ?? ''} onChange={e => dispatch({ t: 'update', id: it.id, patch: { volume: e.target.value || undefined } })} className={inputCls} placeholder="Volume" />
              </div>
              <div className="flex gap-1 justify-end">
                <button type="button" disabled={idx === 0} onClick={() => dispatch({ t: 'reorder', from: idx, to: idx - 1 })} className="px-1.5 py-0.5 bg-cream rounded text-xs disabled:opacity-30">↑</button>
                <button type="button" disabled={idx === doc.items.length - 1} onClick={() => dispatch({ t: 'reorder', from: idx, to: idx + 1 })} className="px-1.5 py-0.5 bg-cream rounded text-xs disabled:opacity-30">↓</button>
                <button type="button" onClick={() => dispatch({ t: 'remove', id: it.id })} className="px-1.5 py-0.5 bg-rose-dust/40 rounded text-xs">Remove</button>
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="mt-3 pt-3 border-t border-pale-stone space-y-2">
          <div className="flex gap-2">
            <button type="button" disabled={saving} onClick={save} className="flex-1 px-3 py-2 bg-graphite text-white rounded text-sm disabled:opacity-50">
              {saving ? 'Saving…' : currentId ? 'Save' : 'Save new'}
            </button>
            <select defaultValue="" onChange={e => loadList(e.target.value)} className={`${inputCls} flex-1`}>
              <option value="">Saved lists…</option>
              {saved.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </div>
          <button type="button" disabled={rendering} onClick={exportDoc} className="w-full px-3 py-2 bg-wine-red text-white rounded text-sm disabled:opacity-50">
            {rendering ? 'Rendering…' : 'Export PNG + PDF'}
          </button>
        </div>
      </section>

      {/* RIGHT — preview */}
      <Preview doc={doc} availableImages={availableImages} />
    </div>
  )
}

function downloadB64(b64: string, mime: string, filename: string) {
  const a = document.createElement('a')
  a.href = `data:${mime};base64,${b64}`; a.download = filename; a.click()
}
