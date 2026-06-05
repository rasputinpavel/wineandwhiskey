import Link from 'next/link'
import { sbInventory, type Supplier } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { cyclePeriodRange } from '@/lib/billing-cycle'

export const dynamic = 'force-dynamic'

type SearchParams = { period?: string; sku_id?: string; channel?: 'b2c' | 'b2b' }

const THB = (n: number) => '฿' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })

export default async function SupplierReportSalesPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<SearchParams>
}) {
  const { id } = await params
  const sp = await searchParams
  if (!sp.period || !/^\d{4}-\d{2}$/.test(sp.period)) return <div className="text-graphite">period (YYYY-MM) required</div>
  if (!sp.sku_id) return <div className="text-graphite">sku_id required</div>
  if (sp.channel !== 'b2c' && sp.channel !== 'b2b') return <div className="text-graphite">channel must be b2c or b2b</div>

  const period = sp.period
  const channel = sp.channel

  const [supRes, skuRes] = await Promise.all([
    sbInventory.from('supplier').select('id, name, monthly_cycle_start_day').eq('id', id).maybeSingle(),
    sbInventory.from('sku').select('id, name, loyverse_product_code').eq('id', sp.sku_id).maybeSingle(),
  ])
  if (supRes.error) return <SchemaError error={supRes.error.message} />
  if (skuRes.error) return <SchemaError error={skuRes.error.message} />
  if (!supRes.data) return <div className="text-graphite">Supplier not found.</div>
  if (!skuRes.data) return <div className="text-graphite">SKU not found.</div>
  const s = supRes.data as Supplier
  const cycleStartDay = Number((supRes.data as { monthly_cycle_start_day?: number }).monthly_cycle_start_day ?? 1)
  const { startIso, endExclIso, label } = cyclePeriodRange(period, cycleStartDay)
  const sku = skuRes.data as { id: string; name: string; loyverse_product_code: string | null }
  if (!sku.loyverse_product_code) return <div className="text-graphite">SKU has no Loyverse product code — receipt lines can&apos;t be matched.</div>

  // Pull all receipts in period for this channel, then filter lines by SKU code.
  const all: any[] = []
  for (let from = 0; from < 100000; from += 1000) {
    const { data, error } = await sbInventory
      .from('loyverse_receipt')
      .select('id, receipt_number, receipt_type, receipt_date, total, customer_name, is_b2b, loyverse_receipt_line(sku, qty, price, line_total)')
      .gte('receipt_date', startIso)
      .lt('receipt_date', endExclIso)
      .eq('is_b2b', channel === 'b2b')
      .order('receipt_date', { ascending: false })
      .range(from, from + 999)
    if (error) return <SchemaError error={error.message} />
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < 1000) break
  }

  type Hit = { receiptId: string; receiptNumber: string; date: string; type: string; customer: string | null; qty: number; price: number; lineTotal: number }
  const hits: Hit[] = []
  for (const r of all) {
    for (const ln of (r.loyverse_receipt_line ?? []) as Array<{ sku: string | null; qty: number | null; price: number | null; line_total: number | null }>) {
      if (ln.sku !== sku.loyverse_product_code) continue
      const sign = r.receipt_type === 'REFUND' ? -1 : 1
      hits.push({
        receiptId: r.id,
        receiptNumber: r.receipt_number,
        date: r.receipt_date,
        type: r.receipt_type,
        customer: r.customer_name,
        qty: Number(ln.qty ?? 0) * sign,
        price: Number(ln.price ?? 0),
        lineTotal: Number(ln.line_total ?? 0) * sign,
      })
    }
  }
  const totalQty = hits.reduce((s, h) => s + h.qty, 0)
  const totalAmount = hits.reduce((s, h) => s + h.lineTotal, 0)

  return (
    <>
      <div className="mb-4">
        <Link href={`/m/suppliers/${id}/report?period=${period}`} className="text-xs text-graphite hover:text-wine-red">← Back to {s.name} report</Link>
        <h2 className="font-heading text-2xl text-deep-black mt-3">
          {sku.name}
          <span className="text-graphite text-sm ml-2 font-normal">{sku.loyverse_product_code}</span>
        </h2>
        <p className="text-graphite text-sm mt-1">
          {channel.toUpperCase()} sales · {label} · {hits.length} receipts · <span className="text-deep-black">{totalQty} units · {THB(totalAmount)}</span>
        </p>
      </div>

      <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="text-graphite border-b border-pale-stone bg-cream/40">
            <tr>
              <th className="py-2 px-3 text-left font-normal">Date</th>
              <th className="py-2 px-3 text-left font-normal">Receipt</th>
              {channel === 'b2b' && <th className="py-2 px-3 text-left font-normal">Customer</th>}
              <th className="py-2 px-3 text-right font-normal">Qty</th>
              <th className="py-2 px-3 text-right font-normal">Unit price</th>
              <th className="py-2 px-3 text-right font-normal">Line total</th>
            </tr>
          </thead>
          <tbody>
            {hits.length === 0 && (
              <tr><td colSpan={channel === 'b2b' ? 6 : 5} className="py-6 text-center text-graphite text-sm">No sales in this period.</td></tr>
            )}
            {hits.map((h, i) => (
              <tr key={`${h.receiptId}-${i}`} className="border-b border-pale-stone/40 last:border-0 hover:bg-cream/40">
                <td className="py-2 px-3 font-mono text-xs">{h.date.slice(0, 10)}</td>
                <td className="py-2 px-3 text-xs">
                  {h.receiptNumber}
                  {h.type === 'REFUND' && <span className="ml-2 text-[10px] text-wine-red uppercase">refund</span>}
                </td>
                {channel === 'b2b' && <td className="py-2 px-3 text-xs">{h.customer ?? <span className="text-graphite/50">—</span>}</td>}
                <td className="py-2 px-3 text-right tabular-nums">{h.qty}</td>
                <td className="py-2 px-3 text-right tabular-nums">{THB(h.price)}</td>
                <td className="py-2 px-3 text-right tabular-nums">{THB(h.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
