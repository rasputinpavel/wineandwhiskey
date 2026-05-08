import Link from 'next/link'
import { sbInventory } from '@/lib/supabase'
import { PrintButton } from '@/components/modules/customers/PrintButton'

export const dynamic = 'force-dynamic'

// Print-only delivery note — top-level route on purpose. Living outside
// the (portal) layout means: (a) the page can scroll vertically (parent
// is no longer h-screen overflow-hidden), and (b) browser Print sees
// only this document — the sidebar and module nav are simply not in the
// rendered tree, so no @media-print hiding gymnastics needed.

export default async function PrintDeliveryNote({ params }: { params: Promise<{ noteId: string }> }) {
  const { noteId } = await params

  const { data: note } = await sbInventory
    .from('delivery_note')
    .select('id, number, issued_at, status, location_id, consignment_location(name, customer_id, b2b_customer(flowaccount_name))')
    .eq('id', noteId).maybeSingle()

  if (!note) {
    return (
      <div className="p-8">
        <p className="text-graphite">Delivery note not found.</p>
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
  const customerId   = (note as any).consignment_location?.customer_id
  const customerName = (note as any).consignment_location?.b2b_customer?.flowaccount_name
                    ?? (note as any).consignment_location?.name
                    ?? 'Customer'
  const backHref = customerId ? `/m/customers/${customerId}?tab=deliveries` : '/m/customers'

  return (
    <div className="bg-warm-white text-deep-black">
      {/* Toolbar — hidden on print via Tailwind's print: variant */}
      <div className="print:hidden border-b border-pale-stone px-6 py-3 flex items-center justify-between sticky top-0 bg-warm-white z-10">
        <Link href={backHref} className="text-xs text-graphite hover:text-wine-red">
          ← Back to deliveries
        </Link>
        <PrintButton />
      </div>

      <article className="dn-page mx-auto bg-warm-white">
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

        {/* Signatures — fillable lines for both parties */}
        <section className="grid grid-cols-2 gap-12 mt-20 mb-12 sig">
          <div>
            <div className="overline text-graphite mb-3">Released by · Wine &amp; Whiskey</div>
            <div className="space-y-5">
              <SignatureRow label="Name" />
              <SignatureRow label="Position" />
              <SignatureRow label="Signature" />
              <SignatureRow label="Date" />
            </div>
          </div>
          <div>
            <div className="overline text-graphite mb-3">Received by · {customerName}</div>
            <div className="space-y-5">
              <SignatureRow label="Name" />
              <SignatureRow label="Position" />
              <SignatureRow label="Signature" />
              <SignatureRow label="Date" />
            </div>
          </div>
        </section>

        <footer className="mt-10 text-[10px] text-graphite text-center border-t border-pale-stone pt-3">
          This document records the physical movement of goods on consignment.
          Title remains with Wine &amp; Whiskey until invoiced.
        </footer>
      </article>

      <style>{`
        .dn-page { padding: 24mm 18mm; max-width: 210mm; }
        .sig .row { display: grid; grid-template-columns: 80px 1fr; align-items: end; gap: 12px; }
        .sig .row .line { border-bottom: 1px solid #1A1A1A; height: 22px; }
        @page { size: A4 portrait; margin: 0; }
        @media print {
          html, body { background: white !important; margin: 0 !important; }
          .dn-page { padding: 16mm 14mm; max-width: 100%; }
        }
      `}</style>
    </div>
  )
}

function SignatureRow({ label }: { label: string }) {
  return (
    <div className="row">
      <div className="text-xs text-graphite">{label}:</div>
      <div className="line" />
    </div>
  )
}
