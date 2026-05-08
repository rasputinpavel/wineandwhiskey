import Link from 'next/link'
import { sbInventory, type B2bCustomer } from '@/lib/supabase'
import { PaneHeader } from '@/components/shell/PaneHeader'
import { findItem } from '@/lib/registry'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { DeliveryNoteForm } from '@/components/modules/customers/DeliveryNoteForm'

export const dynamic = 'force-dynamic'

export default async function NewDeliveryNote({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const item = findItem('customers')!

  const { data: cust, error: custErr } = await sbInventory
    .from('b2b_customer')
    .select('id, flowaccount_name, is_consignment')
    .eq('id', id).maybeSingle()
  if (custErr) return <><PaneHeader item={item} /><div className="p-6"><SchemaError error={custErr.message} /></div></>
  if (!cust)   return <><PaneHeader item={item} /><div className="p-6"><div className="text-graphite">Customer not found.</div></div></>
  const c = cust as B2bCustomer
  if (!c.is_consignment) {
    return (
      <>
        <PaneHeader item={item} />
        <div className="max-w-[800px] mx-auto px-6 py-6">
          <Link href={`/m/customers/${id}`} className="text-xs text-graphite hover:text-wine-red">← Back</Link>
          <div className="mt-4 text-graphite">Этот клиент не consignment — переключи Type на странице клиентов.</div>
        </div>
      </>
    )
  }

  // Suggest the next DN number for the current year (UI hint; server is the
  // source of truth and will re-compute if user leaves the field as-is).
  const year = new Date().getFullYear()
  const { data: existing } = await sbInventory
    .from('delivery_note')
    .select('number')
    .like('number', `DN-${year}-%`)
  const max = (existing ?? []).reduce((m, r: any) => {
    const n = Number((r.number as string).split('-').pop())
    return Number.isFinite(n) && n > m ? n : m
  }, 0)
  const suggested = `DN-${year}-${String(max + 1).padStart(3, '0')}`

  return (
    <>
      <PaneHeader item={item} />
      <div className="flex-1 overflow-y-auto bg-cream">
        <div className="max-w-[1080px] mx-auto px-6 py-6">
          <Link href={`/m/customers/${id}?tab=deliveries`} className="text-xs text-graphite hover:text-wine-red">
            ← Back to {c.flowaccount_name}
          </Link>
          <h2 className="font-heading text-2xl text-deep-black mt-3 mb-1">New delivery note</h2>
          <p className="text-graphite text-sm mb-6">Outbound to {c.flowaccount_name} (consignment)</p>

          <DeliveryNoteForm customerId={id} suggestedNumber={suggested} />
        </div>
      </div>
    </>
  )
}
