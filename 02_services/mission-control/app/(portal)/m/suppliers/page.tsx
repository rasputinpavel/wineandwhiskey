import Link from 'next/link'
import { sbInventory, sbPublic, type Supplier, type PurchaseOrder } from '@/lib/supabase'
import { PaneHeader } from '@/components/shell/PaneHeader'
import { findItem } from '@/lib/registry'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { SupplierTermsCell, SupplierTypeCell } from '@/components/modules/suppliers/SupplierEditCell'

export const dynamic = 'force-dynamic'

type SearchParams = { type?: 'all' | 'regular' | 'consignment' | 'mix' }

type SupplierStats = {
  thisYearTotal: number; thisYearCount: number
  lastYearTotal: number; lastYearCount: number
  lastDate: string | null
}

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const sp = await searchParams
  const typeFilter: SearchParams['type'] = sp.type ?? 'all'
  const item = findItem('suppliers')!

  const today = new Date()
  const thisYear = today.getUTCFullYear()
  const lastYear = thisYear - 1

  // Suppliers list (inventory.supplier — populated by migration 002 seed
  // from public.purchase_orders.supplier).
  const { data: supRows, error: supErr } = await sbInventory
    .from('supplier')
    .select('id, name, type, payment_terms_days, notes')
    .order('name')

  if (supErr) {
    return <><PaneHeader item={item} /><div className="p-6"><SchemaError error={supErr.message} /></div></>
  }

  let suppliers = (supRows ?? []) as Supplier[]
  if (typeFilter !== 'all') suppliers = suppliers.filter(s => s.type === typeFilter)

  // Aggregate purchase_orders (= tax invoices we've received) by supplier name.
  const { data: poRows, error: poErr } = await sbPublic
    .from('purchase_orders')
    .select('supplier, total_thb, order_date')

  if (poErr) {
    return <><PaneHeader item={item} /><div className="p-6"><SchemaError error={poErr.message} /></div></>
  }

  const stats = new Map<string, SupplierStats>()
  function bucket(name: string): SupplierStats {
    const k = name.trim().toLowerCase()
    let s = stats.get(k)
    if (!s) {
      s = { thisYearTotal: 0, thisYearCount: 0, lastYearTotal: 0, lastYearCount: 0, lastDate: null }
      stats.set(k, s)
    }
    return s
  }

  for (const po of (poRows ?? []) as PurchaseOrder[]) {
    if (!po.supplier) continue
    const b = bucket(po.supplier)
    const total = Number(po.total_thb ?? 0)
    const year = po.order_date?.slice(0, 4)
    if (year === String(thisYear)) { b.thisYearTotal += total; b.thisYearCount++ }
    if (year === String(lastYear)) { b.lastYearTotal += total; b.lastYearCount++ }
    if (po.order_date && (!b.lastDate || po.order_date > b.lastDate)) b.lastDate = po.order_date
  }

  const all = (supRows ?? []) as Supplier[]
  const counts = {
    all:         all.length,
    regular:     all.filter(s => s.type === 'regular').length,
    consignment: all.filter(s => s.type === 'consignment').length,
    mix:         all.filter(s => s.type === 'mix').length,
  }

  return (
    <>
      <PaneHeader item={item} />
      <div className="flex-1 overflow-y-auto bg-cream">
        <div className="max-w-[1280px] mx-auto px-6 py-6">
          <h2 className="font-heading text-xl text-deep-black mb-2">Suppliers</h2>
          <p className="text-graphite text-sm mb-4 max-w-3xl">
            Поставщики, у которых мы закупаем товар. Тип <span className="text-deep-black">Regular</span> —
            работают по tax invoice (мы должны сразу). <span className="text-deep-black">Consignment</span> —
            присылают delivery note, платим раз в месяц по факту проданного.
            Цифры берутся из <code className="font-mono text-xs">public.purchase_orders</code> (то что задали как PO в Loyverse).
          </p>

          <div className="flex gap-1 mb-4 text-xs">
            {(['all', 'regular', 'consignment', 'mix'] as const).map(k => {
              const active = typeFilter === k
              const label = k === 'all' ? 'All' : k[0].toUpperCase() + k.slice(1)
              return (
                <Link
                  key={k}
                  href={k === 'all' ? '/m/suppliers' : `/m/suppliers?type=${k}`}
                  className={`px-3 py-1.5 rounded-sm border transition-colors ${
                    active
                      ? 'bg-wine-red text-warm-white border-wine-red'
                      : 'bg-warm-white text-graphite border-pale-stone hover:border-wine-red hover:text-wine-red'
                  }`}
                >
                  {label}
                  <span className={`ml-1.5 ${active ? 'opacity-80' : 'text-graphite/60'}`}>
                    {counts[k]}
                  </span>
                </Link>
              )
            })}
          </div>

          <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
            <table className="w-full text-[13px]">
              <thead className="text-graphite border-b border-pale-stone bg-cream/40">
                <tr>
                  <th className="text-left  py-2 px-4">Supplier</th>
                  <th className="text-left  py-2 px-4">Type</th>
                  <th className="text-left  py-2 px-4">Terms</th>
                  <th className="text-right py-2 px-4">{thisYear} YTD</th>
                  <th className="text-right py-2 px-4">{lastYear} total</th>
                  <th className="text-right py-2 px-4">PO ({thisYear}/{lastYear})</th>
                  <th className="text-left  py-2 px-4">Last PO</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map(s => {
                  const st = stats.get(s.name.trim().toLowerCase()) ?? { thisYearTotal: 0, thisYearCount: 0, lastYearTotal: 0, lastYearCount: 0, lastDate: null }
                  return (
                    <tr key={s.id} className="border-b border-pale-stone/40 last:border-0 hover:bg-cream/40">
                      <td className="py-2 px-4">{s.name}</td>
                      <td className="py-2 px-4">
                        <SupplierTypeCell supplierId={s.id} initial={s.type} />
                      </td>
                      <td className="py-2 px-4">
                        <SupplierTermsCell supplierId={s.id} initial={s.payment_terms_days} />
                      </td>
                      <td className="py-2 px-4 text-right tabular-nums">{st.thisYearTotal ? `฿${fmt(st.thisYearTotal)}` : '—'}</td>
                      <td className="py-2 px-4 text-right tabular-nums">{st.lastYearTotal ? `฿${fmt(st.lastYearTotal)}` : '—'}</td>
                      <td className="py-2 px-4 text-right tabular-nums text-graphite">
                        {st.thisYearCount}/{st.lastYearCount}
                      </td>
                      <td className="py-2 px-4 text-graphite text-xs">{st.lastDate ?? '—'}</td>
                    </tr>
                  )
                })}
                {suppliers.length === 0 && (
                  <tr><td colSpan={7} className="py-6 text-center text-graphite text-sm">
                    {typeFilter === 'all' ? (
                      <>Поставщиков пока нет. Применил миграцию <code className="font-mono text-xs">002_supplier.sql</code>?</>
                    ) : (
                      <>Нет поставщиков в категории <span className="text-deep-black">{typeFilter}</span>.</>
                    )}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  )
}

function fmt(n: number): string {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}
