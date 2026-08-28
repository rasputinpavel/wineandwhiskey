import { Fragment } from 'react'
import Link from 'next/link'
import { sbInventory, type Supplier } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { NewDeliveryForm, DeleteDeliveryCell, DeleteDeliveryGroupCell } from '@/components/modules/suppliers/ConsignmentDeliveryCells'

export const dynamic = 'force-dynamic'

type DeliveryRow = {
  id: string
  delivered_at: string
  qty: number
  note: string | null
  sku: { name: string; loyverse_product_code: string | null } | null
}

type DeliveryGroup = {
  key: string
  delivered_at: string
  note: string | null
  lines: DeliveryRow[]
  units: number
}

// A "delivery" has no header row in the DB — it is the set of lines sharing the
// same date and note (the supplier's delivery-note number). Group on that pair
// so one shipment reads as one document, the way it was entered.
function groupDeliveries(rows: DeliveryRow[]): DeliveryGroup[] {
  const groups = new Map<string, DeliveryGroup>()
  for (const r of rows) {
    const key = `${r.delivered_at} ${r.note ?? ''}`
    let g = groups.get(key)
    if (!g) {
      g = { key, delivered_at: r.delivered_at, note: r.note, lines: [], units: 0 }
      groups.set(key, g)
    }
    g.lines.push(r)
    g.units += Number(r.qty)
  }
  return [...groups.values()]
}

export default async function SupplierDeliveriesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [supRes, delRes] = await Promise.all([
    sbInventory.from('supplier').select('id, name, type').eq('id', id).maybeSingle(),
    sbInventory
      .from('consignment_delivery')
      .select('id, delivered_at, qty, note, sku:sku(name, loyverse_product_code)')
      .eq('supplier_id', id)
      .order('delivered_at', { ascending: false })
      .limit(2000),
  ])
  if (supRes.error) return <SchemaError error={supRes.error.message} />
  if (!supRes.data) return <div className="text-graphite">Supplier not found.</div>

  const s = supRes.data as Supplier
  const tableMissing = !!delRes.error
  const rows = (delRes.data ?? []) as unknown as DeliveryRow[]
  const groups = groupDeliveries(rows)
  const totalUnits = rows.reduce((sum, r) => sum + Number(r.qty), 0)

  return (
    <>
      <div className="mb-4">
        <Link href={`/m/suppliers/${id}`} className="text-xs text-graphite hover:text-wine-red">&larr; Back to {s.name}</Link>
        <h2 className="font-heading text-2xl text-deep-black mt-3">{s.name} &middot; Deliveries</h2>
        <p className="text-graphite text-sm mt-1 max-w-3xl">
          Stock arrivals booked outside Purchase Orders (entered directly into Loyverse as adjustments).
          One delivery = one date plus the supplier&apos;s note number; its lines add their quantities to
          stock from that date. The Monthly Report uses these to reconcile closing stock &mdash; deliveries
          do <strong>not</strong> change the settlement (we still pay per unit sold). Use a negative
          quantity for a correction or return.
        </p>
      </div>

      {tableMissing && (
        <p className="mb-3 text-[12px] text-wine-red">
          Deliveries table missing &mdash; apply migration 022_consignment_delivery.sql in Supabase.
        </p>
      )}

      <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="text-graphite border-b border-pale-stone bg-cream/40">
            <tr>
              <th className="py-2 px-4 text-left font-normal">SKU</th>
              <th className="py-2 px-4 text-left font-normal">Code</th>
              <th className="py-2 px-4 text-right font-normal">Qty</th>
              <th className="py-2 px-4 text-right font-normal w-24"></th>
            </tr>
          </thead>
          <tbody>
            {groups.map(g => (
              <Fragment key={g.key}>
                <tr className="bg-cream/50 border-y border-pale-stone/60">
                  <td className="py-2 px-4" colSpan={2}>
                    <span className="tabular-nums text-deep-black">{g.delivered_at}</span>
                    {g.note && <span className="text-graphite text-xs"> &middot; {g.note}</span>}
                    <span className="text-graphite text-xs"> &middot; {g.lines.length} line{g.lines.length === 1 ? '' : 's'}</span>
                  </td>
                  <td className="py-2 px-4 text-right tabular-nums font-medium">{g.units.toLocaleString('en-US')}</td>
                  <td className="py-2 px-4 text-right">
                    <DeleteDeliveryGroupCell supplierId={id} deliveredAt={g.delivered_at} note={g.note} lineCount={g.lines.length} />
                  </td>
                </tr>
                {g.lines.map(r => (
                  <tr key={r.id} className="border-b border-pale-stone/40 hover:bg-cream/30">
                    <td className="py-2 px-4 pl-8 truncate max-w-[24rem]" title={r.sku?.name ?? ''}>{r.sku?.name ?? '(unknown SKU)'}</td>
                    <td className="py-2 px-4 font-mono text-xs text-graphite">{r.sku?.loyverse_product_code ?? '—'}</td>
                    <td className={`py-2 px-4 text-right tabular-nums ${Number(r.qty) < 0 ? 'text-wine-red' : ''}`}>{Number(r.qty).toLocaleString('en-US')}</td>
                    <td className="py-2 px-4 text-right">
                      <DeleteDeliveryCell id={r.id} label={`${r.sku?.name ?? ''} x${r.qty} on ${r.delivered_at}`} />
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={4} className="py-6 text-center text-graphite text-sm">
                No deliveries logged yet. Add the first one below.
              </td></tr>
            )}
            {rows.length > 0 && (
              <tr className="bg-cream/60 font-medium">
                <td className="py-2 px-4 text-graphite text-xs uppercase tracking-overline" colSpan={2}>Total</td>
                <td className="py-2 px-4 text-right tabular-nums">{totalUnits.toLocaleString('en-US')}</td>
                <td className="py-2 px-4"></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <NewDeliveryForm supplierId={id} />
    </>
  )
}
