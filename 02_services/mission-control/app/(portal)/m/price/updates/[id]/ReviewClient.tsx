'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CatalogUpdate } from '@/lib/price/supabase'
import type { DiffKind, ItemSnapshot } from '@/lib/price/reconcile'
import type { ExtractedItem } from '@/lib/price/claude'

const KIND_LABEL: Record<DiffKind, string> = {
  added: 'New', price_changed: 'Price changed', updated: 'Details changed',
  unchanged: 'Unchanged', discontinued: 'Discontinued', reactivated: 'Back in stock',
  ambiguous: 'Needs match',
}
// Order groups by how much attention they need.
const GROUP_ORDER: DiffKind[] = ['ambiguous', 'price_changed', 'updated', 'discontinued', 'added', 'reactivated']

const FIELD_LABEL: Record<string, string> = {
  description: 'Notes', grape_variety: 'Grape', region: 'Region',
  country: 'Country', year: 'Vintage', wine_type: 'Type', volume: 'Volume',
}
const ACCENT: Record<DiffKind, string> = {
  added: 'text-emerald-700', price_changed: 'text-amber-700', updated: 'text-amber-700',
  discontinued: 'text-red-600', reactivated: 'text-emerald-700', ambiguous: 'text-violet-700', unchanged: '',
}

type Decision = { accept: boolean; bindTo?: string | 'new' }

const money = (v: number | null | undefined) => (v == null ? '—' : '฿' + v.toLocaleString('en-US'))
const clip = (v: unknown, n = 48) => {
  if (v == null || v === '') return '—'
  const s = String(v)
  return s.length > n ? s.slice(0, n) + '…' : s
}

function Arrow() {
  return <span className="mx-1.5 text-gray-400">→</span>
}

// before → after for one field
function FieldDelta({ label, before, after }: { label: string; before: unknown; after: unknown }) {
  return (
    <div className="text-xs leading-5">
      <span className="text-gray-400">{label}: </span>
      <span className="line-through text-gray-400">{clip(before)}</span>
      <Arrow />
      <span className="text-gray-800">{clip(after)}</span>
    </div>
  )
}

export default function ReviewClient({ update }: { update: CatalogUpdate }) {
  const router = useRouter()
  const changes = update.diff.changes
  const [decisions, setDecisions] = useState<Record<number, Decision>>(() => {
    const init: Record<number, Decision> = {}
    changes.forEach((c, i) => {
      if (c.kind !== 'unchanged') init[i] = { accept: c.kind !== 'ambiguous' }
    })
    return init
  })
  const [busy, setBusy] = useState(false)

  const setAccept = (i: number, accept: boolean) =>
    setDecisions(s => ({ ...s, [i]: { ...s[i], accept } }))
  const setBind = (i: number, bindTo: string) =>
    setDecisions(s => ({ ...s, [i]: { ...s[i], bindTo } }))

  const unresolvedAmbiguous = useMemo(
    () => changes.some((c, i) => c.kind === 'ambiguous' && decisions[i]?.accept && !decisions[i]?.bindTo),
    [changes, decisions])
  const acceptedCount = useMemo(
    () => changes.filter((_, i) => decisions[i]?.accept).length, [changes, decisions])

  async function apply() {
    setBusy(true)
    const res = await fetch(`/api/m/price/updates/${update.id}/apply`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decisions }),
    })
    setBusy(false)
    if (res.ok) router.push('/m/price/price-lists')
    else alert('Apply failed: ' + (await res.json()).error)
  }
  async function discard() {
    if (!confirm('Discard this update? No catalog changes will be made.')) return
    setBusy(true)
    await fetch(`/api/m/price/updates/${update.id}`, { method: 'DELETE' })
    setBusy(false)
    router.push('/m/price/price-lists')
  }

  const groups = GROUP_ORDER
    .map(k => ({ k, items: changes.map((c, i) => ({ c, i })).filter(x => x.c.kind === k) }))
    .filter(g => g.items.length)
  const unchangedCount = changes.filter(c => c.kind === 'unchanged').length

  const setGroupAccept = (k: DiffKind, accept: boolean) =>
    setDecisions(s => {
      const next = { ...s }
      changes.forEach((c, i) => { if (c.kind === k && !(accept && c.kind === 'ambiguous' && !next[i]?.bindTo)) next[i] = { ...next[i], accept } })
      return next
    })

  return (
    <div className="p-6 max-w-3xl mx-auto pb-24">
      <h1 className="text-xl font-semibold text-deep-black">Review catalog update — {update.diff.supplier_name}</h1>
      <p className="text-sm text-gray-500 mt-1 mb-4">
        {changes.length - unchangedCount} changes · {unchangedCount} unchanged hidden
      </p>

      {/* summary chips */}
      <div className="flex flex-wrap gap-2 mb-6">
        {groups.map(({ k, items }) => (
          <span key={k} className={`text-xs px-2 py-1 rounded-full bg-white border border-pale-stone ${ACCENT[k]}`}>
            {KIND_LABEL[k]} · {items.length}
          </span>
        ))}
      </div>

      {groups.map(({ k, items }) => (
        <section key={k} className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className={`font-medium ${ACCENT[k]}`}>{KIND_LABEL[k]} <span className="text-gray-400 font-normal">({items.length})</span></h2>
            <div className="text-xs text-gray-400 flex gap-2">
              <button className="hover:text-gray-700" onClick={() => setGroupAccept(k, true)}>select all</button>
              <span>·</span>
              <button className="hover:text-gray-700" onClick={() => setGroupAccept(k, false)}>clear</button>
            </div>
          </div>

          <ul className="divide-y border border-pale-stone rounded-lg bg-white">
            {items.map(({ c, i }) => {
              const name = c.kind === 'discontinued' ? c.existing_name : (c.incoming?.name ?? c.existing_name)
              const ex = c.existing as ItemSnapshot | null
              const inc = c.incoming as ExtractedItem | null
              return (
                <li key={i} className="p-3 flex gap-3">
                  <input type="checkbox" className="mt-1" checked={decisions[i]?.accept ?? false}
                    onChange={e => setAccept(i, e.target.checked)} />
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm text-deep-black ${c.kind === 'discontinued' ? 'line-through text-gray-500' : ''}`}>{name}</div>

                    {c.kind === 'price_changed' && (
                      <div className="text-xs mt-0.5">
                        <span className="line-through text-gray-400">{money(c.old_price)}</span>
                        <Arrow />
                        <span className={`font-medium ${(inc?.price ?? 0) > (c.old_price ?? 0) ? 'text-red-600' : 'text-emerald-700'}`}>{money(inc?.price)}</span>
                      </div>
                    )}

                    {c.kind === 'updated' && (
                      <div className="mt-0.5 space-y-0.5">
                        {(c.old_price !== (inc?.price ?? null)) && (
                          <FieldDelta label="Price" before={money(c.old_price)} after={money(inc?.price)} />
                        )}
                        {(c.changed_fields ?? []).map(f => (
                          <FieldDelta key={f} label={FIELD_LABEL[f] ?? f}
                            before={ex ? (ex as unknown as Record<string, unknown>)[f] : undefined}
                            after={inc ? (inc as unknown as Record<string, unknown>)[f] : undefined} />
                        ))}
                      </div>
                    )}

                    {c.kind === 'added' && (
                      <div className="text-xs text-gray-500 mt-0.5">
                        <span className="text-emerald-700 font-medium">{money(inc?.price)}</span>
                        {inc?.wine_type && <span> · {inc.wine_type}</span>}
                        {inc?.grape_variety && <span> · {clip(inc.grape_variety, 30)}</span>}
                        {inc?.volume && <span> · {inc.volume}</span>}
                      </div>
                    )}

                    {c.kind === 'discontinued' && (
                      <div className="text-xs text-gray-500 mt-0.5">was {money(c.old_price)} · not in new catalog</div>
                    )}

                    {c.kind === 'reactivated' && (
                      <div className="text-xs mt-0.5">
                        <span className="text-gray-400">was discontinued</span><Arrow />
                        <span className="text-emerald-700 font-medium">{money(inc?.price)}</span>
                      </div>
                    )}

                    {c.kind === 'ambiguous' && (
                      <div className="mt-1">
                        <div className="text-xs text-gray-500">new: {money(inc?.price)}{inc?.wine_type ? ` · ${inc.wine_type}` : ''}</div>
                        <select className="mt-1 text-sm border border-pale-stone rounded px-2 py-1 w-full max-w-md"
                          value={decisions[i]?.bindTo ?? ''}
                          onChange={e => setBind(i, e.target.value)}>
                          <option value="">— is this an existing item? —</option>
                          {(c.candidates ?? []).map(cand =>
                            <option key={cand.id} value={cand.id}>Same as: {cand.name} ({money(cand.price)})</option>)}
                          <option value="new">Add as a new item</option>
                        </select>
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      <div className="fixed bottom-0 left-0 right-0 border-t border-pale-stone bg-white/95 backdrop-blur">
        <div className="max-w-3xl mx-auto px-6 py-3 flex items-center gap-3">
          <button disabled={busy || unresolvedAmbiguous} onClick={apply}
            className="px-4 py-2 rounded-lg bg-wine-red text-warm-white text-sm disabled:opacity-40">
            Apply {acceptedCount} {acceptedCount === 1 ? 'change' : 'changes'}
          </button>
          <button disabled={busy} onClick={discard}
            className="px-4 py-2 rounded-lg border border-pale-stone text-sm">Discard</button>
          {unresolvedAmbiguous && <span className="text-xs text-red-600">Resolve every “Needs match” first (or uncheck it).</span>}
        </div>
      </div>
    </div>
  )
}
