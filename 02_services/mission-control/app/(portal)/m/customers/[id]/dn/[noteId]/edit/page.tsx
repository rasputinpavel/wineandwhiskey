import Link from 'next/link'
import { sbInventory, type B2bCustomer } from '@/lib/supabase'
import { PaneHeader } from '@/components/shell/PaneHeader'
import { findItem } from '@/lib/registry'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { DeliveryNoteForm, type Line } from '@/components/modules/customers/DeliveryNoteForm'

export const dynamic = 'force-dynamic'

export default async function EditDeliveryNote({ params }: { params: Promise<{ id: string; noteId: string }> }) {
  const { id, noteId } = await params
  const item = findItem('customers')!

  const { data: cust, error: custErr } = await sbInventory
    .from('b2b_customer')
    .select('id, flowaccount_name, is_consignment')
    .eq('id', id).maybeSingle()
  if (custErr) return <><PaneHeader item={item} /><div className="p-6"><SchemaError error={custErr.message} /></div></>
  if (!cust)   return <><PaneHeader item={item} /><div className="p-6"><div className="text-graphite">Customer not found.</div></div></>
  const c = cust as B2bCustomer

  const { data: note, error: noteErr } = await sbInventory
    .from('delivery_note')
    .select('id, number, issued_at, with_vat')
    .eq('id', noteId).maybeSingle()
  if (noteErr) return <><PaneHeader item={item} /><div className="p-6"><SchemaError error={noteErr.message} /></div></>
  if (!note)   return <><PaneHeader item={item} /><div className="p-6"><div className="text-graphite">Delivery note not found.</div></div></>
  const n = note as { id: string; number: string; issued_at: string; with_vat: boolean | null }

  const { data: lineRows, error: lineErr } = await sbInventory
    .from('delivery_note_line')
    .select('id, sku_id, qty, unit_price, sku(name)')
    .eq('note_id', noteId)
    .order('id')
  if (lineErr) return <><PaneHeader item={item} /><div className="p-6"><SchemaError error={lineErr.message} /></div></>

  const lines: Line[] = ((lineRows ?? []) as any[]).map((l, i) => ({
    key: i + 1,
    sku_id: l.sku_id,
    sku_name: l.sku?.name ?? '',
    qty: String(l.qty ?? ''),
    unit_price: l.unit_price === null || l.unit_price === undefined ? '' : String(l.unit_price),
  }))

  const initial = {
    number: n.number,
    issuedAt: n.issued_at,
    withVat: n.with_vat !== false,
    lines,
  }

  return (
    <>
      <PaneHeader item={item} />
      <div className="flex-1 overflow-y-auto bg-cream">
        <div className="max-w-[1080px] mx-auto px-6 py-6">
          <Link href={`/m/customers/${id}?tab=deliveries`} className="text-xs text-graphite hover:text-wine-red">
            ← Back to {c.flowaccount_name}
          </Link>
          <h2 className="font-heading text-2xl text-deep-black mt-3 mb-1">Edit {n.number}</h2>
          <p className="text-graphite text-sm mb-6">Outbound to {c.flowaccount_name} (consignment)</p>

          <DeliveryNoteForm customerId={id} noteId={noteId} initial={initial} />
        </div>
      </div>
    </>
  )
}
