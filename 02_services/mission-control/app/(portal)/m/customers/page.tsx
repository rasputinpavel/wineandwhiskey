import Link from 'next/link'
import { sbInventory, type B2bCustomer } from '@/lib/supabase'
import { PaneHeader } from '@/components/shell/PaneHeader'
import { findItem } from '@/lib/registry'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { CustomerTermsCell, CustomerConsignmentCell } from '@/components/modules/customers/CustomerEditCell'
import { DataFreshness } from '@/components/shell/DataFreshness'

export const dynamic = 'force-dynamic'

type SearchParams = { type?: 'all' | 'regular' | 'consignment' }

type CustomerStats = {
  open: number
  overdue: number
  openCount: number
  thisYearTotal: number
  thisYearCount: number
  lastYearTotal: number
  lastYearCount: number
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const sp = await searchParams
  const typeFilter: SearchParams['type'] = sp.type ?? 'all'

  const item = findItem('customers')!
  const today = new Date()
  const todayISO = today.toISOString().slice(0, 10)
  const thisYear = today.getUTCFullYear()
  const lastYear = thisYear - 1

  const { data: customers, error: custErr } = await sbInventory
    .from('b2b_customer')
    .select('id, flowaccount_name, payment_terms_days, credit_limit, is_consignment, notes')
    .order('flowaccount_name')

  if (custErr) {
    return <><PaneHeader item={item} /><div className="p-6"><SchemaError error={custErr.message} /></div></>
  }

  let rows = (customers ?? []) as B2bCustomer[]
  if (typeFilter === 'regular')     rows = rows.filter(c => !c.is_consignment)
  if (typeFilter === 'consignment') rows = rows.filter(c =>  c.is_consignment)

  const termsByCustomer = new Map(((customers ?? []) as B2bCustomer[]).map(c => [c.id, c.payment_terms_days ?? 0]))

  const { data: allInv, error: invErr } = await sbInventory
    .from('flowaccount_invoice')
    .select('customer_id, total, issued_at, status')
    .neq('status', 'Cancelled')

  if (invErr) {
    return <><PaneHeader item={item} /><div className="p-6"><SchemaError error={invErr.message} /></div></>
  }

  const stats = new Map<string, CustomerStats>()
  function bucket(id: string): CustomerStats {
    let s = stats.get(id)
    if (!s) {
      s = { open: 0, overdue: 0, openCount: 0, thisYearTotal: 0, thisYearCount: 0, lastYearTotal: 0, lastYearCount: 0 }
      stats.set(id, s)
    }
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

  const counts = {
    all: ((customers ?? []) as B2bCustomer[]).length,
    regular: ((customers ?? []) as B2bCustomer[]).filter(c => !c.is_consignment).length,
    consignment: ((customers ?? []) as B2bCustomer[]).filter(c => c.is_consignment).length,
  }

  return (
    <>
      <PaneHeader item={item} />
      <div className="flex-1 overflow-y-auto bg-cream">
        <div className="max-w-[1280px] mx-auto px-6 py-6">
          <div className="flex items-baseline justify-between mb-2 flex-wrap gap-3">
            <h2 className="font-heading text-xl text-deep-black">B2B Customers</h2>
            <DataFreshness sources={['flowaccount_invoices']} />
          </div>
          <p className="text-graphite text-sm mb-4 max-w-3xl">
            Условия оплаты и пометка «consignment» задаются здесь. Используются на странице{' '}
            <a href="/m/inventory/b2b" className="text-wine-red hover:underline">B2B Outstanding</a>{' '}
            для расчёта <code className="font-mono text-xs">due = issued + terms</code>.
            Колонки <span className="text-deep-black">{thisYear} YTD</span> и{' '}
            <span className="text-deep-black">{lastYear} total</span> — суммы всех инвойсов кроме Cancelled.
          </p>

          {/* Type filter pills */}
          <div className="flex gap-1 mb-4 text-xs">
            {(['all', 'regular', 'consignment'] as const).map(k => {
              const active = typeFilter === k
              return (
                <Link
                  key={k}
                  href={k === 'all' ? '/m/customers' : `/m/customers?type=${k}`}
                  className={`px-3 py-1.5 rounded-sm border transition-colors ${
                    active
                      ? 'bg-wine-red text-warm-white border-wine-red'
                      : 'bg-warm-white text-graphite border-pale-stone hover:border-wine-red hover:text-wine-red'
                  }`}
                >
                  {k === 'all' ? 'All' : k === 'regular' ? 'Regular' : 'Consignment'}
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
                  <th className="text-left  py-2 px-4">Customer</th>
                  <th className="text-left  py-2 px-4">Type</th>
                  <th className="text-left  py-2 px-4">Terms</th>
                  <th className="text-right py-2 px-4">Open</th>
                  <th className="text-right py-2 px-4">Overdue</th>
                  <th className="text-right py-2 px-4">{thisYear} YTD</th>
                  <th className="text-right py-2 px-4">{lastYear} total</th>
                  <th className="text-right py-2 px-4">Inv ({thisYear}/{lastYear})</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(c => {
                  const s = stats.get(c.id) ?? { open: 0, overdue: 0, openCount: 0, thisYearTotal: 0, thisYearCount: 0, lastYearTotal: 0, lastYearCount: 0 }
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
        </div>
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
