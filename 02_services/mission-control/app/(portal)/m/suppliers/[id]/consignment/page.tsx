import Link from 'next/link'
import { sbInventory, type Supplier, type ConsignmentPrice, type Sku } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { PriceCell, DeletePriceCell, NewPriceRow } from '@/components/modules/suppliers/ConsignmentPriceCells'
import { consignmentLineCost } from '@/lib/consignment-math'

export const dynamic = 'force-dynamic'

export default async function SupplierConsignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [supRes, pricesRes] = await Promise.all([
    sbInventory.from('supplier').select('id, name, type, payment_terms_days, settlement_mode, consignment_discount_pct').eq('id', id).maybeSingle(),
    sbInventory.from('consignment_price').select('id, supplier_id, sku_id, price_hc, price_retail, discount_pct, notes, created_at, updated_at').eq('supplier_id', id).limit(2000),
  ])
  if (supRes.error) return <SchemaError error={supRes.error.message} />
  if (!supRes.data)   return <div className="text-graphite">Supplier not found.</div>
  if (pricesRes.error) return <SchemaError error={pricesRes.error.message} />

  const s = supRes.data as Supplier
  const prices = (pricesRes.data ?? []) as ConsignmentPrice[]
  const retailMinus = s.settlement_mode === 'retail_minus'
  const supplierDisc = Number(s.consignment_discount_pct ?? 0)

  const skuIds = [...new Set(prices.map(p => p.sku_id))]
  const skusRes = skuIds.length
    ? await sbInventory.from('sku').select('id, loyverse_product_code, name, category').in('id', skuIds)
    : { data: [] as Sku[], error: null }
  if (skusRes.error)   return <SchemaError error={skusRes.error.message} />

  const skus   = (skusRes.data ?? []) as Sku[]
  const skuById = new Map(skus.map(k => [k.id, k]))

  const enriched = prices.map(p => {
    const sku = skuById.get(p.sku_id)
    const disc = p.discount_pct ?? supplierDisc
    const listPrice = p.price_retail != null ? Number(p.price_retail) : null
    const payable = retailMinus
      ? (() => { const u = consignmentLineCost({ mode: 'retail_minus', basePrice: listPrice, discountPct: disc }); return u == null ? null : u * 1.07 })()
      : null
    return {
      ...p,
      sku_name:     sku?.name ?? '(unknown SKU)',
      sku_code:     sku?.loyverse_product_code ?? null,
      sku_category: sku?.category ?? null,
      payable,
    }
  }).sort((a, b) => a.sku_name.localeCompare(b.sku_name))

  return (
    <>
      <div className="mb-4">
        <Link href={`/m/suppliers/${id}`} className="text-xs text-graphite hover:text-wine-red">← Back to {s.name}</Link>
        <h2 className="font-heading text-2xl text-deep-black mt-3">{s.name} · Consignment prices</h2>
        {retailMinus ? (
          <p className="text-graphite text-sm mt-1 max-w-3xl">
            Per-SKU list price — the VAT-inclusive shelf price the customer pays. We settle each sold
            unit at list × (1 − {supplierDisc}%) + 7% VAT. <strong>Payable/unit</strong> is that
            amount (matches the supplier&apos;s delivery note). Edit list prices inline; ✕ removes a SKU.
          </p>
        ) : (
          <p className="text-graphite text-sm mt-1 max-w-3xl">
            Per-SKU prices the supplier charges us on consignment. Used by Finance Pulse to compute the
            running monthly debt: sum of sold units (Loyverse receipts in the SKU&apos;s category) × HC
            price + 7% VAT. Edit values inline; click ✕ to remove a SKU from the list.
          </p>
        )}
      </div>

      <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="text-graphite border-b border-pale-stone bg-cream/40">
            <tr>
              <th className="py-2 px-4 text-left font-normal">SKU</th>
              <th className="py-2 px-4 text-left font-normal">Code</th>
              <th className="py-2 px-4 text-left font-normal">Category</th>
              {retailMinus ? (
                <>
                  <th className="py-2 px-4 text-right font-normal">List price (฿)</th>
                  <th className="py-2 px-4 text-right font-normal">Payable/unit (฿)</th>
                </>
              ) : (
                <>
                  <th className="py-2 px-4 text-right font-normal">HC price (฿)</th>
                  <th className="py-2 px-4 text-right font-normal">Retail (฿)</th>
                </>
              )}
              <th className="py-2 px-4 text-right font-normal w-12"></th>
            </tr>
          </thead>
          <tbody>
            {enriched.map(p => (
              <tr key={p.id} className="border-b border-pale-stone/40 last:border-0 hover:bg-cream/40">
                <td className="py-2 px-4 truncate max-w-[20rem]" title={p.sku_name}>{p.sku_name}</td>
                <td className="py-2 px-4 font-mono text-xs text-graphite">{p.sku_code ?? '—'}</td>
                <td className="py-2 px-4 text-graphite text-xs">{p.sku_category ?? '—'}</td>
                {retailMinus ? (
                  <>
                    <td className="py-2 px-4 text-right">
                      <PriceCell id={p.id} initial={p.price_retail != null ? Number(p.price_retail) : null} field="price_retail" />
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums text-graphite">
                      {p.payable == null ? '—' : `฿${p.payable.toLocaleString('en-US', { maximumFractionDigits: 2 })}`}
                    </td>
                  </>
                ) : (
                  <>
                    <td className="py-2 px-4 text-right"><PriceCell id={p.id} initial={p.price_hc != null ? Number(p.price_hc) : null} field="price_hc" /></td>
                    <td className="py-2 px-4 text-right">
                      <PriceCell id={p.id} initial={p.price_retail != null ? Number(p.price_retail) : null} field="price_retail" />
                    </td>
                  </>
                )}
                <td className="py-2 px-4 text-right"><DeletePriceCell id={p.id} name={p.sku_name} /></td>
              </tr>
            ))}
            {enriched.length === 0 && (
              <tr><td colSpan={6} className="py-6 text-center text-graphite text-sm">
                No prices yet. Add the first one below.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <NewPriceRow supplierId={id} retailMinus={retailMinus} discountPct={supplierDisc} />
    </>
  )
}
