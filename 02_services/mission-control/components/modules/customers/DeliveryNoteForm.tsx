'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { SkuPickerInline } from './SkuPickerInline'

type Line = {
  key: number
  sku_id: string | null
  sku_code: string | null
  sku_name: string | null
  qty: string
  unit_price: string
}

const newLine = (key: number): Line => ({
  key, sku_id: null, sku_code: null, sku_name: null, qty: '1', unit_price: '',
})

export function DeliveryNoteForm({ customerId, suggestedNumber }: {
  customerId: string
  suggestedNumber: string
}) {
  const router = useRouter()
  const today = new Date().toISOString().slice(0, 10)
  const [issuedAt, setIssuedAt] = useState(today)
  const [number, setNumber]     = useState(suggestedNumber)
  const [lines, setLines]       = useState<Line[]>([newLine(1)])
  const [saving, setSaving]     = useState(false)
  const [err, setErr]           = useState<string | null>(null)

  function addLine() {
    setLines(ls => [...ls, newLine((ls[ls.length - 1]?.key ?? 0) + 1)])
  }
  function removeLine(key: number) {
    setLines(ls => ls.length === 1 ? ls : ls.filter(l => l.key !== key))
  }
  function update(key: number, patch: Partial<Line>) {
    setLines(ls => ls.map(l => l.key === key ? { ...l, ...patch } : l))
  }

  async function save(opts: { thenPrint?: boolean } = {}) {
    setSaving(true); setErr(null)
    try {
      const payload = {
        issued_at: issuedAt,
        number: number.trim() || undefined,
        lines: lines
          .filter(l => l.sku_id && Number(l.qty) > 0)
          .map(l => ({
            sku_id: l.sku_id!,
            qty: Number(l.qty),
            unit_price: l.unit_price.trim() === '' ? null : Number(l.unit_price),
          })),
      }
      if (payload.lines.length === 0) {
        setErr('Add at least one SKU line with qty > 0')
        return
      }
      const res = await fetch(`/api/m/customers/${customerId}/delivery-notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`)
      if (opts.thenPrint) {
        // Print page is a top-level route — no portal shell, full scroll,
        // and browser Print sees only the document.
        router.push(`/print/dn/${j.id}`)
      } else {
        router.push(`/m/customers/${customerId}?tab=deliveries`)
        router.refresh()
      }
    } catch (e: any) {
      setErr(e?.message ?? String(e))
    } finally { setSaving(false) }
  }

  const total = lines.reduce((s, l) => {
    const q = Number(l.qty), p = Number(l.unit_price)
    return s + (Number.isFinite(q) && Number.isFinite(p) ? q * p : 0)
  }, 0)

  return (
    <form onSubmit={e => { e.preventDefault(); save() }} className="space-y-6">
      <div className="grid grid-cols-2 gap-4 max-w-md">
        <label className="block">
          <span className="overline text-graphite">Number</span>
          <input
            value={number}
            onChange={e => setNumber(e.target.value)}
            className="mt-1 w-full px-2 py-1.5 text-sm border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red font-mono"
          />
        </label>
        <label className="block">
          <span className="overline text-graphite">Issued at</span>
          <input
            type="date"
            value={issuedAt}
            onChange={e => setIssuedAt(e.target.value)}
            className="mt-1 w-full px-2 py-1.5 text-sm border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red"
          />
        </label>
      </div>

      <div>
        <div className="overline text-graphite mb-2">Lines</div>
        <div className="bg-warm-white border border-pale-stone rounded-md overflow-visible">
          <table className="w-full text-[13px]">
            <thead className="text-graphite border-b border-pale-stone bg-cream/40">
              <tr>
                <th className="text-left  py-2 px-3 w-[50%]">SKU</th>
                <th className="text-right py-2 px-3">Qty</th>
                <th className="text-right py-2 px-3">Unit ฿</th>
                <th className="text-right py-2 px-3">Line ฿</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map(l => {
                const lineTotal = Number(l.qty || 0) * Number(l.unit_price || 0)
                return (
                  <tr key={l.key} className="border-b border-pale-stone/40 last:border-0 align-top">
                    <td className="py-2 px-3">
                      <SkuPickerInline
                        initialName={l.sku_code ? `${l.sku_code} · ${l.sku_name}` : ''}
                        onPick={sku => update(l.key, {
                          sku_id: sku.id,
                          sku_code: sku.loyverse_product_code,
                          sku_name: sku.name,
                        })}
                      />
                    </td>
                    <td className="py-2 px-3">
                      <input type="number" min={0} step="any" value={l.qty}
                             onChange={e => update(l.key, { qty: e.target.value })}
                             className="w-20 px-2 py-1 text-right border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red tabular-nums" />
                    </td>
                    <td className="py-2 px-3">
                      <input type="number" min={0} step="any" value={l.unit_price}
                             onChange={e => update(l.key, { unit_price: e.target.value })}
                             placeholder="optional"
                             className="w-24 px-2 py-1 text-right border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red tabular-nums" />
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-graphite">
                      {lineTotal > 0 ? lineTotal.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—'}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <button type="button" onClick={() => removeLine(l.key)}
                              disabled={lines.length === 1}
                              className="text-graphite hover:text-wine-red disabled:opacity-30">×</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="px-3 py-2">
                  <button type="button" onClick={addLine}
                          className="text-xs text-graphite hover:text-wine-red border border-dashed border-pale-stone hover:border-wine-red px-2 py-1 rounded-sm">
                    + Add line
                  </button>
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">
                  {total > 0 ? `฿${total.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {err && <div className="text-sm text-wine-red">⚠ {err}</div>}

      <div className="flex gap-2">
        <button type="submit" disabled={saving}
                className="px-4 py-2 bg-wine-red hover:bg-burgundy-deep text-warm-white text-sm rounded-sm disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" disabled={saving} onClick={() => save({ thenPrint: true })}
                className="px-4 py-2 border border-pale-stone hover:border-wine-red hover:text-wine-red text-graphite text-sm rounded-sm transition-colors disabled:opacity-50">
          Save &amp; Print
        </button>
      </div>
    </form>
  )
}
