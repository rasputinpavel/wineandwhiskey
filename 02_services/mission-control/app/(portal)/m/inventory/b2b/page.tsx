import Link from 'next/link'
import { sbInventory } from '@/lib/supabase'
import { SyncBadge } from '@/components/modules/inventory/SyncBadge'
import { SchemaError } from '@/components/modules/inventory/SchemaError'

export const dynamic = 'force-dynamic'

type Invoice = {
  id: string
  number: string
  customer_name: string
  issued_at: string
  due_at: string | null
  status: string
  total: number
  detail_url: string | null
}

type Line = {
  id: string
  invoice_id: string
  qty: number
  amount: number | null
  raw_text: string
  sku_id: string | null
  sku: { name: string; loyverse_product_code: string | null } | null
}

export default async function B2bPage() {
  const today = new Date().toISOString().slice(0, 10)

  const { data: invData, error: invErr } = await sbInventory
    .from('flowaccount_invoice')
    .select('id, number, customer_name, issued_at, due_at, status, total, detail_url')
    .not('status', 'in', '(Paid,Cancelled)')
    .order('issued_at', { ascending: false })
    .limit(200)

  if (invErr) return <SchemaError error={invErr.message} />
  const invoices = (invData ?? []) as Invoice[]

  // Pull all lines for these invoices in one query so the inline expansion
  // is instant — no per-invoice round-trip.
  let linesByInvoice: Record<string, Line[]> = {}
  if (invoices.length) {
    const { data: lineData, error: lineErr } = await sbInventory
      .from('flowaccount_invoice_line')
      .select('id, invoice_id, qty, amount, raw_text, sku_id, sku(name, loyverse_product_code)')
      .in('invoice_id', invoices.map(i => i.id))
    if (lineErr) return <SchemaError error={lineErr.message} />
    for (const l of (lineData ?? []) as unknown as Line[]) {
      if (!linesByInvoice[l.invoice_id]) linesByInvoice[l.invoice_id] = []
      linesByInvoice[l.invoice_id].push(l)
    }
  }

  const overdue = invoices.filter(r => r.due_at && r.due_at < today)
  const open    = invoices.filter(r => !r.due_at || r.due_at >= today)
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
        <div>{invoices.length} invoice(s)</div>
        <div className="text-xs">Click an invoice to see its lines · click a SKU to drill in</div>
      </div>

      <Section title="Overdue" rows={overdue} linesByInvoice={linesByInvoice} highlight defaultOpen />
      <Section title="Open"    rows={open}    linesByInvoice={linesByInvoice} />
      {invoices.length === 0 && (
        <div className="text-graphite text-sm">No outstanding invoices.</div>
      )}
    </>
  )
}

function Section({
  title, rows, linesByInvoice, highlight, defaultOpen,
}: {
  title: string
  rows: Invoice[]
  linesByInvoice: Record<string, any[]>
  highlight?: boolean
  defaultOpen?: boolean
}) {
  if (rows.length === 0) return null
  return (
    <section className="mb-10">
      <h3 className="font-heading text-base text-deep-black mb-3">{title}</h3>
      <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
        {rows.map(inv => (
          <details key={inv.id} open={defaultOpen} className="group border-b border-pale-stone/40 last:border-0">
            <summary className="cursor-pointer hover:bg-cream/40 list-none">
              <div className="grid grid-cols-[40px_140px_1fr_120px_120px_120px_120px] gap-2 items-center text-[13px] py-2 px-2">
                <span className="text-graphite text-center select-none transition-transform group-open:rotate-90">▸</span>
                <span className="font-mono">{inv.number}</span>
                <span>{inv.customer_name}</span>
                <span className="text-graphite">{inv.issued_at}</span>
                <span className={highlight ? 'text-wine-red' : ''}>{inv.due_at ?? '—'}</span>
                <span><StatusPill status={inv.status} /></span>
                <span className="text-right tabular-nums">฿{fmt(inv.total)}</span>
              </div>
            </summary>

            <InvoiceLines lines={linesByInvoice[inv.id] ?? []} detailUrl={inv.detail_url} />
          </details>
        ))}
      </div>
    </section>
  )
}

function InvoiceLines({ lines, detailUrl }: { lines: Line[]; detailUrl: string | null }) {
  if (lines.length === 0) {
    return <div className="px-12 py-3 text-xs text-graphite bg-cream/30">Нет позиций — возможно, инвойс ещё не разобран. {detailUrl && <a href={detailUrl} target="_blank" className="text-wine-red hover:underline ml-1">Открыть в FlowAccount ↗</a>}</div>
  }
  return (
    <div className="px-12 py-3 bg-cream/30 border-t border-pale-stone/30">
      <table className="w-full text-[12px]">
        <thead className="text-graphite">
          <tr>
            <th className="text-left  py-1 pr-4">SKU</th>
            <th className="text-left  py-1 pr-4">Name (raw)</th>
            <th className="text-right py-1 pr-4">Qty</th>
            <th className="text-right py-1 pr-4">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(l => (
            <tr key={l.id} className="border-t border-pale-stone/30">
              <td className="py-1 pr-4 font-mono text-graphite">
                {l.sku?.loyverse_product_code
                  ? <Link href={`/m/inventory/sku/${l.sku.loyverse_product_code}`} className="hover:text-wine-red">{l.sku.loyverse_product_code}</Link>
                  : <span title="Unmapped" className="text-amber-gold">—</span>}
              </td>
              <td className="py-1 pr-4">{l.sku?.name ?? l.raw_text}</td>
              <td className="py-1 pr-4 text-right tabular-nums">{fmt(l.qty)}</td>
              <td className="py-1 pr-4 text-right tabular-nums">{l.amount ? `฿${fmt(l.amount)}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {detailUrl && (
        <div className="mt-2 text-right">
          <a href={detailUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-graphite hover:text-wine-red">
            Open in FlowAccount ↗
          </a>
        </div>
      )}
    </div>
  )
}

function StatusPill({ status }: { status?: string }) {
  if (!status) return <span className="text-graphite">—</span>
  const cls =
    status === 'Paid'      ? 'bg-cream text-graphite border-pale-stone' :
    status === 'Cancelled' ? 'bg-cream text-graphite border-pale-stone' :
    status === 'Overdue'   ? 'bg-wine-red/10 text-wine-red border-wine-red/40' :
                              'bg-amber-gold/10 text-deep-black border-amber-gold/40'
  return <span className={`inline-block px-2 py-0.5 text-[11px] rounded-sm border ${cls}`}>{status}</span>
}

function fmt(n: number): string {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}
