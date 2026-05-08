import { sbInventory, type B2bCustomer } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { CustomerTermsCell } from '@/components/modules/inventory/CustomerTermsCell'

export const dynamic = 'force-dynamic'

type CustomerStats = {
  open: number
  overdue: number
  openCount: number
  thisYearTotal: number
  thisYearCount: number
  lastYearTotal: number
  lastYearCount: number
}

export default async function CustomersPage() {
  const today = new Date()
  const todayISO = today.toISOString().slice(0, 10)
  const thisYear = today.getUTCFullYear()
  const lastYear = thisYear - 1

  // 1. Customer registry.
  const { data: customers, error: custErr } = await sbInventory
    .from('b2b_customer')
    .select('id, flowaccount_name, payment_terms_days, credit_limit, is_consignment, notes')
    .order('flowaccount_name')

  if (custErr) return <SchemaError error={custErr.message} />
  const rows = (customers ?? []) as B2bCustomer[]
  const termsByCustomer = new Map(rows.map(c => [c.id, c.payment_terms_days ?? 0]))

  // 2. Every invoice (excluding Cancelled) — used for both outstanding and
  // year-totals aggregation. Single fetch + group locally is faster than
  // 4 queries × N customers.
  const { data: allInv, error: invErr } = await sbInventory
    .from('flowaccount_invoice')
    .select('customer_id, total, issued_at, status')
    .neq('status', 'Cancelled')

  if (invErr) return <SchemaError error={invErr.message} />

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

    // Outstanding subset: only Unpaid/Overdue invoices count toward open.
    if (inv.status === 'Paid') continue
    const terms = termsByCustomer.get(inv.customer_id) ?? 0
    const dueAt = computeDue(inv.issued_at, terms)
    const isOverdue = !!dueAt && dueAt < todayISO
    b.openCount++
    if (isOverdue) b.overdue += total
    else            b.open    += total
  }

  return (
    <>
      <h2 className="font-heading text-xl text-deep-black mb-2">B2B Customers</h2>
      <p className="text-graphite text-sm mb-6 max-w-3xl">
        Условия оплаты задаются здесь и используются на странице{' '}
        <a href="/m/inventory/b2b" className="text-wine-red hover:underline">B2B Outstanding</a>{' '}
        для расчёта <code className="font-mono text-xs">due = issued + terms</code>.
        Колонки <span className="text-deep-black">{thisYear} YTD</span> и{' '}
        <span className="text-deep-black">{lastYear} total</span> — суммы всех инвойсов
        (кроме Cancelled). Если 2025 пусто — sync ещё гонит исторические данные за прошлый год.
      </p>

      <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="text-graphite border-b border-pale-stone bg-cream/40">
            <tr>
              <th className="text-left  py-2 px-4">Customer</th>
              <th className="text-left  py-2 px-4">Terms</th>
              <th className="text-right py-2 px-4">Open</th>
              <th className="text-right py-2 px-4">Overdue</th>
              <th className="text-right py-2 px-4">{thisYear} YTD</th>
              <th className="text-right py-2 px-4">{lastYear} total</th>
              <th className="text-right py-2 px-4">Inv ({thisYear}/{lastYear})</th>
              <th className="text-left  py-2 px-4">Type</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(c => {
              const s = stats.get(c.id) ?? { open: 0, overdue: 0, openCount: 0, thisYearTotal: 0, thisYearCount: 0, lastYearTotal: 0, lastYearCount: 0 }
              return (
                <tr key={c.id} className="border-b border-pale-stone/40 last:border-0 hover:bg-cream/40">
                  <td className="py-2 px-4">{c.flowaccount_name}</td>
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
                  <td className="py-2 px-4 text-graphite text-xs">
                    {c.is_consignment ? 'Consignment' : 'Regular'}
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="py-6 text-center text-graphite text-sm">
                Клиентов пока нет — наполни через <code className="font-mono text-xs">npm run inv:flow</code>.
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
