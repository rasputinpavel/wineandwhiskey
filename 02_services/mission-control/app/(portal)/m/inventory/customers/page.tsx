import { sbInventory, type B2bCustomer } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { CustomerTermsCell } from '@/components/modules/inventory/CustomerTermsCell'

export const dynamic = 'force-dynamic'

type OutstandingByCustomer = Record<string, { open: number; overdue: number; count: number }>

export default async function CustomersPage() {
  const { data: customers, error } = await sbInventory
    .from('b2b_customer')
    .select('id, flowaccount_name, payment_terms_days, credit_limit, is_consignment, notes')
    .order('flowaccount_name')

  if (error) return <SchemaError error={error.message} />
  const rows = (customers ?? []) as B2bCustomer[]

  // Roll up outstanding amounts so the user sees who owes how much.
  const today = new Date().toISOString().slice(0, 10)
  const { data: outstanding } = await sbInventory
    .from('flowaccount_invoice')
    .select('customer_id, total, issued_at, status')
    .not('status', 'in', '(Paid,Cancelled)')

  const byCustomer: OutstandingByCustomer = {}
  for (const inv of (outstanding ?? []) as any[]) {
    if (!inv.customer_id) continue
    const dueByTerms = computeDue(inv.issued_at, rows.find(c => c.id === inv.customer_id)?.payment_terms_days)
    const isOverdue = !!dueByTerms && dueByTerms < today
    const bucket = byCustomer[inv.customer_id] ?? (byCustomer[inv.customer_id] = { open: 0, overdue: 0, count: 0 })
    bucket.count++
    if (isOverdue) bucket.overdue += Number(inv.total)
    else           bucket.open    += Number(inv.total)
  }

  return (
    <>
      <h2 className="font-heading text-xl text-deep-black mb-2">B2B Customers</h2>
      <p className="text-graphite text-sm mb-6 max-w-2xl">
        Условия оплаты задаются здесь и используются на странице{' '}
        <a href="/m/inventory/b2b" className="text-wine-red hover:underline">B2B Outstanding</a>{' '}
        для расчёта <code className="font-mono text-xs">due = issued + terms</code>.
        FlowAccount не отдаёт срок оплаты в списке инвойсов, поэтому считаем сами.
      </p>

      <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="text-graphite border-b border-pale-stone bg-cream/40">
            <tr>
              <th className="text-left  py-2 px-4">Customer</th>
              <th className="text-left  py-2 px-4">Terms</th>
              <th className="text-right py-2 px-4">Open</th>
              <th className="text-right py-2 px-4">Overdue</th>
              <th className="text-right py-2 px-4">Invoices</th>
              <th className="text-left  py-2 px-4">Type</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(c => {
              const o = byCustomer[c.id] ?? { open: 0, overdue: 0, count: 0 }
              return (
                <tr key={c.id} className="border-b border-pale-stone/40 last:border-0 hover:bg-cream/40">
                  <td className="py-2 px-4">{c.flowaccount_name}</td>
                  <td className="py-2 px-4">
                    <CustomerTermsCell customerId={c.id} initial={c.payment_terms_days} />
                  </td>
                  <td className="py-2 px-4 text-right tabular-nums">{o.open ? `฿${fmt(o.open)}` : '—'}</td>
                  <td className={`py-2 px-4 text-right tabular-nums ${o.overdue > 0 ? 'text-wine-red font-medium' : ''}`}>
                    {o.overdue ? `฿${fmt(o.overdue)}` : '—'}
                  </td>
                  <td className="py-2 px-4 text-right tabular-nums text-graphite">{o.count || '—'}</td>
                  <td className="py-2 px-4 text-graphite text-xs">
                    {c.is_consignment ? 'Consignment' : 'Regular'}
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="py-6 text-center text-graphite text-sm">
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
