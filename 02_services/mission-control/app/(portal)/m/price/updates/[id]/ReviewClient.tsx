'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CatalogUpdate } from '@/lib/price/supabase'
import type { DiffChange, DiffKind } from '@/lib/price/reconcile'

const KIND_LABEL: Record<DiffKind, string> = {
  added: 'New', price_changed: 'Price changed', updated: 'Updated',
  unchanged: 'Unchanged', discontinued: 'Discontinued', reactivated: 'Back in stock',
  ambiguous: 'Needs match',
}
const ACTIONABLE: DiffKind[] = ['added', 'price_changed', 'updated', 'discontinued', 'reactivated', 'ambiguous']

type Decision = { accept: boolean; bindTo?: string | 'new' }

export default function ReviewClient({ update }: { update: CatalogUpdate }) {
  const router = useRouter()
  const changes = update.diff.changes
  const [decisions, setDecisions] = useState<Record<number, Decision>>(() => {
    const init: Record<number, Decision> = {}
    changes.forEach((c, i) => {
      if (ACTIONABLE.includes(c.kind))
        init[i] = { accept: c.kind !== 'ambiguous', bindTo: c.kind === 'ambiguous' ? undefined : undefined }
    })
    return init
  })
  const [busy, setBusy] = useState(false)

  const unresolvedAmbiguous = useMemo(
    () => changes.some((c, i) => c.kind === 'ambiguous' && decisions[i]?.accept && !decisions[i]?.bindTo),
    [changes, decisions])

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

  const groups = ACTIONABLE.map(k => ({ k, items: changes.map((c, i) => ({ c, i })).filter(x => x.c.kind === k) }))
    .filter(g => g.items.length)
  const unchangedCount = changes.filter(c => c.kind === 'unchanged').length

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-semibold mb-1">Review catalog update — {update.diff.supplier_name}</h1>
      <p className="text-sm text-gray-500 mb-4">{unchangedCount} unchanged items hidden.</p>

      {groups.map(({ k, items }) => (
        <section key={k} className="mb-6">
          <h2 className="font-medium mb-2">{KIND_LABEL[k]} ({items.length})</h2>
          <ul className="divide-y border rounded">
            {items.map(({ c, i }) => (
              <li key={i} className="p-3 flex items-center gap-3">
                <input type="checkbox" checked={decisions[i]?.accept ?? false}
                  onChange={e => setDecisions(s => ({ ...s, [i]: { ...s[i], accept: e.target.checked } }))} />
                <div className="flex-1">
                  <div className="text-sm">{c.incoming?.name ?? c.existing_name}</div>
                  <div className="text-xs text-gray-500">
                    {c.kind === 'price_changed' && `${c.old_price} → ${c.incoming?.price}`}
                    {c.kind === 'updated' && `changed: ${(c.changed_fields ?? []).join(', ')}`}
                    {c.kind === 'added' && `${c.incoming?.price ?? '—'}`}
                    {c.kind === 'discontinued' && 'absent from new PDF'}
                    {c.kind === 'reactivated' && `back at ${c.incoming?.price}`}
                  </div>
                  {c.kind === 'ambiguous' && (
                    <select className="mt-1 text-sm border rounded px-1"
                      value={decisions[i]?.bindTo ?? ''}
                      onChange={e => setDecisions(s => ({ ...s, [i]: { ...s[i], bindTo: e.target.value } }))}>
                      <option value="">— choose —</option>
                      {(c.candidates ?? []).map(cand =>
                        <option key={cand.id} value={cand.id}>Same as: {cand.name} ({cand.price})</option>)}
                      <option value="new">Add as new item</option>
                    </select>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <div className="flex gap-3 sticky bottom-0 bg-white py-3">
        <button disabled={busy || unresolvedAmbiguous} onClick={apply}
          className="px-4 py-2 rounded bg-black text-white disabled:opacity-40">Apply</button>
        <button disabled={busy} onClick={discard}
          className="px-4 py-2 rounded border">Discard</button>
        {unresolvedAmbiguous && <span className="text-xs text-red-600 self-center">Resolve all “Needs match” first.</span>}
      </div>
    </div>
  )
}
