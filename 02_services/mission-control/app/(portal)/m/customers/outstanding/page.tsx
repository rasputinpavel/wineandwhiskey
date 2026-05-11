import Link from 'next/link'
import { sbInventory } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { DataFreshness } from '@/components/shell/DataFreshness'
import { fmtDate } from '@/lib/fmt'

export const dynamic = 'force-dynamic'

type SortKey = 'number' | 'customer_name' | 'issued_at' | 'due_at' | 'days_open' | 'status' | 'total'
const SORT_KEYS: SortKey[] = ['number', 'customer_name', 'issued_at', 'due_at', 'days_open', 'status', 'total']
const DEFAULT_SORT: SortKey = 'issued_at'
const DEFAULT_DIR: 'asc' | 'desc' = 'desc'

type SearchParams = {
  q?: string
  from?: string
  to?: string
  status?: 'all' | 'open' | 'overdue'
  sort?: SortKey
  dir?: 'asc' | 'desc'
}

type Invoice = {
  id: string
  number: string
  customer_id: string | null
  customer_name: string
  issued_at: string
  due_at: string | null
  status: string
  total: number
  detail_url: string | null
  // computed
  computedDue: string | null
  daysOpen: number
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

export default async function B2bPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const sp = await searchParams
  const sort: SortKey = SORT_KEYS.includes(sp.sort as SortKey) ? (sp.sort as SortKey) : DEFAULT_SORT
  const dir = sp.dir === 'asc' ? 'asc' : DEFAULT_DIR
  const statusFilter = sp.status ?? 'all'
  const q = (sp.q ?? '').trim()
  const today = new Date().toISOString().slice(0, 10)

  // Fetch all unpaid invoices, plus customer payment terms for due-date computation.
  const [invRes, custRes] = await Promise.all([
    sbInventory
      .from('flowaccount_invoice')
      .select('id, number, customer_id, customer_name, issued_at, due_at, status, total, detail_url')
      .not('status', 'in', '(Paid,Cancelled)')
      .limit(500),
    sbInventory
      .from('b2b_customer')
      .select('id, payment_terms_days'),
  ])

  if (invRes.error)  return <SchemaError error={invRes.error.message} />
  if (custRes.error) return <SchemaError error={custRes.error.message} />

  const termsByCustomer: Record<string, number> = {}
  for (const c of (custRes.data ?? []) as { id: string; payment_terms_days: number }[]) {
    termsByCustomer[c.id] = c.payment_terms_days ?? 0
  }

  // Enrich each invoice with computed due-date and days-open.
  let invoices: Invoice[] = ((invRes.data ?? []) as any[]).map(inv => {
    const terms = inv.customer_id ? termsByCustomer[inv.customer_id] ?? 0 : 0
    // ВАЖНО: FlowAccount часто возвращает due_at = '' (не null), || ловит оба случая.
    const computedDue = inv.due_at || (terms > 0 ? addDays(inv.issued_at, terms) : null)
    return {
      ...inv,
      computedDue,
      daysOpen: daysBetween(inv.issued_at, today),
    } as Invoice
  })

  // Apply filters server-side.
  if (q) {
    const lower = q.toLowerCase()
    invoices = invoices.filter(i =>
      i.number.toLowerCase().includes(lower) ||
      i.customer_name.toLowerCase().includes(lower)
    )
  }
  if (sp.from) invoices = invoices.filter(i => i.issued_at >= sp.from!)
  if (sp.to)   invoices = invoices.filter(i => i.issued_at <= sp.to!)
  if (statusFilter === 'overdue') {
    invoices = invoices.filter(i => i.computedDue && i.computedDue < today)
  } else if (statusFilter === 'open') {
    invoices = invoices.filter(i => !i.computedDue || i.computedDue >= today)
  }

  // Sort.
  invoices.sort((a, b) => {
    const av = sortValue(a, sort)
    const bv = sortValue(b, sort)
    if (av === bv) return 0
    const cmp = av < bv ? -1 : 1
    return dir === 'asc' ? cmp : -cmp
  })

  // Pull invoice lines once so the inline expansion is instant.
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

  const totalOpen    = invoices.filter(i => !i.computedDue || i.computedDue >= today).reduce((s, r) => s + Number(r.total), 0)
  const totalOverdue = invoices.filter(i =>  i.computedDue && i.computedDue < today).reduce((s, r) => s + Number(r.total), 0)

  return (
    <>
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-3">
        <h2 className="font-heading text-xl text-deep-black">B2B Outstanding</h2>
        <DataFreshness sources={['flowaccount_invoices']} />
      </div>

      {/* Summary */}
      <div className="flex gap-8 mb-6 text-sm text-graphite flex-wrap">
        <div>Open: <span className="text-deep-black font-medium tabular-nums">฿{fmt(totalOpen)}</span></div>
        <div>Overdue: <span className="text-wine-red font-medium tabular-nums">฿{fmt(totalOverdue)}</span></div>
        <div>{invoices.length} invoice(s) shown</div>
      </div>

      {/* Filter form (URL-driven) */}
      <form className="bg-warm-white border border-pale-stone rounded-md p-3 mb-6 flex flex-wrap gap-3 items-end text-xs">
        <Field label="Search (invoice # or customer)">
          <input name="q" defaultValue={q} placeholder="e.g. Fine Cusine" className={inputCls + ' w-56'} />
        </Field>
        <Field label="Issued from">
          <input type="date" name="from" defaultValue={sp.from ?? ''} className={inputCls + ' w-36'} />
        </Field>
        <Field label="Issued to">
          <input type="date" name="to" defaultValue={sp.to ?? ''} className={inputCls + ' w-36'} />
        </Field>
        <Field label="Status">
          <select name="status" defaultValue={statusFilter} className={inputCls + ' w-32'}>
            <option value="all">All outstanding</option>
            <option value="open">Open only</option>
            <option value="overdue">Overdue only</option>
          </select>
        </Field>
        {/* Preserve sort while submitting filters */}
        <input type="hidden" name="sort" value={sort} />
        <input type="hidden" name="dir" value={dir} />
        <div className="flex gap-2 ml-auto">
          <button type="submit" className="px-3 py-1.5 bg-wine-red hover:bg-burgundy-deep text-warm-white rounded-sm">
            Apply
          </button>
          <Link href="/m/customers/outstanding" className="px-3 py-1.5 border border-pale-stone hover:border-wine-red hover:text-wine-red text-graphite rounded-sm">
            Reset
          </Link>
        </div>
      </form>

      <p className="text-xs text-graphite mb-3">
        Click an invoice to see its lines · click a SKU to drill in · click column headers to sort
      </p>

      {invoices.length === 0 ? (
        <div className="text-graphite text-sm">No outstanding invoices match the filters.</div>
      ) : (
        <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
          {/* Header row — sortable */}
          <div className="grid grid-cols-[40px_140px_1fr_110px_110px_70px_110px_110px] gap-2 items-center text-[11px] py-2 px-2 border-b border-pale-stone bg-cream/40 text-graphite">
            <span />
            <SortHeader col="number"        label="Invoice #"  sort={sort} dir={dir} sp={sp} />
            <SortHeader col="customer_name" label="Customer"   sort={sort} dir={dir} sp={sp} />
            <SortHeader col="issued_at"     label="Issued"     sort={sort} dir={dir} sp={sp} />
            <SortHeader col="due_at"        label="Due"        sort={sort} dir={dir} sp={sp} />
            <SortHeader col="days_open"     label="Days"       sort={sort} dir={dir} sp={sp} align="right" />
            <SortHeader col="status"        label="Status"     sort={sort} dir={dir} sp={sp} />
            <SortHeader col="total"         label="Total"      sort={sort} dir={dir} sp={sp} align="right" />
          </div>

          {invoices.map(inv => {
            const isOverdue = !!inv.computedDue && inv.computedDue < today
            return (
              <details key={inv.id} className="group border-b border-pale-stone/40 last:border-0">
                <summary className="cursor-pointer hover:bg-cream/40 list-none">
                  <div className="grid grid-cols-[40px_140px_1fr_110px_110px_70px_110px_110px] gap-2 items-center text-[13px] py-2 px-2">
                    <span className="text-graphite text-center select-none transition-transform group-open:rotate-90">▸</span>
                    <span className="font-mono">{inv.number}</span>
                    <span className="truncate">{inv.customer_name}</span>
                    <span className="text-graphite">{fmtDate(inv.issued_at)}</span>
                    <span className={isOverdue ? 'text-wine-red font-medium' : ''}>
                      {inv.computedDue ? fmtDate(inv.computedDue) : <SetTermsHint customerId={inv.customer_id} />}
                    </span>
                    <span className="text-right tabular-nums text-graphite">{inv.daysOpen}</span>
                    <span><StatusPill status={inv.status} overdue={isOverdue} /></span>
                    <span className="text-right tabular-nums">฿{fmt(inv.total)}</span>
                  </div>
                </summary>
                <InvoiceLines lines={linesByInvoice[inv.id] ?? []} detailUrl={inv.detail_url} />
              </details>
            )
          })}
        </div>
      )}
    </>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────

const inputCls = 'border border-pale-stone bg-warm-white px-2 py-1 rounded-sm focus:outline-none focus:border-wine-red'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="overline text-graphite">{label}</span>
      {children}
    </label>
  )
}

function SortHeader({
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
  for (const [k, v] of Object.entries(sp)) {
    if (v !== undefined && v !== '') params.set(k, String(v))
  }
  params.set('sort', col)
  params.set('dir', nextDir)
  const arrow = !isActive ? ' ↕' : (dir === 'asc' ? ' ↑' : ' ↓')

  return (
    <Link
      href={`?${params.toString()}`}
      className={`overline ${align === 'right' ? 'text-right' : 'text-left'} ${isActive ? 'text-wine-red' : 'text-graphite hover:text-deep-black'}`}
    >
      {label}{arrow}
    </Link>
  )
}

function SetTermsHint({ customerId }: { customerId: string | null }) {
  if (!customerId) return <span className="text-graphite">—</span>
  return (
    <Link href="/m/inventory/customers" className="text-graphite italic hover:text-wine-red text-xs">
      set terms
    </Link>
  )
}

function InvoiceLines({ lines, detailUrl }: { lines: Line[]; detailUrl: string | null }) {
  if (lines.length === 0) {
    return (
      <div className="px-12 py-3 text-xs text-graphite bg-cream/30">
        Нет позиций — возможно, инвойс ещё не разобран.
        {detailUrl && <a href={detailUrl} target="_blank" className="text-wine-red hover:underline ml-1">Открыть в FlowAccount ↗</a>}
      </div>
    )
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

function StatusPill({ status, overdue }: { status?: string; overdue?: boolean }) {
  const display = overdue ? 'Overdue' : (status ?? '—')
  const cls = overdue
    ? 'bg-wine-red/10 text-wine-red border-wine-red/40'
    : 'bg-amber-gold/10 text-deep-black border-amber-gold/40'
  return <span className={`inline-block px-2 py-0.5 text-[11px] rounded-sm border ${cls}`}>{display}</span>
}

function sortValue(inv: Invoice, key: SortKey): string | number {
  switch (key) {
    case 'number':        return inv.number
    case 'customer_name': return inv.customer_name.toLowerCase()
    case 'issued_at':     return inv.issued_at
    case 'due_at':        return inv.computedDue ?? '9999-12-31'  // unset terms sort to the end
    case 'days_open':     return inv.daysOpen
    case 'status':        return inv.status
    case 'total':         return Number(inv.total)
  }
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO).getTime()
  const b = new Date(toISO).getTime()
  return Math.max(0, Math.round((b - a) / (24 * 60 * 60 * 1000)))
}

function fmt(n: number): string {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}
