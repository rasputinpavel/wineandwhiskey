import Link from 'next/link'
import { sbInventory, type Supplier } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { NewDeliveryRow, DeleteDeliveryCell } from '@/components/modules/suppliers/ConsignmentDeliveryCells'

export const dynamic = 'force-dynamic'

type DeliveryRow = {
  id: string
  delivered_at: string
  qty: number
  note: string | null
  sku: { name: string; loyverse_product_code: string | null } | null
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
  const totalUnits = rows.reduce((sum, r) => sum + Number(r.qty), 0)

  return (
    <>
      <div className="mb-4">
        <Link href={`/m/suppliers/${id}`} className="text-xs text-graphite hover:text-wine-red">← Back to {s.name}</Link>
        <h2 className="font-heading text-2xl text-deep-black mt-3">{s.name} · Deliveries</h2>
        <p className="text-graphite text-sm mt-1 max-w-3xl">
          Stock arrivals booked outside Purchase Orders (entered directly into Loyverse as adjustments).
          Each line adds the quantity to stock from its date. The Monthly Report uses these to reconcile
          closing stock — deliveries do <strong>not</strong> change the settlement (we still pay per unit sold).
          Use a negative quantity for a correction or return.
        </p>
      </div>

      {tableMissing && (
        <p className="mb-3 text-[12px] text-wine-red">
          Deliveries table missing — apply migration 022_consignment_delivery.sql in Supabase.
        </p>
      )}

      <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="text-graphite border-b border-pale-stone bg-cream/40">
            <tr>
              <th className="py-2 px-4 text-left font-normal">Date</th>
              <th className="py-2 px-4 text-left font-normal">SKU</th>
              <th className="py-2 px-4 text-left font-normal">Code</th>
              <th className="py-2 px-4 text-right font-normal">Qty</th>
              <th className="py-2 px-4 text-left font-normal">Note</th>
              <th className="py-2 px-4 text-right font-normal w-12"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-b border-pale-stone/40 last:border-0 hover:bg-cream/40">
                <td className="py-2 px-4 tabular-nums">{r.delivered_at}</td>
                <td className="py-2 px-4 truncate max-w-[22rem]" title={r.sku?.name ?? ''}>{r.sku?.name ?? '(unknown SKU)'}</td>
                <td className="py-2 px-4 font-mono text-xs text-graphite">{r.sku?.loyverse_product_code ?? '—'}</td>
                <td className={`py-2 px-4 text-right tabular-nums ${Number(r.qty) < 0 ? 'text-wine-red' : ''}`}>{Number(r.qty).toLocaleString('en-US')}</td>
                <td className="py-2 px-4 text-graphite text-xs">{r.note ?? '—'}</td>
                <td className="py-2 px-4 text-right"><DeleteDeliveryCell id={r.id} label={`${r.sku?.name ?? ''} ×${r.qty} on ${r.delivered_at}`} /></td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="py-6 text-center text-graphite text-sm">
                No deliveries logged yet. Add the first one below.
              </td></tr>
            )}
            {rows.length > 0 && (
              <tr className="bg-cream/60 font-medium">
                <td className="py-2 px-4 text-graphite text-xs uppercase tracking-overline" colSpan={3}>Total</td>
                <td className="py-2 px-4 text-right tabular-nums">{totalUnits.toLocaleString('en-US')}</td>
                <td className="py-2 px-4" colSpan={2}></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <NewDeliveryRow supplierId={id} />
    </>
  )
}
