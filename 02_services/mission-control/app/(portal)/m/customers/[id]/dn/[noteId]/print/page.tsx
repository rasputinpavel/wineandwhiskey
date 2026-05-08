import Link from 'next/link'
import { sbInventory } from '@/lib/supabase'
import { PrintButton } from '@/components/modules/customers/PrintButton'

export const dynamic = 'force-dynamic'

export default async function PrintDeliveryNote({ params }: { params: Promise<{ id: string; noteId: string }> }) {
  const { id: customerId, noteId } = await params

  // Header + nested customer/location lookup.
  const { data: note } = await sbInventory
    .from('delivery_note')
    .select('id, number, issued_at, status, location_id, consignment_location(name, b2b_customer(flowaccount_name))')
    .eq('id', noteId).maybeSingle()

  if (!note) {
    return (
      <div className="p-8">
        <p className="text-graphite">Delivery note not found.</p>
        <Link href={`/m/customers/${customerId}?tab=deliveries`} className="text-wine-red">← Back</Link>
      </div>
    )
  }

  const { data: lines } = await sbInventory
    .from('delivery_note_line')
    .select('id, qty, unit_price, sku(name, loyverse_product_code, category)')
    .eq('note_id', noteId)
    .order('id')

  const rows = (lines ?? []) as any[]
  const totalQty = rows.reduce((s, l) => s + Number(l.qty || 0), 0)
  const total    = rows.reduce((s, l) => s + Number(l.qty || 0) * Number(l.unit_price || 0), 0)
  const customerName = (note as any).consignment_location?.b2b_customer?.flowaccount_name
                    ?? (note as any).consignment_location?.name
                    ?? 'Customer'

  return (
    <div className="bg-warm-white min-h-screen">
      {/* Toolbar — hidden on print */}
      <div className="print:hidden border-b border-pale-stone px-6 py-3 flex items-center justify-between">
        <Link href={`/m/customers/${customerId}?tab=deliveries`} className="text-xs text-graphite hover:text-wine-red">
          ← Back to deliveries
        </Link>
        <PrintButton />
      </div>

      <article className="dn-page mx-auto bg-warm-white text-deep-black">
        <header className="flex items-end justify-between border-b-2 border-deep-black pb-6 mb-8">
          <div>
            <div className="flex items-baseline gap-1.5 mb-2">
              <span className="font-display text-4xl tracking-display text-wine-red leading-none">WINE</span>
              <span className="text-xs text-graphite">store</span>
              <span className="font-display text-4xl tracking-display text-deep-black leading-none ml-1">&amp; WHISKEY</span>
            </div>
            <div className="text-xs text-graphite leading-tight">
              Phuket, Thailand<br/>
              Open daily 10:00 am – 10:00 pm
            </div>
          </div>
          <div className="text-right">
            <div className="font-display text-2xl tracking-display text-deep-black">DELIVERY NOTE</div>
            <div className="font-mono text-sm text-graphite mt-1">{note.number}</div>
            <div className="text-xs text-graphite mt-2">Issued: {note.issued_at}</div>
            <div className="text-[10px] text-graphite italic mt-2 max-w-[220px]">
              Not a tax invoice. For consignment movement record.
            </div>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-8 mb-8">
          <div>
            <div className="overline text-graphite mb-1">From</div>
            <div className="font-heading text-base text-deep-black">Wine &amp; Whiskey Store</div>
            <div className="text-xs text-graphite mt-1">Phuket, Thailand</div>
          </div>
          <div>
            <div className="overline text-graphite mb-1">To (consignment)</div>
            <div className="font-heading text-base text-deep-black">{customerName}</div>
          </div>
        </section>

        <table className="w-full text-[12px] mb-8">
          <thead className="text-graphite border-b border-deep-black">
            <tr>
              <th className="text-left  py-2 pr-3 w-[12%]">Code</th>
              <th className="text-left  py-2 pr-3">Item</th>
              <th className="text-left  py-2 pr-3 w-[15%]">Category</th>
              <th className="text-right py-2 pr-3 w-[10%]">Qty</th>
              <th className="text-right py-2 pr-3 w-[12%]">Unit ฿</th>
              <th className="text-right py-2 pr-0 w-[14%]">Line ฿</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l, i) => {
              const lt = Number(l.qty || 0) * Number(l.unit_price || 0)
              return (
                <tr key={i} className="border-b border-pale-stone/60">
                  <td className="py-2 pr-3 font-mono text-graphite">{l.sku?.loyverse_product_code ?? '—'}</td>
                  <td className="py-2 pr-3">{l.sku?.name ?? '—'}</td>
                  <td className="py-2 pr-3 text-graphite">{l.sku?.category ?? '—'}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{Number(l.qty).toLocaleString('en-US')}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{l.unit_price ? `฿${Number(l.unit_price).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}</td>
                  <td className="py-2 pr-0 text-right tabular-nums">{lt > 0 ? `฿${lt.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-deep-black">
              <td colSpan={3} className="py-3 pr-3 text-graphite">{rows.length} item(s)</td>
              <td className="py-3 pr-3 text-right tabular-nums font-medium">{totalQty}</td>
              <td />
              <td className="py-3 pr-0 text-right tabular-nums font-heading text-base">
                {total ? `฿${total.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}
              </td>
            </tr>
          </tfoot>
        </table>

        <section className="grid grid-cols-2 gap-12 mt-16">
          <div>
            <div className="border-t border-deep-black pt-2 text-xs text-graphite">
              <span className="overline">Released by</span><br/>Wine &amp; Whiskey
            </div>
          </div>
          <div>
            <div className="border-t border-deep-black pt-2 text-xs text-graphite">
              <span className="overline">Received by</span><br/>{customerName}
            </div>
          </div>
        </section>

        <footer className="mt-16 text-[10px] text-graphite text-center border-t border-pale-stone pt-3">
          This document records the physical movement of goods on consignment.
          Title remains with Wine &amp; Whiskey until invoiced.
        </footer>
      </article>

      <style>{`
        .dn-page { padding: 24mm 18mm; max-width: 210mm; }
        @page { size: A4 portrait; margin: 0; }
        @media print {
          body { background: white !important; }
          .dn-page { padding: 18mm 14mm; }
        }
      `}</style>
    </div>
  )
}
