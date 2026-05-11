import Link from 'next/link'
import { sbInventory, type FlowInvoice } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { InvoiceExcludeCell } from '@/components/modules/customers/InvoiceExcludeCell'
import { DataFreshness } from '@/components/shell/DataFreshness'
import { fmtDate } from '@/lib/fmt'

export const dynamic = 'force-dynamic'

type SearchParams = {
  month?:    string                 // YYYY-MM, default = current
  status?:   'all' | 'paid' | 'unpaid' | 'overdue' | 'cancelled'
  excluded?: 'all' | 'yes' | 'no'
  q?:        string
}

function bangkokYM(): string {
  const d = new Date(Date.now() + 7 * 3600_000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export default async function TaxInvoicesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const month = (sp.month && /^\d{4}-\d{2}$/.test(sp.month)) ? sp.month : bangkokYM()
  const statusFilter = sp.status   ?? 'all'
  const excFilter    = sp.excluded ?? 'no'    // дефолтом скрываем кривые
  const q = (sp.q ?? '').trim()

  // Month bounds
  const [y, m] = month.split('-').map(Number)
  const from = `${y}-${String(m).padStart(2, '0')}-01`
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  // Fetch invoices issued in month + customer terms for due-date computation
  const [invRes, custRes] = await Promise.all([
    sbInventory
      .from('flowaccount_invoice')
      .select('id, number, customer_id, customer_name, issued_at, due_at, status, total, detail_url, excluded')
      .gte('issued_at', from)
      .lte('issued_at', to)
      .order('issued_at', { ascending: false })
      .limit(500),
    sbInventory
      .from('b2b_customer')
      .select('id, payment_terms_days'),
  ])
  if (invRes.error)  return <div className="p-6"><SchemaError error={invRes.error.message} /></div>
  if (custRes.error) return <div className="p-6"><SchemaError error={custRes.error.message} /></div>

  const termsByCustomer: Record<string, number> = {}
  for (const c of (custRes.data ?? []) as { id: string; payment_terms_days: number }[]) {
    termsByCustomer[c.id] = c.payment_terms_days ?? 0
  }

  const today = new Date().toISOString().slice(0, 10)

  let invoices = ((invRes.data ?? []) as FlowInvoice[]).map(inv => {
    const terms = inv.customer_id ? termsByCustomer[inv.customer_id] ?? 0 : 0
    const computedDue = inv.due_at || (terms > 0 && inv.issued_at ? addDays(inv.issued_at, terms) : null)
    const overdue = !!(computedDue && computedDue < today && inv.status !== 'Paid' && inv.status !== 'Cancelled')
    return { ...inv, computedDue, overdue }
  })

  // Filters
  if (statusFilter !== 'all') {
    if (statusFilter === 'overdue') {
      invoices = invoices.filter(i => i.overdue)
    } else {
      const want = statusFilter[0].toUpperCase() + statusFilter.slice(1)
      invoices = invoices.filter(i => i.status === want)
    }
  }
  if (excFilter !== 'all') {
    invoices = invoices.filter(i => excFilter === 'yes' ? i.excluded : !i.excluded)
  }
  if (q) {
    const lower = q.toLowerCase()
    invoices = invoices.filter(i =>
      i.number.toLowerCase().includes(lower) ||
      i.customer_name.toLowerCase().includes(lower)
    )
  }

  // Aggregate
  const grand     = invoices.reduce((s, i) => s + Number(i.total ?? 0), 0)
  const paidSum   = invoices.filter(i => i.status === 'Paid').reduce((s, i) => s + Number(i.total ?? 0), 0)
  const overdueSum= invoices.filter(i => i.overdue).reduce((s, i) => s + Number(i.total ?? 0), 0)
  const unpaidSum = grand - paidSum

  // Month picker — 18 months back
  const months: string[] = []
  let py = y, pm = m
  for (let i = 0; i < 18; i++) {
    months.push(`${py}-${String(pm).padStart(2, '0')}`)
    pm--; if (pm < 1) { pm = 12; py-- }
  }

  return (
    <>
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-3">
        <h2 className="font-heading text-xl text-deep-black">Tax Invoices — {monthLabel(month)}</h2>
        <DataFreshness sources={['flowaccount_invoices']} />
      </div>
          <p className="text-graphite text-sm mb-4 max-w-3xl">
            Tax invoices от B2B клиентов за месяц (по дате выставления). Статусы — из FlowAccount;
            <span className="text-deep-black"> Overdue</span> вычисляется локально: due-date {'<'} сегодня и не Paid.
            Кривые записи можно скрыть toggle-ом <span className="text-deep-black">excluded</span> — sync FA не вернёт их.
          </p>

          {/* KPI */}
          <div className="grid grid-cols-4 gap-3 mb-4">
            <KPI label="Все"        value={`฿${fmt(grand)}`}    note={`${invoices.length} штук`} />
            <KPI label="Paid"       value={`฿${fmt(paidSum)}`}  note={`${invoices.filter(i => i.status === 'Paid').length} шт.`} highlight />
            <KPI label="Unpaid"     value={`฿${fmt(unpaidSum)}`} note="ещё не закрыты" />
            <KPI label="Overdue"    value={`฿${fmt(overdueSum)}`} note="просрочены" muted />
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3 mb-4 flex-wrap text-xs">
            <form className="flex items-center gap-2">
              <input type="search" name="q" defaultValue={q}
                placeholder="invoice # or customer…"
                className="px-2 py-1 border border-pale-stone bg-warm-white rounded-sm text-xs w-56 focus:outline-none focus:border-wine-red" />
              {month && <input type="hidden" name="month" value={month} />}
              {statusFilter !== 'all' && <input type="hidden" name="status" value={statusFilter} />}
              {excFilter !== 'no' && <input type="hidden" name="excluded" value={excFilter} />}
              <button className="px-3 py-1 bg-wine-red text-warm-white rounded-sm text-xs">Search</button>
            </form>
            <FilterPills label="Status" current={statusFilter}
              options={['all', 'paid', 'unpaid', 'overdue', 'cancelled']}
              keep={{ month, q, excluded: excFilter }} paramKey="status" />
            <FilterPills label="Excluded" current={excFilter}
              options={['no', 'yes', 'all']}
              keep={{ month, q, status: statusFilter }} paramKey="excluded" />
          </div>

          {/* Month link grid */}
          <div className="flex gap-1 mb-4 text-[11px] flex-wrap">
            {months.slice(0, 12).map(mm => (
              <Link key={mm}
                href={`/m/customers/tax-invoices?month=${mm}`}
                className={`px-2 py-1 rounded-sm border transition-colors ${
                  mm === month
                    ? 'bg-wine-red text-warm-white border-wine-red'
                    : 'bg-warm-white text-graphite border-pale-stone hover:border-wine-red hover:text-wine-red'
                }`}>
                {monthLabel(mm)}
              </Link>
            ))}
          </div>

          {/* Table */}
          <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
            <table className="w-full text-[13px]">
              <thead className="text-graphite border-b border-pale-stone bg-cream/40">
                <tr>
                  <th className="text-left py-2 px-4 font-medium">Invoice #</th>
                  <th className="text-left py-2 px-4 font-medium">Issued</th>
                  <th className="text-left py-2 px-4 font-medium">Customer</th>
                  <th className="text-left py-2 px-4 font-medium">Due</th>
                  <th className="text-left py-2 px-4 font-medium">Status</th>
                  <th className="text-right py-2 px-4 font-medium">Total</th>
                  <th className="text-left py-2 px-4 font-medium">Excluded</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(i => (
                  <tr key={i.id} className={`border-b border-pale-stone/40 last:border-0 hover:bg-cream/40 ${i.excluded ? 'opacity-50' : ''}`}>
                    <td className="py-2 px-4 font-mono">
                      {i.detail_url
                        ? <a href={i.detail_url} target="_blank" rel="noreferrer" className="text-wine-red hover:underline">{i.number}</a>
                        : i.number}
                    </td>
                    <td className="py-2 px-4 text-graphite text-xs">{fmtDate(i.issued_at)}</td>
                    <td className="py-2 px-4">
                      {i.customer_id
                        ? <Link href={`/m/customers/${i.customer_id}`} className="hover:text-wine-red">{i.customer_name}</Link>
                        : i.customer_name}
                    </td>
                    <td className={`py-2 px-4 text-xs ${i.overdue ? 'text-wine-red font-medium' : 'text-graphite'}`}>
                      {fmtDate(i.computedDue)}
                    </td>
                    <td className="py-2 px-4">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-sm border ${
                        i.status === 'Paid'      ? 'bg-amber-gold/20 text-deep-black border-amber-gold/60' :
                        i.status === 'Cancelled' ? 'bg-cream text-graphite border-pale-stone' :
                        i.overdue                ? 'bg-wine-red/10 text-wine-red border-wine-red/40' :
                                                   'bg-cream text-graphite border-pale-stone'
                      }`}>
                        {i.overdue && i.status !== 'Paid' && i.status !== 'Cancelled' ? 'Overdue' : i.status}
                      </span>
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums">฿{fmt(Number(i.total ?? 0))}</td>
                    <td className="py-2 px-4"><InvoiceExcludeCell invoiceId={i.id} initial={i.excluded ?? false} /></td>
                  </tr>
                ))}
                {invoices.length === 0 && (
                  <tr><td colSpan={7} className="py-6 text-center text-graphite text-sm">
                    Нет инвойсов в {monthLabel(month)} с текущими фильтрами.
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

function addDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const RU_MONTHS = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек']
function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${RU_MONTHS[m - 1]} ${y}`
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

function FilterPills({ label, current, options, keep, paramKey }: {
  label: string
  current: string
  options: readonly string[]
  keep: Record<string, string>
  paramKey: string
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-graphite">{label}:</span>
      <div className="flex gap-1">
        {options.map(o => {
          const params = new URLSearchParams()
          for (const [k, v] of Object.entries(keep)) {
            // 'excluded' default = 'no', не пишем в URL когда оно дефолтное
            if (!v) continue
            if (k === 'excluded' && v === 'no') continue
            if (v === 'all') continue
            params.set(k, v)
          }
          if (o !== 'all') params.set(paramKey, o)
          // 'excluded' default = 'no' — пишем явно только если выбран не дефолт
          if (paramKey === 'excluded' && o === 'no') params.delete('excluded')
          const qs = params.toString()
          const active = current === o
          return (
            <Link key={o}
              href={qs ? `/m/customers/tax-invoices?${qs}` : '/m/customers/tax-invoices'}
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
