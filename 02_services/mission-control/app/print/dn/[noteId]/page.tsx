import Link from 'next/link'
import { sbInventory } from '@/lib/supabase'
import { PrintButton } from '@/components/modules/customers/PrintButton'
import { fmtDate } from '@/lib/fmt'

export const dynamic = 'force-dynamic'

// Print-only delivery note. Top-level route, NOT inside the (portal)
// shell — so the page can scroll and browser Print sees only the doc.

export default async function PrintDeliveryNote({ params }: { params: Promise<{ noteId: string }> }) {
  const { noteId } = await params

  const { data: note } = await sbInventory
    .from('delivery_note')
    .select('id, number, issued_at, status, location_id, consignment_location(name, customer_id, b2b_customer(flowaccount_name))')
    .eq('id', noteId).maybeSingle()

  if (!note) {
    return <div className="p-8"><p className="text-graphite">Delivery note not found.</p></div>
  }

  const { data: lines } = await sbInventory
    .from('delivery_note_line')
    .select('id, qty, unit_price, sku(name, loyverse_product_code, category)')
    .eq('note_id', noteId)
    .order('id')

  const rows = (lines ?? []) as any[]
  const totalQty = rows.reduce((s, l) => s + Number(l.qty || 0), 0)
  const total    = rows.reduce((s, l) => s + Number(l.qty || 0) * Number(l.unit_price || 0), 0)
  const customerId   = (note as any).consignment_location?.customer_id
  const customerName = (note as any).consignment_location?.b2b_customer?.flowaccount_name
                    ?? (note as any).consignment_location?.name
                    ?? 'Customer'
  const backHref = customerId ? `/m/customers/${customerId}?tab=deliveries` : '/m/customers'

  return (
    <div className="bg-warm-white text-deep-black">
      {/* Toolbar — hidden on print */}
      <div className="print:hidden border-b border-pale-stone px-6 py-3 flex items-center justify-between sticky top-0 bg-warm-white z-10">
        <Link href={backHref} className="text-xs text-graphite hover:text-wine-red">← Back to deliveries</Link>
        <PrintButton />
      </div>

      <article className="dn-page mx-auto bg-warm-white">
        {/* Brand + meta */}
        <header className="flex items-start justify-between pb-5 mb-7 border-b border-deep-black">
          <div>
            <div className="flex items-baseline gap-2 leading-none">
              <span className="font-display text-[36px] tracking-display text-wine-red">WINE</span>
              <span className="font-display text-[36px] tracking-display text-deep-black">&amp; WHISKEY</span>
            </div>
            <div className="text-[10px] text-graphite mt-2 leading-snug">
              Phuket, Thailand · Open daily 11:00 – 22:00
            </div>
          </div>
          <div className="text-right leading-tight">
            <div className="font-display text-[24px] tracking-display text-deep-black">DELIVERY NOTE</div>
            <div className="font-mono text-[13px] text-deep-black mt-1">{note.number}</div>
            <div className="text-[11px] text-graphite mt-1">Issued {fmtDate(note.issued_at)}</div>
          </div>
        </header>

        {/* Parties */}
        <section className="grid grid-cols-2 gap-10 mb-7">
          <div>
            <div className="overline text-graphite mb-1">From</div>
            <div className="font-heading text-[15px]">Wine &amp; Whiskey</div>
            <div className="text-[11px] text-graphite mt-0.5">Phuket, Thailand</div>
          </div>
          <div>
            <div className="overline text-graphite mb-1">To · consignment</div>
            <div className="font-heading text-[15px]">{customerName}</div>
          </div>
        </section>

        {/* Lines */}
        <table className="w-full text-[12px] mb-6">
          <thead className="text-graphite">
            <tr className="border-b border-deep-black">
              <th className="text-left  py-1.5 pr-3 w-[14%] font-medium">Code</th>
              <th className="text-left  py-1.5 pr-3 font-medium">Item</th>
              <th className="text-left  py-1.5 pr-3 w-[16%] font-medium">Category</th>
              <th className="text-right py-1.5 pr-3 w-[8%] font-medium">Qty</th>
              <th className="text-right py-1.5 pr-3 w-[12%] font-medium">Unit ฿</th>
              <th className="text-right py-1.5 pr-0 w-[14%] font-medium">Line ฿</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l, i) => {
              const lt = Number(l.qty || 0) * Number(l.unit_price || 0)
              return (
                <tr key={i} className="border-b border-pale-stone/60">
                  <td className="py-1.5 pr-3 font-mono text-graphite text-[11px]">{l.sku?.loyverse_product_code ?? '—'}</td>
                  <td className="py-1.5 pr-3">{l.sku?.name ?? '—'}</td>
                  <td className="py-1.5 pr-3 text-graphite">{l.sku?.category ?? '—'}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{Number(l.qty).toLocaleString('en-US')}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{l.unit_price ? `฿${Number(l.unit_price).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}</td>
                  <td className="py-1.5 pr-0 text-right tabular-nums">{lt > 0 ? `฿${lt.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-deep-black">
              <td colSpan={3} className="py-2 pr-3 text-graphite text-[11px]">{rows.length} item(s)</td>
              <td className="py-2 pr-3 text-right tabular-nums font-medium">{totalQty}</td>
              <td />
              <td className="py-2 pr-0 text-right tabular-nums font-heading">
                {total ? `฿${total.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}
              </td>
            </tr>
          </tfoot>
        </table>

        {/* Compact signature block — one line per side */}
        <section className="grid grid-cols-2 gap-12 mt-16 mb-8 sig">
          <div>
            <div className="line" />
            <div className="text-[11px] text-graphite mt-1.5">
              Released by · Wine &amp; Whiskey
            </div>
          </div>
          <div>
            <div className="line" />
            <div className="text-[11px] text-graphite mt-1.5">
              Received by · {customerName}
            </div>
          </div>
        </section>

        <footer className="mt-8 text-[10px] text-graphite text-center border-t border-pale-stone pt-3">
          Not a tax invoice. This document records physical movement of goods on consignment.
          Title remains with Wine &amp; Whiskey until invoiced.
        </footer>
      </article>

      <style>{`
        .dn-page { padding: 22mm 18mm; max-width: 210mm; }
        .sig .line { border-bottom: 1px solid #1A1A1A; height: 28px; }
        @page { size: A4 portrait; margin: 0; }
        @media print {
          html, body { background: white !important; margin: 0 !important; }
          .dn-page { padding: 14mm 14mm; max-width: 100%; }
        }
      `}</style>
    </div>
  )
}
