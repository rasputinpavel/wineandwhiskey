import { sbInventory } from '@/lib/supabase'
import { SyncBadge } from '@/components/modules/inventory/SyncBadge'
import { SchemaError } from '@/components/modules/inventory/SchemaError'

export const dynamic = 'force-dynamic'

type Row = {
  id: string
  number: string
  customer_name: string
  issued_at: string
  due_at: string | null
  status: string
  total: number
}

export default async function B2bPage() {
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await sbInventory
    .from('flowaccount_invoice')
    .select('id, number, customer_name, issued_at, due_at, status, total')
    .not('status', 'in', '(Paid,Cancelled)')
    .order('issued_at', { ascending: false })
    .limit(200)

  if (error) return <SchemaError error={error.message} />
  const rows = (data ?? []) as Row[]
  const overdue = rows.filter(r => r.due_at && r.due_at < today)
  const open    = rows.filter(r => !r.due_at || r.due_at >= today)
  const totalOpen    = open.reduce((s, r) => s + Number(r.total), 0)
  const totalOverdue = overdue.reduce((s, r) => s + Number(r.total), 0)

  return (
    <>
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-3">
        <h2 className="font-heading text-xl text-deep-black">B2B Outstanding</h2>
        <SyncBadge source="flowaccount_invoices" />
      </div>

      <div className="flex gap-8 mb-8 text-sm text-graphite flex-wrap">
        <div>Open: <span className="text-deep-black font-medium tabular-nums">฿{fmt(totalOpen)}</span></div>
        <div>Overdue: <span className="text-wine-red font-medium tabular-nums">฿{fmt(totalOverdue)}</span></div>
        <div>{rows.length} invoice(s)</div>
      </div>

      <Section title="Overdue" rows={overdue} highlight />
      <Section title="Open"    rows={open} />
      {rows.length === 0 && (
        <div className="text-graphite text-sm">No outstanding invoices.</div>
      )}
    </>
  )
}

function Section({ title, rows, highlight }: { title: string; rows: Row[]; highlight?: boolean }) {
  if (rows.length === 0) return null
  return (
    <section className="mb-10">
      <h3 className="font-heading text-base text-deep-black mb-3">{title}</h3>
      <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="text-graphite border-b border-pale-stone bg-cream/40">
            <tr>
              <th className="text-left  py-2 px-4">Invoice #</th>
              <th className="text-left  py-2 px-4">Customer</th>
              <th className="text-left  py-2 px-4">Issued</th>
              <th className="text-left  py-2 px-4">Due</th>
              <th className="text-left  py-2 px-4">Status</th>
              <th className="text-right py-2 px-4">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-b border-pale-stone/40 last:border-0 hover:bg-cream/40">
                <td className="py-2 px-4 font-mono">{r.number}</td>
                <td className="py-2 px-4">{r.customer_name}</td>
                <td className="py-2 px-4">{r.issued_at}</td>
                <td className={`py-2 px-4 ${highlight ? 'text-wine-red' : ''}`}>{r.due_at ?? '—'}</td>
                <td className="py-2 px-4">{r.status}</td>
                <td className="py-2 px-4 text-right tabular-nums">฿{fmt(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function fmt(n: number): string {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}
