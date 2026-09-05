import { Fragment } from 'react'
import Link from 'next/link'
import { sbInventory, type Supplier } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { NewBuyoutForm, DeleteBuyoutCell, DeleteBuyoutGroupCell } from '@/components/modules/suppliers/ConsignmentBuyoutCells'

export const dynamic = 'force-dynamic'

type BuyoutRow = {
  id: string
  bought_at: string
  qty: number
  unit_price: number | null
  invoice_no: string | null
  sku: { name: string; loyverse_product_code: string | null } | null
}

type BuyoutGroup = {
  key: string
  bought_at: string
  invoice_no: string | null
  lines: BuyoutRow[]
  units: number
  subtotal: number
}

// Like deliveries, a buyout has no header row — it is the set of lines sharing
// the same date and invoice number. Group on that pair so one invoice reads as
// one document, the way it was entered.
function groupBuyouts(rows: BuyoutRow[]): BuyoutGroup[] {
  const groups = new Map<string, BuyoutGroup>()
  for (const r of rows) {
    const key = `${r.bought_at} ${r.invoice_no ?? ''}`
    let g = groups.get(key)
    if (!g) {
      g = { key, bought_at: r.bought_at, invoice_no: r.invoice_no, lines: [], units: 0, subtotal: 0 }
      groups.set(key, g)
    }
    g.lines.push(r)
    g.units += Number(r.qty)
    g.subtotal += Number(r.qty) * Number(r.unit_price ?? 0)
  }
  return [...groups.values()]
}

const money = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })

export default async function SupplierBuyoutsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [supRes, buyRes] = await Promise.all([
    sbInventory.from('supplier').select('id, name, type').eq('id', id).maybeSingle(),
    sbInventory
      .from('consignment_buyout')
      .select('id, bought_at, qty, unit_price, invoice_no, sku:sku(name, loyverse_product_code)')
      .eq('supplier_id', id)
      .order('bought_at', { ascending: false })
      .limit(2000),
  ])
  if (supRes.error) return <SchemaError error={supRes.error.message} />
  if (!supRes.data) return <div className="text-graphite">Supplier not found.</div>

  const s = supRes.data as Supplier
  const tableMissing = !!buyRes.error
  const rows = (buyRes.data ?? []) as unknown as BuyoutRow[]
  const groups = groupBuyouts(rows)
  const totalUnits = rows.reduce((sum, r) => sum + Number(r.qty), 0)
  const totalValue = rows.reduce((sum, r) => sum + Number(r.qty) * Number(r.unit_price ?? 0), 0)

  return (
    <>
      <div className="mb-4">
        <Link href={`/m/suppliers/${id}`} className="text-xs text-graphite hover:text-wine-red">&larr; Back to {s.name}</Link>
        <h2 className="font-heading text-2xl text-deep-black mt-3">{s.name} &middot; Buyouts</h2>
        <p className="text-graphite text-sm mt-1 max-w-3xl">
          Units bought <strong>out</strong> of consignment onto our own books, on a separate supplier
          invoice. One buyout = one invoice date plus its number; prices are the <strong>pre-VAT</strong>
          {' '}unit prices printed on that invoice, which are normally below the consignment HC.
          From the invoice date those bottles are ours: they leave the Monthly Report&apos;s closing
          consignment stock, and selling them is <strong>not</strong> billed to {s.name} again &mdash;
          sales of a bought-out SKU draw from our own units first. The Monthly Report shows what is
          left of each buyout and where it sits.
        </p>
      </div>

      {tableMissing && (
        <p className="mb-3 text-[12px] text-wine-red">
          Buyout table missing &mdash; apply migration 042_consignment_buyout.sql in Supabase.
        </p>
      )}

      <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="text-graphite border-b border-pale-stone bg-cream/40">
            <tr>
              <th className="py-2 px-4 text-left font-normal">SKU</th>
              <th className="py-2 px-4 text-left font-normal">Code</th>
              <th className="py-2 px-4 text-right font-normal">Qty</th>
              <th className="py-2 px-4 text-right font-normal">฿ / unit</th>
              <th className="py-2 px-4 text-right font-normal">Value ฿</th>
              <th className="py-2 px-4 text-right font-normal w-24"></th>
            </tr>
          </thead>
          <tbody>
            {groups.map(g => (
              <Fragment key={g.key}>
                <tr className="bg-cream/50 border-y border-pale-stone/60">
                  <td className="py-2 px-4" colSpan={2}>
                    <span className="tabular-nums text-deep-black">{g.bought_at}</span>
                    {g.invoice_no && <span className="text-graphite text-xs"> &middot; {g.invoice_no}</span>}
                    <span className="text-graphite text-xs"> &middot; {g.lines.length} line{g.lines.length === 1 ? '' : 's'}</span>
                  </td>
                  <td className="py-2 px-4 text-right tabular-nums font-medium">{g.units.toLocaleString('en-US')}</td>
                  <td className="py-2 px-4"></td>
                  <td className="py-2 px-4 text-right tabular-nums font-medium">
                    ฿{money(g.subtotal)}
                    <span className="block text-[10px] text-graphite/70">incl. VAT ฿{money(g.subtotal * 1.07)}</span>
                  </td>
                  <td className="py-2 px-4 text-right">
                    <DeleteBuyoutGroupCell supplierId={id} boughtAt={g.bought_at} invoiceNo={g.invoice_no} lineCount={g.lines.length} />
                  </td>
                </tr>
                {g.lines.map(r => (
                  <tr key={r.id} className="border-b border-pale-stone/40 hover:bg-cream/30">
                    <td className="py-2 px-4 pl-8 truncate max-w-[24rem]" title={r.sku?.name ?? ''}>{r.sku?.name ?? '(unknown SKU)'}</td>
                    <td className="py-2 px-4 font-mono text-xs text-graphite">{r.sku?.loyverse_product_code ?? '—'}</td>
                    <td className="py-2 px-4 text-right tabular-nums">{Number(r.qty).toLocaleString('en-US')}</td>
                    <td className="py-2 px-4 text-right tabular-nums text-graphite">
                      {r.unit_price == null ? <span className="text-amber-gold">n/a</span> : money(Number(r.unit_price))}
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums">
                      {r.unit_price == null ? <span className="text-graphite/40">—</span> : `฿${money(Number(r.qty) * Number(r.unit_price))}`}
                    </td>
                    <td className="py-2 px-4 text-right">
                      <DeleteBuyoutCell id={r.id} label={`${r.sku?.name ?? ''} x${r.qty} on ${r.bought_at}`} />
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="py-6 text-center text-graphite text-sm">
                No buyouts logged. Add one below when the supplier invoices you for stock outright.
              </td></tr>
            )}
            {rows.length > 0 && (
              <tr className="bg-cream/60 font-medium">
                <td className="py-2 px-4 text-graphite text-xs uppercase tracking-overline" colSpan={2}>Total</td>
                <td className="py-2 px-4 text-right tabular-nums">{totalUnits.toLocaleString('en-US')}</td>
                <td className="py-2 px-4"></td>
                <td className="py-2 px-4 text-right tabular-nums">฿{money(totalValue)}</td>
                <td className="py-2 px-4"></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <NewBuyoutForm supplierId={id} />
    </>
  )
}
