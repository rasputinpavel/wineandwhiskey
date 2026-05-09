import Link from 'next/link'
import { sbInventory, sbPublic, type Supplier, type PurchaseOrder } from '@/lib/supabase'
import { PaneHeader } from '@/components/shell/PaneHeader'
import { findItem } from '@/lib/registry'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { SupplierTermsCell, SupplierTypeCell } from '@/components/modules/suppliers/SupplierEditCell'
import { BulkTermsCell } from '@/components/modules/customers/BulkTermsCell'
import { DataFreshness } from '@/components/shell/DataFreshness'

export const dynamic = 'force-dynamic'

type SortKey = 'name' | 'type' | 'terms' | 'this_year' | 'last_year' | 'po_count' | 'last_po'
const SORT_KEYS: SortKey[] = ['name', 'type', 'terms', 'this_year', 'last_year', 'po_count', 'last_po']

type SearchParams = {
  type?: 'all' | 'regular' | 'consignment' | 'mix'
  sort?: SortKey
  dir?: 'asc' | 'desc'
}

type SupplierStats = {
  thisYearTotal: number; thisYearCount: number
  lastYearTotal: number; lastYearCount: number
  lastDate: string | null
}

const EMPTY: SupplierStats = {
  thisYearTotal: 0, thisYearCount: 0,
  lastYearTotal: 0, lastYearCount: 0,
  lastDate: null,
}

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const typeFilter: SearchParams['type'] = sp.type ?? 'all'
  const sort: SortKey = SORT_KEYS.includes(sp.sort as SortKey) ? (sp.sort as SortKey) : 'name'
  const dir = sp.dir === 'desc' ? 'desc' : 'asc'
  const item = findItem('suppliers')!

  const today = new Date()
  const thisYear = today.getUTCFullYear()
  const lastYear = thisYear - 1

  const { data: supRows, error: supErr } = await sbInventory
    .from('supplier')
    .select('id, name, type, payment_terms_days, notes')
    .order('name')
  if (supErr) {
    return <><PaneHeader item={item} /><div className="p-6"><SchemaError error={supErr.message} /></div></>
  }
  const all = (supRows ?? []) as Supplier[]

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
    if (!s) { s = { ...EMPTY }; stats.set(k, s) }
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

  let suppliers = all
  if (typeFilter !== 'all') suppliers = suppliers.filter(s => s.type === typeFilter)
  suppliers = [...suppliers].sort((a, b) => {
    const sa = stats.get(a.name.trim().toLowerCase()) ?? EMPTY
    const sb = stats.get(b.name.trim().toLowerCase()) ?? EMPTY
    let av: number | string, bv: number | string
    switch (sort) {
      case 'name':      av = a.name.toLowerCase();          bv = b.name.toLowerCase(); break
      case 'type':      av = a.type;                         bv = b.type; break
      case 'terms':     av = a.payment_terms_days;           bv = b.payment_terms_days; break
      case 'this_year': av = sa.thisYearTotal;               bv = sb.thisYearTotal; break
      case 'last_year': av = sa.lastYearTotal;               bv = sb.lastYearTotal; break
      case 'po_count':  av = sa.thisYearCount + sa.lastYearCount; bv = sb.thisYearCount + sb.lastYearCount; break
      case 'last_po':   av = sa.lastDate ?? '';              bv = sb.lastDate ?? ''; break
    }
    if (av === bv) return 0
    return ((av < bv ? -1 : 1) * (dir === 'asc' ? 1 : -1))
  })

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
          <div className="flex items-baseline justify-between mb-2 flex-wrap gap-3">
            <h2 className="font-heading text-xl text-deep-black">Suppliers</h2>
            <DataFreshness sources={['purchase_orders']} />
          </div>
          <p className="text-graphite text-sm mb-4 max-w-3xl">
            Поставщики, у которых мы закупаем товар. <span className="text-deep-black">Regular</span> —
            tax invoice с отсрочкой <code className="font-mono text-xs">Terms</code> дней (0 = по факту, 30 = через месяц).
            <span className="text-deep-black"> Consignment</span> — delivery note без обязательства, true-up раз в месяц по факту проданного.
            <span className="text-deep-black"> Mix</span> — часть SKU regular, часть consignment.
          </p>

          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div className="flex gap-1 text-xs">
              {(['all', 'regular', 'consignment', 'mix'] as const).map(k => {
                const active = typeFilter === k
                const label = k === 'all' ? 'All' : k[0].toUpperCase() + k.slice(1)
                const params = new URLSearchParams()
                if (k !== 'all') params.set('type', k)
                if (sp.sort) params.set('sort', sp.sort)
                if (sp.dir)  params.set('dir',  sp.dir)
                const qs = params.toString()
                return (
                  <Link key={k}
                    href={qs ? `/m/suppliers?${qs}` : '/m/suppliers'}
                    className={`px-3 py-1.5 rounded-sm border transition-colors ${
                      active
                        ? 'bg-wine-red text-warm-white border-wine-red'
                        : 'bg-warm-white text-graphite border-pale-stone hover:border-wine-red hover:text-wine-red'
                    }`}>
                    {label}
                    <span className={`ml-1.5 ${active ? 'opacity-80' : 'text-graphite/60'}`}>
                      {counts[k]}
                    </span>
                  </Link>
                )
              })}
            </div>
            <BulkTermsCell endpoint="/api/m/suppliers/bulk-terms" defaultDays={30} />
          </div>

          <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
            <table className="w-full text-[13px]">
              <thead className="text-graphite border-b border-pale-stone bg-cream/40">
                <tr>
                  <SortTh col="name"      label="Supplier"             sort={sort} dir={dir} sp={sp} />
                  <SortTh col="type"      label="Type"                 sort={sort} dir={dir} sp={sp} />
                  <SortTh col="terms"     label="Terms"                sort={sort} dir={dir} sp={sp} />
                  <SortTh col="this_year" label={`${thisYear} YTD`}    sort={sort} dir={dir} sp={sp} align="right" />
                  <SortTh col="last_year" label={`${lastYear} total`}  sort={sort} dir={dir} sp={sp} align="right" />
                  <SortTh col="po_count"  label={`PO (${thisYear}/${lastYear})`} sort={sort} dir={dir} sp={sp} align="right" />
                  <SortTh col="last_po"   label="Last PO"              sort={sort} dir={dir} sp={sp} />
                </tr>
              </thead>
              <tbody>
                {suppliers.map(s => {
                  const st = stats.get(s.name.trim().toLowerCase()) ?? EMPTY
                  return (
                    <tr key={s.id} className="border-b border-pale-stone/40 last:border-0 hover:bg-cream/40">
                      <td className="py-2 px-4">{s.name}</td>
                      <td className="py-2 px-4"><SupplierTypeCell supplierId={s.id} initial={s.type} /></td>
                      <td className="py-2 px-4"><SupplierTermsCell supplierId={s.id} initial={s.payment_terms_days} /></td>
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
                    {typeFilter === 'all'
                      ? <>Поставщиков пока нет. Применил миграцию <code className="font-mono text-xs">002_supplier.sql</code>?</>
                      : <>Нет поставщиков в категории <span className="text-deep-black">{typeFilter}</span>.</>}
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

function SortTh({
  col, label, sort, dir, sp, align = 'left',
}: {
  col: SortKey
  label: string
  sort: SortKey
  dir: 'asc' | 'desc'
  sp: SearchParams
  align?: 'left' | 'right'
}) {
  const isActive = sort === col
  const nextDir: 'asc' | 'desc' = isActive ? (dir === 'asc' ? 'desc' : 'asc') : 'asc'
  const params = new URLSearchParams()
  if (sp.type && sp.type !== 'all') params.set('type', sp.type)
  params.set('sort', col)
  params.set('dir', nextDir)
  const arrow = !isActive ? ' ↕' : (dir === 'asc' ? ' ↑' : ' ↓')
  return (
    <th className={`py-2 px-4 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <Link href={`?${params.toString()}`}
            className={`whitespace-nowrap ${isActive ? 'text-wine-red' : 'text-graphite hover:text-deep-black'}`}>
        {label}<span className="opacity-60">{arrow}</span>
      </Link>
    </th>
  )
}

function fmt(n: number): string {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}
