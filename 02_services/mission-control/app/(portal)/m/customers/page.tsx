import Link from 'next/link'
import { sbInventory, type B2bCustomer } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { CustomerTermsCell, CustomerConsignmentCell } from '@/components/modules/customers/CustomerEditCell'
import { BulkTermsCell } from '@/components/modules/customers/BulkTermsCell'
import { DataFreshness } from '@/components/shell/DataFreshness'
import { SortHeader } from '@/components/shell/SortHeader'

export const dynamic = 'force-dynamic'

type SortKey = 'name' | 'type' | 'terms' | 'open' | 'overdue' | 'this_year' | 'last_year' | 'invoices'
const SORT_KEYS: SortKey[] = ['name', 'type', 'terms', 'open', 'overdue', 'this_year', 'last_year', 'invoices']

type SearchParams = {
  type?: 'all' | 'regular' | 'consignment'
  sort?: SortKey
  dir?: 'asc' | 'desc'
}

type CustomerStats = {
  open: number
  overdue: number
  openCount: number
  thisYearTotal: number
  thisYearCount: number
  lastYearTotal: number
  lastYearCount: number
}

const EMPTY_STATS: CustomerStats = {
  open: 0, overdue: 0, openCount: 0,
  thisYearTotal: 0, thisYearCount: 0,
  lastYearTotal: 0, lastYearCount: 0,
}

export default async function CustomersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const typeFilter: SearchParams['type'] = sp.type ?? 'all'
  const sort: SortKey = SORT_KEYS.includes(sp.sort as SortKey) ? (sp.sort as SortKey) : 'name'
  const dir = sp.dir === 'desc' ? 'desc' : 'asc'

  const today = new Date()
  const todayISO = today.toISOString().slice(0, 10)
  const thisYear = today.getUTCFullYear()
  const lastYear = thisYear - 1

  const { data: customers, error: custErr } = await sbInventory
    .from('b2b_customer')
    .select('id, flowaccount_name, payment_terms_days, credit_limit, is_consignment, notes')
    .order('flowaccount_name')
  if (custErr) {
    return <div className="p-6"><SchemaError error={custErr.message} /></div>
  }

  const all = (customers ?? []) as B2bCustomer[]
  const termsByCustomer = new Map(all.map(c => [c.id, c.payment_terms_days ?? 0]))

  const { data: allInv, error: invErr } = await sbInventory
    .from('flowaccount_invoice')
    .select('customer_id, total, issued_at, status')
    .neq('status', 'Cancelled')
  if (invErr) {
    return <div className="p-6"><SchemaError error={invErr.message} /></div>
  }

  const stats = new Map<string, CustomerStats>()
  function bucket(id: string): CustomerStats {
    let s = stats.get(id)
    if (!s) { s = { ...EMPTY_STATS }; stats.set(id, s) }
    return s
  }
  for (const inv of (allInv ?? []) as any[]) {
    if (!inv.customer_id) continue
    const b = bucket(inv.customer_id)
    const total = Number(inv.total)
    const year = inv.issued_at?.slice(0, 4)
    if (year === String(thisYear)) { b.thisYearTotal += total; b.thisYearCount++ }
    if (year === String(lastYear)) { b.lastYearTotal += total; b.lastYearCount++ }
    if (inv.status === 'Paid') continue
    const terms = termsByCustomer.get(inv.customer_id) ?? 0
    const dueAt = computeDue(inv.issued_at, terms)
    const isOverdue = !!dueAt && dueAt < todayISO
    b.openCount++
    if (isOverdue) b.overdue += total; else b.open += total
  }

  let rows = all
  if (typeFilter === 'regular')     rows = rows.filter(c => !c.is_consignment)
  if (typeFilter === 'consignment') rows = rows.filter(c =>  c.is_consignment)

  // Computed columns aren't part of the row, so we sort in memory.
  rows = [...rows].sort((a, b) => {
    const sa = stats.get(a.id) ?? EMPTY_STATS
    const sb = stats.get(b.id) ?? EMPTY_STATS
    let av: number | string, bv: number | string
    switch (sort) {
      case 'name':      av = a.flowaccount_name.toLowerCase(); bv = b.flowaccount_name.toLowerCase(); break
      case 'type':      av = a.is_consignment ? 1 : 0;          bv = b.is_consignment ? 1 : 0; break
      case 'terms':     av = a.payment_terms_days;              bv = b.payment_terms_days; break
      case 'open':      av = sa.open;                           bv = sb.open; break
      case 'overdue':   av = sa.overdue;                        bv = sb.overdue; break
      case 'this_year': av = sa.thisYearTotal;                  bv = sb.thisYearTotal; break
      case 'last_year': av = sa.lastYearTotal;                  bv = sb.lastYearTotal; break
      case 'invoices':  av = sa.thisYearCount + sa.lastYearCount; bv = sb.thisYearCount + sb.lastYearCount; break
    }
    if (av === bv) return 0
    return ((av < bv ? -1 : 1) * (dir === 'asc' ? 1 : -1))
  })

  const counts = {
    all: all.length,
    regular: all.filter(c => !c.is_consignment).length,
    consignment: all.filter(c => c.is_consignment).length,
  }

  return (
    <>
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-3">
        <h2 className="font-heading text-xl text-deep-black">B2B Customers</h2>
        <DataFreshness sources={['flowaccount_invoices']} />
      </div>
      <p className="text-graphite text-sm mb-4 max-w-3xl">
        Условия оплаты и пометка «consignment» задаются здесь. Используются на вкладке{' '}
        <a href="/m/customers/outstanding" className="text-wine-red hover:underline">Outstanding Invoices</a>{' '}
        для расчёта <code className="font-mono text-xs">due = issued + terms</code>.
        Колонки <span className="text-deep-black">{thisYear} YTD</span> и{' '}
        <span className="text-deep-black">{lastYear} total</span> — суммы всех инвойсов кроме Cancelled.
      </p>

          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div className="flex gap-1 text-xs">
              {(['all', 'regular', 'consignment'] as const).map(k => {
                const active = typeFilter === k
                const params = new URLSearchParams()
                if (k !== 'all') params.set('type', k)
                if (sp.sort) params.set('sort', sp.sort)
                if (sp.dir)  params.set('dir',  sp.dir)
                const qs = params.toString()
                return (
                  <Link key={k}
                    href={qs ? `/m/customers?${qs}` : '/m/customers'}
                    className={`px-3 py-1.5 rounded-sm border transition-colors ${
                      active
                        ? 'bg-wine-red text-warm-white border-wine-red'
                        : 'bg-warm-white text-graphite border-pale-stone hover:border-wine-red hover:text-wine-red'
                    }`}>
                    {k === 'all' ? 'All' : k === 'regular' ? 'Regular' : 'Consignment'}
                    <span className={`ml-1.5 ${active ? 'opacity-80' : 'text-graphite/60'}`}>
                      {counts[k]}
                    </span>
                  </Link>
                )
              })}
            </div>
            <BulkTermsCell endpoint="/api/m/customers/bulk-terms" defaultDays={30} />
          </div>

          <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
            <table className="w-full text-[13px]">
              <thead className="text-graphite border-b border-pale-stone bg-cream/40">
                <tr>
                  <SortHeader col="name"      label="Customer"            sort={sort} dir={dir} sp={sp} keep={['type']} firstDir="asc" />
                  <SortHeader col="type"      label="Type"                sort={sort} dir={dir} sp={sp} keep={['type']} firstDir="asc" />
                  <SortHeader col="terms"     label="Terms"               sort={sort} dir={dir} sp={sp} keep={['type']} firstDir="asc" />
                  <SortHeader col="open"      label="Open"                sort={sort} dir={dir} sp={sp} keep={['type']} align="right" />
                  <SortHeader col="overdue"   label="Overdue"             sort={sort} dir={dir} sp={sp} keep={['type']} align="right" />
                  <SortHeader col="this_year" label={`${thisYear} YTD`}   sort={sort} dir={dir} sp={sp} keep={['type']} align="right" />
                  <SortHeader col="last_year" label={`${lastYear} total`} sort={sort} dir={dir} sp={sp} keep={['type']} align="right" />
                  <SortHeader col="invoices"  label={`Inv (${thisYear}/${lastYear})`} sort={sort} dir={dir} sp={sp} keep={['type']} align="right" />
                </tr>
              </thead>
              <tbody>
                {rows.map(c => {
                  const s = stats.get(c.id) ?? EMPTY_STATS
                  return (
                    <tr key={c.id} className="border-b border-pale-stone/40 last:border-0 hover:bg-cream/40">
                      <td className="py-2 px-4">
                        <Link href={`/m/customers/${c.id}`} className="hover:text-wine-red">
                          {c.flowaccount_name}
                        </Link>
                      </td>
                      <td className="py-2 px-4">
                        <CustomerConsignmentCell customerId={c.id} initial={c.is_consignment} />
                      </td>
                      <td className="py-2 px-4">
                        <CustomerTermsCell customerId={c.id} initial={c.payment_terms_days} />
                      </td>
                      <td className="py-2 px-4 text-right tabular-nums">{s.open ? `฿${fmt(s.open)}` : '—'}</td>
                      <td className={`py-2 px-4 text-right tabular-nums ${s.overdue > 0 ? 'text-wine-red font-medium' : ''}`}>
                        {s.overdue ? `฿${fmt(s.overdue)}` : '—'}
                      </td>
                      <td className="py-2 px-4 text-right tabular-nums">{s.thisYearTotal ? `฿${fmt(s.thisYearTotal)}` : '—'}</td>
                      <td className="py-2 px-4 text-right tabular-nums">{s.lastYearTotal ? `฿${fmt(s.lastYearTotal)}` : '—'}</td>
                      <td className="py-2 px-4 text-right tabular-nums text-graphite">
                        {s.thisYearCount}/{s.lastYearCount}
                      </td>
                    </tr>
                  )
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={8} className="py-6 text-center text-graphite text-sm">
                    {typeFilter === 'all'
                      ? <>Клиентов пока нет — наполни через <code className="font-mono text-xs">npm run inv:flow</code>.</>
                      : <>Нет клиентов в категории <span className="text-deep-black">{typeFilter}</span>.</>}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
    </>
  )
}

function computeDue(issuedAt: string | null | undefined, terms: number | null | undefined): string | null {
  if (!issuedAt || !terms || terms <= 0) return null
  const d = new Date(issuedAt)
  d.setUTCDate(d.getUTCDate() + terms)
  return d.toISOString().slice(0, 10)
}

function fmt(n: number): string {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}
