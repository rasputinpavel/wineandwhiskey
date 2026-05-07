import Link from 'next/link'
import { sbInventory } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'

export const dynamic = 'force-dynamic'

export default async function SkuDetail({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params

  const { data: sku, error: skuErr } = await sbInventory
    .from('sku').select('*')
    .eq('loyverse_product_code', code)
    .maybeSingle()

  if (skuErr) return <SchemaError error={skuErr.message} />
  if (!sku) {
    return (
      <div>
        <Link href="/m/inventory" className="text-xs text-graphite hover:text-wine-red">← Back</Link>
        <div className="mt-4 text-graphite">SKU <code className="font-mono">{code}</code> not found.</div>
      </div>
    )
  }

  const { data: breakdown } = await sbInventory
    .from('v_sku_breakdown').select('*')
    .eq('sku_id', sku.id).maybeSingle()

  const { data: transit } = await sbInventory
    .from('v_b2b_in_transit')
    .select('invoice_number, customer_name, issued_at, due_at, status, qty')
    .eq('sku_id', sku.id)
    .order('issued_at', { ascending: false })

  return (
    <>
      <Link href="/m/inventory" className="text-xs text-graphite hover:text-wine-red">← Back to breakdown</Link>
      <div className="text-graphite text-xs mt-4 mb-1 font-mono">SKU · {sku.loyverse_product_code}</div>
      <h2 className="font-heading text-2xl text-deep-black mb-6">{sku.name}</h2>

      {breakdown && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <Stat label="On hand"        value={breakdown.on_hand} />
          <Stat label="In store"       value={breakdown.in_store} />
          <Stat label="B2B in transit" value={breakdown.b2b_in_transit} accent />
          <Stat label="Consignment"    value={breakdown.on_consignment} />
        </div>
      )}

      <h3 className="font-heading text-base text-deep-black mb-3">B2B in transit (unpaid invoices)</h3>
      {!transit || transit.length === 0 ? (
        <div className="text-graphite text-sm">Nothing in transit.</div>
      ) : (
        <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="text-graphite border-b border-pale-stone bg-cream/40">
              <tr>
                <th className="text-left  py-2 px-4">Invoice</th>
                <th className="text-left  py-2 px-4">Customer</th>
                <th className="text-left  py-2 px-4">Issued</th>
                <th className="text-left  py-2 px-4">Due</th>
                <th className="text-left  py-2 px-4">Status</th>
                <th className="text-right py-2 px-4">Qty</th>
              </tr>
            </thead>
            <tbody>
              {transit.map((r: any, i: number) => (
                <tr key={i} className="border-b border-pale-stone/40 last:border-0">
                  <td className="py-2 px-4 font-mono">{r.invoice_number}</td>
                  <td className="py-2 px-4">{r.customer_name}</td>
                  <td className="py-2 px-4">{r.issued_at}</td>
                  <td className="py-2 px-4">{r.due_at ?? '—'}</td>
                  <td className="py-2 px-4">{r.status}</td>
                  <td className="py-2 px-4 text-right tabular-nums">{r.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="bg-warm-white border border-pale-stone rounded-md p-4">
      <div className="overline text-graphite mb-2">{label}</div>
      <div className={`font-display text-3xl tracking-display leading-none ${accent ? 'text-wine-red' : 'text-deep-black'}`}>
        {Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 })}
      </div>
    </div>
  )
}
