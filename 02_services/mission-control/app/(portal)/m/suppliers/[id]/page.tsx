import Link from 'next/link'
import { sbInventory, sbPublic, type PurchaseOrder, type Supplier } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { CashflowOverrideCell } from '@/components/modules/purchases/POExcludeCell'
import { DataFreshness } from '@/components/shell/DataFreshness'
import { fmtDate } from '@/lib/fmt'
import { computeDueDate, daysBetween, todayBkk } from '@/lib/kpi'

export const dynamic = 'force-dynamic'

type SortKey = 'po_number' | 'order_date' | 'total_thb' | 'status' | 'paid_at'
type SortDir = 'asc' | 'desc'

type SearchParams = {
  paid?: 'all' | 'yes' | 'no'
  status?: 'all' | 'closed' | 'pending'
  sort?: SortKey
  dir?: SortDir
}

const SORT_KEYS: readonly SortKey[] = ['po_number', 'order_date', 'total_thb', 'status', 'paid_at']
// Dates and money default to newest/largest first; text defaults to A→Z.
function defaultDir(key: SortKey): SortDir {
  return key === 'po_number' || key === 'status' ? 'asc' : 'desc'
}
function dateVal(v: string | null | undefined): number {
  if (!v) return -Infinity
  const t = Date.parse(v)
  return Number.isNaN(t) ? -Infinity : t
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
  // Показываем все PO по умолчанию, включая pending: заказ размещён — обязательство
  // уже есть. Фильтр по статусу остаётся, но как выбор, а не как скрытая отсечка.
  const statusFilter = sp.status ?? 'all'
  const sortKey: SortKey = SORT_KEYS.includes(sp.sort as SortKey) ? (sp.sort as SortKey) : 'order_date'
  const sortDir: SortDir = sp.dir === 'asc' || sp.dir === 'desc' ? sp.dir : defaultDir(sortKey)

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
    // В Loyverse встречаются только Closed и Pending (в обоих регистрах).
    pos = pos.filter(p => (p.status ?? '').toLowerCase() === statusFilter)
  }
  if (paidFilter !== 'all') {
    pos = pos.filter(p => paidFilter === 'yes' ? p.paid_at != null : p.paid_at == null)
  }

  function sortCmp(a: PurchaseOrder, b: PurchaseOrder): number {
    switch (sortKey) {
      case 'total_thb':  return Number(a.total_thb ?? 0) - Number(b.total_thb ?? 0)
      case 'order_date': return dateVal(a.order_date) - dateVal(b.order_date)
      case 'paid_at':    return dateVal(a.paid_at)    - dateVal(b.paid_at)
      case 'po_number':  return (a.po_number ?? '').localeCompare(b.po_number ?? '', undefined, { numeric: true })
      case 'status':     return (a.status ?? '').localeCompare(b.status ?? '')
    }
  }
  pos = [...pos].sort((a, b) => sortDir === 'asc' ? sortCmp(a, b) : -sortCmp(a, b))

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
  const today = todayBkk()

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
              href={`/m/suppliers/${s.id}/deliveries`}
              className="px-3 py-1.5 -mb-px border-b-2 border-transparent text-graphite hover:text-wine-red hover:border-pale-stone"
            >
              Deliveries
            </Link>
            <Link
              href={`/m/suppliers/${s.id}/buyouts`}
              className="px-3 py-1.5 -mb-px border-b-2 border-transparent text-graphite hover:text-wine-red hover:border-pale-stone"
            >
              Buyouts
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

      <p className="text-graphite/80 text-xs mb-4">
        Оплаты отмечаются в{' '}
        <Link href="/m/payment-calendar" className="text-wine-red hover:underline">Payment Calendar</Link>
        {' '}— здесь статус показан только для справки.
      </p>

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
          options={['all', 'closed', 'pending']} keep={{ paid: paidFilter, sort: sortKey, dir: sortDir }} paramKey="status" supId={id} />
        <FilterPills label="Paid" current={paidFilter}
          options={['all', 'yes', 'no']} keep={{ status: statusFilter, sort: sortKey, dir: sortDir }} paramKey="paid" supId={id} />
      </div>

      {/* PO table */}
      <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="text-graphite border-b border-pale-stone bg-cream/40">
            <tr>
              <SortHeader label="PO"     sortKey="po_number"  current={sortKey} dir={sortDir} keep={{ status: statusFilter, paid: paidFilter }} supId={id} />
              <SortHeader label="Date"   sortKey="order_date" current={sortKey} dir={sortDir} keep={{ status: statusFilter, paid: paidFilter }} supId={id} />
              <SortHeader label="Total"  sortKey="total_thb"  current={sortKey} dir={sortDir} keep={{ status: statusFilter, paid: paidFilter }} supId={id} align="right" />
              <SortHeader label="Status" sortKey="status"     current={sortKey} dir={sortDir} keep={{ status: statusFilter, paid: paidFilter }} supId={id} />
              <th className="text-left py-2 px-4 font-medium">Cashflow</th>
              <SortHeader label="Paid"   sortKey="paid_at"    current={sortKey} dir={sortDir} keep={{ status: statusFilter, paid: paidFilter }} supId={id} />
              <th className="text-left py-2 px-4 font-medium">Docs</th>
            </tr>
          </thead>
          <tbody>
            {pos.map(p => {
              const dimmed = !includedInCashflow(p)
              const payable = s.type !== 'consignment' && includedInCashflow(p) && !!p.order_date
              const due = !p.paid_at && payable ? computeDueDate(p.order_date!, s.payment_terms_days ?? 0) : null
              const dDue = due ? daysBetween(due, today) : null
              const rowTone = p.paid_at != null
                ? 'bg-emerald-600/[0.07] border-l-2 border-l-emerald-600/50'
                : dDue != null && dDue < 0  ? 'bg-wine-red/[0.05] border-l-2 border-l-wine-red/60'
                : dDue != null && dDue === 0 ? 'bg-amber-gold/[0.10] border-l-2 border-l-amber-gold'
                : ''
              return (
                <tr key={p.id} className={`border-b border-pale-stone/40 last:border-0 hover:bg-cream/40 ${rowTone} ${dimmed ? 'opacity-70' : ''}`}>
                  <td className="py-2 px-4 font-mono">
                    {p.url
                      ? <a href={p.url} target="_blank" rel="noreferrer" className="text-wine-red hover:underline">{p.po_number}</a>
                      : p.po_number}
                  </td>
                  <td className="py-2 px-4 text-graphite text-xs">{fmtDate(p.order_date)}</td>
                  <td className="py-2 px-4 text-right tabular-nums">{p.total_thb ? `฿${fmt(p.total_thb)}` : '—'}</td>
                  <td className="py-2 px-4 text-graphite text-xs">{p.status ?? '—'}</td>
                  <td className="py-2 px-4"><CashflowOverrideCell poId={p.id} initial={p.cashflow_override} /></td>
                  <td className="py-2 px-4 whitespace-nowrap text-xs">
                    {p.paid_at != null
                      ? <span className="text-emerald-700">{fmtDate(p.paid_at)}<span className="text-graphite/70"> · оплачено</span></span>
                      : due
                        ? <span>{fmtDate(due)}{' '}
                            <span className={dDue! < 0 ? 'text-wine-red' : dDue === 0 ? 'text-deep-black' : 'text-graphite/70'}>
                              {dDue! < 0 ? `· просрочено ${-dDue!} дн` : dDue === 0 ? '· сегодня' : `· через ${dDue} дн`}
                            </span>
                          </span>
                        : <span className="text-graphite/50">—</span>}
                  </td>
                  <td className="py-2 px-4">
                    {p.docs_url
                      ? <a href={p.docs_url} target="_blank" rel="noreferrer" className="text-wine-red hover:underline text-xs">docs ↗</a>
                      : <span className="text-graphite/50">—</span>}
                  </td>
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

function SortHeader({ label, sortKey, current, dir, keep, supId, align }: {
  label: string
  sortKey: SortKey
  current: SortKey
  dir: SortDir
  keep: Record<string, string>
  supId: string
  align?: 'left' | 'right'
}) {
  const active = current === sortKey
  const nextDir: SortDir = active ? (dir === 'asc' ? 'desc' : 'asc') : defaultDir(sortKey)
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(keep)) if (v && v !== 'all') params.set(k, v)
  params.set('sort', sortKey)
  params.set('dir', nextDir)
  const arrow = active ? (dir === 'asc' ? ' ↑' : ' ↓') : ''
  return (
    <th className={`${align === 'right' ? 'text-right' : 'text-left'} py-2 px-4 font-medium`}>
      <Link
        href={`/m/suppliers/${supId}?${params.toString()}`}
        className={`inline-flex items-center gap-0.5 hover:text-wine-red ${active ? 'text-wine-red' : ''}`}
      >
        {label}<span className="tabular-nums">{arrow}</span>
      </Link>
    </th>
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
