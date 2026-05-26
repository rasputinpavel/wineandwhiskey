import Link from 'next/link'
import { sbInventory, sbPublic, type PurchaseOrder, type Supplier } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { CashflowOverrideCell } from '@/components/modules/purchases/POExcludeCell'
import { PaidAtCell } from '@/components/modules/purchases/PaidAtCell'
import { DocsUrlCell } from '@/components/modules/purchases/DocsUrlCell'
import { DataFreshness } from '@/components/shell/DataFreshness'
import { fmtDate } from '@/lib/fmt'
import { computeDueDate } from '@/lib/kpi'

export const dynamic = 'force-dynamic'

type SearchParams = {
  paid?: 'all' | 'yes' | 'no'
  status?: 'all' | 'closed' | 'draft'
}

export default async function SupplierDetail({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<SearchParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const paidFilter   = sp.paid   ?? 'all'
  const statusFilter = sp.status ?? 'closed'

  const { data: sup, error: supErr } = await sbInventory
    .from('supplier')
    .select('id, name, type, payment_terms_days, notes')
    .eq('id', id)
    .maybeSingle()
  if (supErr) return <SchemaError error={supErr.message} />
  if (!sup)   return <div className="text-graphite">Supplier not found.</div>
  const s = sup as Supplier

  // Match POs by supplier name (purchase_orders.supplier is a text column scraped from Loyverse,
  // not a FK to inventory.supplier).
  const { data: poRows, error: poErr } = await sbPublic
    .from('purchase_orders')
    .select('id,po_number,order_date,total_thb,status,url,cashflow_override,paid_at,docs_url,supplier')
    .eq('supplier', s.name)
    .order('order_date', { ascending: false })
    .limit(500)
  if (poErr) return <SchemaError error={poErr.message} />

  let pos = (poRows ?? []) as PurchaseOrder[]
  if (statusFilter !== 'all') {
    const want = statusFilter === 'closed' ? 'closed' : 'draft'
    pos = pos.filter(p => (p.status ?? '').toLowerCase() === want)
  }
  if (paidFilter !== 'all') {
    pos = pos.filter(p => paidFilter === 'yes' ? p.paid_at != null : p.paid_at == null)
  }

  // Cashflow inclusion: override='exclude' → out, override='include' → in,
  // override='auto' → follow supplier type. Consignment suppliers always
  // out (accrual-based in pulse), override is ignored for them.
  function includedInCashflow(p: PurchaseOrder): boolean {
    if (s.type === 'consignment') return false
    if (p.cashflow_override === 'exclude') return false
    if (p.cashflow_override === 'include') return true
    return true
  }

  // Aggregate (across filtered POs)
  const grand    = pos.reduce((a, p) => a + Number(p.total_thb ?? 0), 0)
  const inflow   = pos.filter(includedInCashflow).reduce((a, p) => a + Number(p.total_thb ?? 0), 0)
  const paidSum  = pos.filter(p => p.paid_at != null).reduce((a, p) => a + Number(p.total_thb ?? 0), 0)
  const openSum  = grand - paidSum

  return (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <Link href="/m/suppliers" className="text-xs text-graphite hover:text-wine-red">← Back to suppliers</Link>
          <h2 className="font-heading text-2xl text-deep-black mt-3">{s.name}</h2>
          <div className="text-xs text-graphite mt-1">
            <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded-sm border mr-2 ${
              s.type === 'consignment' ? 'bg-amber-gold/20 text-deep-black border-amber-gold/60' :
              s.type === 'mix'         ? 'bg-wine-red/10 text-wine-red border-wine-red/40' :
                                         'bg-cream text-graphite border-pale-stone'
            }`}>{s.type}</span>
            Terms {s.payment_terms_days} days
            {s.notes && <span className="ml-3">· {s.notes}</span>}
          </div>
        </div>
        <DataFreshness sources={['purchase_orders']} />
      </div>

      {/* Sub-tabs */}
      <nav className="border-b border-pale-stone mb-5 flex gap-1 text-sm">
        <span className="px-3 py-1.5 -mb-px border-b-2 border-wine-red text-wine-red">Purchase Orders</span>
        {(s.type === 'consignment' || s.type === 'mix') && (
          <>
            <Link
              href={`/m/suppliers/${s.id}/consignment`}
              className="px-3 py-1.5 -mb-px border-b-2 border-transparent text-graphite hover:text-wine-red hover:border-pale-stone"
            >
              Consignment prices
            </Link>
            <Link
              href={`/m/suppliers/${s.id}/report`}
              className="px-3 py-1.5 -mb-px border-b-2 border-transparent text-graphite hover:text-wine-red hover:border-pale-stone"
            >
              Monthly report
            </Link>
          </>
        )}
      </nav>

      {/* KPI */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <KPI label="All POs"      value={`฿${fmt(grand)}`}  note={`${pos.length} штук`} />
        <KPI label="В cashflow"   value={`฿${fmt(inflow)}`} note="auto + force-include" highlight />
        <KPI label="Уже оплачено" value={`฿${fmt(paidSum)}`} note={`${pos.filter(p => p.paid_at != null).length} PO с paid_at`} />
        <KPI label="Не оплачено"  value={`฿${fmt(openSum)}`} note={`${pos.filter(p => p.paid_at == null).length} PO без paid_at`} muted />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap text-xs">
        <FilterPills label="Status" current={statusFilter}
          options={['all', 'closed', 'draft']} keep={{ paid: paidFilter }} paramKey="status" supId={id} />
        <FilterPills label="Paid" current={paidFilter}
          options={['all', 'yes', 'no']} keep={{ status: statusFilter }} paramKey="paid" supId={id} />
      </div>

      {/* PO table */}
      <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="text-graphite border-b border-pale-stone bg-cream/40">
            <tr>
              <th className="text-left py-2 px-4 font-medium">PO</th>
              <th className="text-left py-2 px-4 font-medium">Date</th>
              <th className="text-right py-2 px-4 font-medium">Total</th>
              <th className="text-left py-2 px-4 font-medium">Status</th>
              <th className="text-left py-2 px-4 font-medium">Cashflow</th>
              <th className="text-left py-2 px-4 font-medium">Paid</th>
              <th className="text-left py-2 px-4 font-medium">Docs</th>
            </tr>
          </thead>
          <tbody>
            {pos.map(p => {
              const dimmed = !includedInCashflow(p)
              const projected = !p.paid_at && p.order_date && s.type !== 'consignment'
                ? computeDueDate(p.order_date, s.payment_terms_days ?? 0)
                : null
              return (
                <tr key={p.id} className={`border-b border-pale-stone/40 last:border-0 hover:bg-cream/40 ${dimmed ? 'opacity-70' : ''}`}>
                  <td className="py-2 px-4 font-mono">
                    {p.url
                      ? <a href={p.url} target="_blank" rel="noreferrer" className="text-wine-red hover:underline">{p.po_number}</a>
                      : p.po_number}
                  </td>
                  <td className="py-2 px-4 text-graphite text-xs">{fmtDate(p.order_date)}</td>
                  <td className="py-2 px-4 text-right tabular-nums">{p.total_thb ? `฿${fmt(p.total_thb)}` : '—'}</td>
                  <td className="py-2 px-4 text-graphite text-xs">{p.status ?? '—'}</td>
                  <td className="py-2 px-4"><CashflowOverrideCell poId={p.id} initial={p.cashflow_override} /></td>
                  <td className="py-2 px-4">
                    <PaidAtCell poId={p.id} initial={p.paid_at} />
                    {projected && (
                      <div className="text-[10px] text-graphite/70 mt-0.5">
                        proj. {fmtDate(projected)}
                      </div>
                    )}
                  </td>
                  <td className="py-2 px-4"><DocsUrlCell poId={p.id} initial={p.docs_url} /></td>
                </tr>
              )
            })}
            {pos.length === 0 && (
              <tr><td colSpan={7} className="py-6 text-center text-graphite text-sm">
                У этого поставщика нет PO с текущими фильтрами.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

function fmt(n: number): string {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function KPI({ label, value, note, highlight, muted }: { label: string; value: string; note?: string; highlight?: boolean; muted?: boolean }) {
  return (
    <div className={`px-4 py-3 rounded-md border ${
      highlight ? 'bg-wine-red text-warm-white border-wine-red'
                : muted ? 'bg-cream text-graphite border-pale-stone'
                        : 'bg-warm-white border-pale-stone'
    }`}>
      <div className={`text-[10px] uppercase tracking-wide ${highlight ? 'opacity-80' : 'text-graphite'}`}>{label}</div>
      <div className={`text-lg font-medium tabular-nums ${highlight ? '' : 'text-deep-black'}`}>{value}</div>
      {note && <div className={`text-[11px] ${highlight ? 'opacity-70' : 'text-graphite/70'}`}>{note}</div>}
    </div>
  )
}

function FilterPills({ label, current, options, keep, paramKey, supId }: {
  label: string
  current: string
  options: readonly string[]
  keep: Record<string, string>
  paramKey: string
  supId: string
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-graphite">{label}:</span>
      <div className="flex gap-1">
        {options.map(o => {
          const params = new URLSearchParams()
          for (const [k, v] of Object.entries(keep)) if (v && v !== 'all') params.set(k, v)
          if (o !== 'all') params.set(paramKey, o)
          const qs = params.toString()
          const active = current === o
          return (
            <Link key={o}
              href={qs ? `/m/suppliers/${supId}?${qs}` : `/m/suppliers/${supId}`}
              className={`px-2 py-0.5 rounded-sm border transition-colors ${
                active
                  ? 'bg-wine-red text-warm-white border-wine-red'
                  : 'bg-warm-white text-graphite border-pale-stone hover:border-wine-red hover:text-wine-red'
              }`}>
              {o}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
