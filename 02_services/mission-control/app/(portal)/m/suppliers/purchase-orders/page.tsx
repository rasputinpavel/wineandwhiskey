import Link from 'next/link'
import { sbInventory, sbPublic, type PurchaseOrder, type Supplier } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { CashflowOverrideCell } from '@/components/modules/purchases/POExcludeCell'
import { PaidAtCell } from '@/components/modules/purchases/PaidAtCell'
import { DocsUrlCell } from '@/components/modules/purchases/DocsUrlCell'
import { DataFreshness } from '@/components/shell/DataFreshness'
import { fmtDate } from '@/lib/fmt'
import { computeDueDate, todayBkk, daysBetween } from '@/lib/kpi'

export const dynamic = 'force-dynamic'

type SearchParams = {
  month?:    string         // YYYY-MM, default = current
  type?:     'all' | 'regular' | 'consignment' | 'mix'
  status?:   'all' | 'closed' | 'draft'
  paid?:     'all' | 'yes' | 'no'
}

function bangkokYM(): string {
  const d = new Date(Date.now() + 7 * 3600_000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const month = (sp.month && /^\d{4}-\d{2}$/.test(sp.month)) ? sp.month : bangkokYM()
  const typeFilter   = sp.type     ?? 'all'
  const statusFilter = sp.status   ?? 'closed'
  const paidFilter   = sp.paid     ?? 'all'

  // Month bounds
  const [y, m] = month.split('-').map(Number)
  const from = `${y}-${String(m).padStart(2, '0')}-01`
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  // Fetch POs in month
  const { data: poRows, error: poErr } = await sbPublic
    .from('purchase_orders')
    .select('id,po_number,order_date,supplier,total_thb,status,url,cashflow_override,paid_at,docs_url')
    .gte('order_date', from)
    .lte('order_date', to)
    .order('order_date', { ascending: false })
  if (poErr) {
    return <div className="p-6"><SchemaError error={poErr.message} /></div>
  }

  // Fetch suppliers for type lookup
  const { data: supRows } = await sbInventory
    .from('supplier')
    .select('name,type,payment_terms_days')
  const metaByName = new Map<string, { type: Supplier['type']; terms: number }>()
  for (const s of (supRows ?? []) as Supplier[]) {
    metaByName.set(s.name.trim().toLowerCase(), { type: s.type, terms: s.payment_terms_days ?? 0 })
  }
  function supType(name: string | null): Supplier['type'] {
    return metaByName.get((name ?? '').trim().toLowerCase())?.type ?? 'regular'
  }
  function termsFor(name: string | null): number {
    return metaByName.get((name ?? '').trim().toLowerCase())?.terms ?? 0
  }

  let pos = (poRows ?? []) as PurchaseOrder[]
  if (typeFilter !== 'all') pos = pos.filter(p => supType(p.supplier) === typeFilter)
  if (statusFilter !== 'all') {
    const want = statusFilter === 'closed' ? 'closed' : 'draft'
    pos = pos.filter(p => (p.status ?? '').toLowerCase() === want)
  }
  if (paidFilter !== 'all') {
    pos = pos.filter(p => paidFilter === 'yes' ? p.paid_at != null : p.paid_at == null)
  }

  // Effective cashflow inclusion: override='exclude' → out, override='include' → in,
  // override='auto' → follow supplier type (consignment → out).
  function includedInCashflow(p: PurchaseOrder): boolean {
    if (p.cashflow_override === 'exclude') return false
    if (p.cashflow_override === 'include') return true
    return supType(p.supplier) !== 'consignment'
  }

  // Aggregate
  const grand    = pos.reduce((s, p) => s + Number(p.total_thb ?? 0), 0)
  const inflow   = pos.filter(includedInCashflow).reduce((s, p) => s + Number(p.total_thb ?? 0), 0)
  const outflow  = grand - inflow
  const paidSum  = pos.filter(p => p.paid_at != null).reduce((s, p) => s + Number(p.total_thb ?? 0), 0)

  // Сегодня (Bangkok) — для подсветки строк по сроку платежа. Сам платёжный
  // календарь вынесен в отдельный пункт Operations → Payment Calendar.
  const today = todayBkk()

  // Month picker — 18 месяцев назад от ТЕКУЩЕГО (Bangkok), а не от выбранного,
  // иначе при переключении в прошлый месяц текущий уезжает за край ленты.
  const months: string[] = []
  const [curY, curM] = bangkokYM().split('-').map(Number)
  let py = curY, pm = curM
  for (let i = 0; i < 18; i++) {
    months.push(`${py}-${String(pm).padStart(2, '0')}`)
    pm--; if (pm < 1) { pm = 12; py-- }
  }

  return (
    <>
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-3">
        <h2 className="font-heading text-xl text-deep-black">Purchase Orders — {monthLabel(month)}</h2>
        <DataFreshness sources={['purchase_orders']} />
      </div>
          <p className="text-graphite text-sm mb-4 max-w-3xl">
            Закрытые PO из Loyverse. По умолчанию <span className="text-deep-black">auto</span> следует типу поставщика
            (consignment не идёт в cashflow). <span className="text-deep-black">force include</span> — учесть несмотря на
            тип (PO от поставщика-реализатора, проданный нам нормальным счётом).
            <span className="text-deep-black"> force exclude</span> — выкинуть (криво заведённая запись).
            Paid + Docs — для отметки фактической оплаты и ссылки на Drive с tax invoice + receipt.
          </p>

          {/* KPI */}
          <div className="grid grid-cols-4 gap-3 mb-4">
            <KPI label="Все PO"      value={`฿${fmt(grand)}`}    note={`${pos.length} штук`} />
            <KPI label="В cashflow"  value={`฿${fmt(inflow)}`}   note="идёт в P&L (со сдвигом −1 мес.)" highlight />
            <KPI label="Не в cashflow" value={`−฿${fmt(outflow)}`} note="консигнация + force-exclude" muted />
            <KPI label="Уже оплачено" value={`฿${fmt(paidSum)}`} note={`${pos.filter(p => p.paid_at != null).length} PO с paid_at`} />
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3 mb-4 flex-wrap text-xs">
            <FilterPills
              label="Type"
              current={typeFilter}
              options={['all', 'regular', 'consignment', 'mix']}
              keep={{ month, status: statusFilter, paid: paidFilter }}
              paramKey="type"
            />
            <FilterPills
              label="Status"
              current={statusFilter}
              options={['all', 'closed', 'draft']}
              keep={{ month, type: typeFilter, paid: paidFilter }}
              paramKey="status"
            />
            <FilterPills
              label="Paid"
              current={paidFilter}
              options={['all', 'yes', 'no']}
              keep={{ month, type: typeFilter, status: statusFilter }}
              paramKey="paid"
            />
          </div>

          {/* Month link grid (since onChange doesn't work in server component) */}
          <div className="flex gap-1 mb-4 text-[11px] flex-wrap">
            {months.slice(0, 12).map(mm => (
              <Link key={mm}
                href={`/m/suppliers/purchase-orders?month=${mm}`}
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
                  <th className="text-left py-2 px-4 font-medium">PO</th>
                  <th className="text-left py-2 px-4 font-medium">Date</th>
                  <th className="text-left py-2 px-4 font-medium">Supplier</th>
                  <th className="text-left py-2 px-4 font-medium">Type</th>
                  <th className="text-right py-2 px-4 font-medium">Total</th>
                  <th className="text-left py-2 px-4 font-medium">Cashflow</th>
                  <th className="text-left py-2 px-4 font-medium">Paid</th>
                  <th className="text-left py-2 px-4 font-medium">Docs</th>
                </tr>
              </thead>
              <tbody>
                {pos.map(p => {
                  const t = supType(p.supplier)
                  const dimmed = !includedInCashflow(p)
                  // Подсветка по факту оплаты: оплачено → зелёный, иначе по сроку
                  // (просрочено → wine-red, сегодня → amber). Консигнация/exclude
                  // не имеют срока платежа — остаются нейтральными.
                  const payable = t !== 'consignment' && includedInCashflow(p) && p.order_date
                  const due = payable ? computeDueDate(p.order_date!, termsFor(p.supplier)) : null
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
                      <td className="py-2 px-4">{p.supplier ?? '—'}</td>
                      <td className="py-2 px-4">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-sm border ${
                          t === 'consignment' ? 'bg-amber-gold/20 text-deep-black border-amber-gold/60' :
                          t === 'mix'         ? 'bg-wine-red/10 text-wine-red border-wine-red/40' :
                                                'bg-cream text-graphite border-pale-stone'
                        }`}>
                          {t}
                        </span>
                      </td>
                      <td className="py-2 px-4 text-right tabular-nums">
                        {p.total_thb ? `฿${fmt(p.total_thb)}` : '—'}
                      </td>
                      <td className="py-2 px-4">
                        <CashflowOverrideCell poId={p.id} initial={p.cashflow_override} />
                      </td>
                      <td className="py-2 px-4">
                        <PaidAtCell poId={p.id} initial={p.paid_at} />
                      </td>
                      <td className="py-2 px-4">
                        <DocsUrlCell poId={p.id} initial={p.docs_url} />
                      </td>
                    </tr>
                  )
                })}
                {pos.length === 0 && (
                  <tr><td colSpan={8} className="py-6 text-center text-graphite text-sm">
                    Нет PO в {monthLabel(month)} с текущими фильтрами.
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
          for (const [k, v] of Object.entries(keep)) if (v && v !== 'all') params.set(k, v)
          if (o !== 'all') params.set(paramKey, o)
          const qs = params.toString()
          const active = current === o
          return (
            <Link key={o}
              href={qs ? `/m/suppliers/purchase-orders?${qs}` : '/m/suppliers/purchase-orders'}
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
