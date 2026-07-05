'use client'

import { useMemo, useState } from 'react'
import { NumCell, OverrideNumCell, ClosingCell } from './ConsignmentReportCells'

export type ReportRow = {
  sku_id: string; sku_name: string; sku_code: string
  opening: number | null; delivered: number
  b2c: number; b2cAuto: number; b2cOverride: number | null
  b2b: number; b2bAuto: number; b2bOverride: number | null
  sold: number; tastings: number
  closing: number | null; closingAuto: number | null; closingManual: number | null
  hc: number | null; amount: number | null
  onHand: number | null
}

type SortKey = 'sku_name' | 'activity' | 'opening' | 'delivered' | 'b2c' | 'b2b' | 'sold' | 'tastings' | 'closing' | 'onHand' | 'hc' | 'amount'

const COLS: Array<{ key: SortKey; label: string; align: 'left' | 'right' }> = [
  { key: 'sku_name', label: 'SKU', align: 'left' },
  { key: 'opening', label: 'Opening', align: 'right' },
  { key: 'delivered', label: 'Delivered', align: 'right' },
  { key: 'b2c', label: 'Sold B2C', align: 'right' },
  { key: 'b2b', label: 'Sold B2B', align: 'right' },
  { key: 'sold', label: 'TOTAL', align: 'right' },
  { key: 'tastings', label: 'Tastings', align: 'right' },
  { key: 'closing', label: 'Closing', align: 'right' },
  { key: 'onHand', label: 'Loyverse', align: 'right' },
  { key: 'hc', label: 'HC ฿', align: 'right' },
  { key: 'amount', label: 'Amount ฿', align: 'right' },
]

function value(r: ReportRow, key: SortKey): number | string | null {
  switch (key) {
    case 'sku_name': return r.sku_name
    case 'activity': return r.sold + r.tastings + r.delivered
    default: return r[key] as number | null
  }
}

export function ConsignmentReportTable({ supplierId, period, rows, mode = 'cost_plus' }: {
  supplierId: string; period: string; rows: ReportRow[]; mode?: 'cost_plus' | 'retail_minus'
}) {
  // 'HC' is Harvest jargon (wholesale cost/unit). For retail_minus it's the
  // discounted list price per unit, so label it plainly.
  const unitLabel = mode === 'retail_minus' ? 'Cost/u ฿' : 'HC ฿'
  const cols = COLS.map(c => (c.key === 'hc' ? { ...c, label: unitLabel } : c))
  // Default = activity desc (most-moved SKUs first), matching the old order.
  const [sortKey, setSortKey] = useState<SortKey>('activity')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')

  function onSort(key: SortKey) {
    if (key === sortKey) { setDir(d => (d === 'asc' ? 'desc' : 'asc')); return }
    setSortKey(key)
    setDir(key === 'sku_name' ? 'asc' : 'desc')   // text defaults A→Z, numbers high→low
  }

  const sorted = useMemo(() => {
    const out = [...rows]
    out.sort((a, b) => {
      const av = value(a, sortKey), bv = value(b, sortKey)
      let c: number
      if (sortKey === 'sku_name') {
        c = String(av).localeCompare(String(bv))
      } else {
        const an = av as number | null, bn = bv as number | null
        if (an == null && bn == null) c = 0
        else if (an == null) return 1            // nulls always bottom
        else if (bn == null) return -1
        else c = an - bn
      }
      if (dir === 'desc') c = -c
      return c || a.sku_name.localeCompare(b.sku_name)   // stable tiebreak by name
    })
    return out
  }, [rows, sortKey, dir])

  const totals = rows.reduce((acc, r) => {
    acc.opening += r.opening ?? 0; acc.delivered += r.delivered
    acc.b2c += r.b2c; acc.b2b += r.b2b; acc.sold += r.sold; acc.tastings += r.tastings
    acc.closing += r.closing ?? 0; acc.amount += r.amount ?? 0; acc.onHand += r.onHand ?? 0
    return acc
  }, { opening: 0, delivered: 0, b2c: 0, b2b: 0, sold: 0, tastings: 0, closing: 0, amount: 0, onHand: 0 })

  return (
    <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
      <table className="w-full text-[13px]">
        <thead className="text-graphite border-b border-pale-stone bg-cream/40">
          <tr>
            {cols.map(col => (
              <th key={col.key} className={`py-2 px-3 font-normal ${col.align === 'left' ? 'text-left' : 'text-right'}`}>
                <button
                  onClick={() => onSort(col.key)}
                  className={`inline-flex items-center gap-1 hover:text-wine-red ${sortKey === col.key ? 'text-wine-red' : ''} ${col.align === 'right' ? 'flex-row-reverse' : ''}`}
                  title="Sort"
                >
                  {col.label}
                  <span className="text-[9px] w-2">{sortKey === col.key ? (dir === 'asc' ? '▲' : '▼') : ''}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr><td colSpan={11} className="py-6 text-center text-graphite text-sm">No SKUs priced for this supplier. Add consignment prices first.</td></tr>
          )}
          {sorted.map(r => (
            <tr key={r.sku_id} className="border-b border-pale-stone/40 last:border-0 hover:bg-cream/40">
              <td className="py-2 px-3 truncate max-w-[22rem]" title={r.sku_name}>
                {r.sku_name}
                {r.sku_code && <span className="ml-2 text-[10px] text-graphite/70 font-mono">{r.sku_code}</span>}
              </td>
              <td className="py-2 px-3 text-right">
                <NumCell supplierId={supplierId} skuId={r.sku_id} period={period} field="opening_stock" initial={r.opening} />
              </td>
              <td className="py-2 px-3 text-right tabular-nums text-graphite">{r.delivered || <span className="text-graphite/40">—</span>}</td>
              <td className="py-2 px-3 text-right">
                <OverrideNumCell supplierId={supplierId} skuId={r.sku_id} period={period} field="b2c_override"
                  auto={r.b2cAuto} override={r.b2cOverride}
                  salesHref={`/m/suppliers/${supplierId}/report/sales?period=${period}&sku_id=${r.sku_id}&channel=b2c`} />
              </td>
              <td className="py-2 px-3 text-right">
                <OverrideNumCell supplierId={supplierId} skuId={r.sku_id} period={period} field="b2b_override"
                  auto={r.b2bAuto} override={r.b2bOverride}
                  salesHref={`/m/suppliers/${supplierId}/report/sales?period=${period}&sku_id=${r.sku_id}&channel=b2b`} />
              </td>
              <td className="py-2 px-3 text-right tabular-nums font-medium">{r.sold || <span className="text-graphite/40">—</span>}</td>
              <td className="py-2 px-3 text-right">
                <NumCell supplierId={supplierId} skuId={r.sku_id} period={period} field="tastings" initial={r.tastings || null} />
              </td>
              <td className="py-2 px-3 text-right">
                <ClosingCell supplierId={supplierId} skuId={r.sku_id} period={period} auto={r.closingAuto} override={r.closingManual} />
              </td>
              <td className="py-2 px-3 text-right tabular-nums">
                {r.onHand == null
                  ? <span className="text-graphite/40">—</span>
                  : (r.closing != null && r.closing !== r.onHand)
                    ? <span className="text-wine-red font-medium" title={`Closing ${r.closing} ≠ Loyverse on-hand ${r.onHand} — reconcile before closing`}>
                        {r.onHand}<span className="ml-1 text-[10px]">Δ{r.closing - r.onHand > 0 ? '+' : ''}{r.closing - r.onHand}</span>
                      </span>
                    : <span className="text-emerald-700">{r.onHand}</span>}
              </td>
              <td className="py-2 px-3 text-right tabular-nums text-graphite">{r.hc == null ? <span className="text-amber-gold">n/a</span> : r.hc.toLocaleString('en-US')}</td>
              <td className="py-2 px-3 text-right tabular-nums font-medium">{r.amount == null ? <span className="text-amber-gold">n/a</span> : r.amount ? `฿${Math.round(r.amount).toLocaleString('en-US')}` : <span className="text-graphite/40">—</span>}</td>
            </tr>
          ))}
          {sorted.length > 0 && (
            <tr className="bg-cream/60 font-medium">
              <td className="py-2 px-3 text-graphite text-xs uppercase tracking-overline">Total</td>
              <td className="py-2 px-3 text-right tabular-nums">{totals.opening}</td>
              <td className="py-2 px-3 text-right tabular-nums">{totals.delivered}</td>
              <td className="py-2 px-3 text-right tabular-nums">{totals.b2c}</td>
              <td className="py-2 px-3 text-right tabular-nums">{totals.b2b}</td>
              <td className="py-2 px-3 text-right tabular-nums">{totals.sold}</td>
              <td className="py-2 px-3 text-right tabular-nums">{totals.tastings}</td>
              <td className="py-2 px-3 text-right tabular-nums">{totals.closing}</td>
              <td className="py-2 px-3 text-right tabular-nums">{totals.onHand}</td>
              <td className="py-2 px-3"></td>
              <td className="py-2 px-3 text-right tabular-nums">฿{Math.round(totals.amount).toLocaleString('en-US')}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
