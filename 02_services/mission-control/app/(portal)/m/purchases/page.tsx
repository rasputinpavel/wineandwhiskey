import Link from 'next/link'
import { sbInventory, sbPublic, type PurchaseOrder, type Supplier } from '@/lib/supabase'
import { PaneHeader } from '@/components/shell/PaneHeader'
import { findItem } from '@/lib/registry'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { POExcludeCell } from '@/components/modules/purchases/POExcludeCell'
import { fmtDate } from '@/lib/fmt'

export const dynamic = 'force-dynamic'

type SearchParams = {
  month?:    string         // YYYY-MM, default = current
  type?:     'all' | 'regular' | 'consignment' | 'mix'
  status?:   'all' | 'closed' | 'draft'
  excluded?: 'all' | 'yes' | 'no'
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
  const excFilter    = sp.excluded ?? 'all'
  const item = findItem('purchases')!

  // Month bounds
  const [y, m] = month.split('-').map(Number)
  const from = `${y}-${String(m).padStart(2, '0')}-01`
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  // Fetch POs in month
  const { data: poRows, error: poErr } = await sbPublic
    .from('purchase_orders')
    .select('id,po_number,order_date,supplier,total_thb,status,url,exclude_from_cashflow')
    .gte('order_date', from)
    .lte('order_date', to)
    .order('order_date', { ascending: false })
  if (poErr) {
    return <><PaneHeader item={item} /><div className="p-6"><SchemaError error={poErr.message} /></div></>
  }

  // Fetch suppliers for type lookup
  const { data: supRows } = await sbInventory
    .from('supplier')
    .select('name,type')
  const typeByName = new Map<string, Supplier['type']>()
  for (const s of (supRows ?? []) as Supplier[]) {
    typeByName.set(s.name.trim().toLowerCase(), s.type)
  }
  function supType(name: string | null): Supplier['type'] {
    return typeByName.get((name ?? '').trim().toLowerCase()) ?? 'regular'
  }

  let pos = (poRows ?? []) as PurchaseOrder[]
  if (typeFilter !== 'all') pos = pos.filter(p => supType(p.supplier) === typeFilter)
  if (statusFilter !== 'all') {
    const want = statusFilter === 'closed' ? 'closed' : 'draft'
    pos = pos.filter(p => (p.status ?? '').toLowerCase() === want)
  }
  if (excFilter !== 'all') {
    pos = pos.filter(p => excFilter === 'yes' ? p.exclude_from_cashflow : !p.exclude_from_cashflow)
  }

  // Aggregate
  const grand = pos.reduce((s, p) => s + Number(p.total_thb ?? 0), 0)
  const excluded = pos.filter(p => p.exclude_from_cashflow).reduce((s, p) => s + Number(p.total_thb ?? 0), 0)
  const consignment = pos.filter(p => supType(p.supplier) === 'consignment').reduce((s, p) => s + Number(p.total_thb ?? 0), 0)
  const cashflowImpact = grand - excluded - consignment

  // Month picker — 18 months back
  const months: string[] = []
  let py = y, pm = m
  for (let i = 0; i < 18; i++) {
    months.push(`${py}-${String(pm).padStart(2, '0')}`)
    pm--; if (pm < 1) { pm = 12; py-- }
  }

  return (
    <>
      <PaneHeader item={item} />
      <div className="flex-1 overflow-y-auto bg-cream">
        <div className="max-w-[1280px] mx-auto px-6 py-6">
          <div className="flex items-baseline justify-between mb-2 flex-wrap gap-3">
            <h2 className="font-heading text-xl text-deep-black">Purchase Orders — {monthLabel(month)}</h2>
          </div>
          <p className="text-graphite text-sm mb-4 max-w-3xl">
            Закрытые PO из Loyverse за месяц. Поставщики типа <span className="text-deep-black">consignment</span> не идут
            в cashflow (платятся по факту реализации). Любой PO можно вручную <span className="text-deep-black">исключить</span> —
            например когда ты по ошибке завёл консигнацию как обычный PO.
          </p>

          {/* KPI */}
          <div className="grid grid-cols-4 gap-3 mb-4">
            <KPI label="Все PO"             value={`฿${fmt(grand)}`} note={`${pos.length} штук`} />
            <KPI label="Consignment"        value={`−฿${fmt(consignment)}`} note="по типу поставщика" muted />
            <KPI label="Excluded вручную"   value={`−฿${fmt(excluded)}`} note="ошибочные / спорные" muted />
            <KPI label="В cashflow"         value={`฿${fmt(cashflowImpact)}`} note="идёт в P&L (со сдвигом −1 мес.)" highlight />
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3 mb-4 flex-wrap text-xs">
            <FilterPills
              label="Type"
              current={typeFilter}
              options={['all', 'regular', 'consignment', 'mix']}
              keep={{ month, status: statusFilter, excluded: excFilter }}
              paramKey="type"
            />
            <FilterPills
              label="Status"
              current={statusFilter}
              options={['all', 'closed', 'draft']}
              keep={{ month, type: typeFilter, excluded: excFilter }}
              paramKey="status"
            />
            <FilterPills
              label="Excluded"
              current={excFilter}
              options={['all', 'yes', 'no']}
              keep={{ month, type: typeFilter, status: statusFilter }}
              paramKey="excluded"
            />
          </div>

          {/* Month link grid (since onChange doesn't work in server component) */}
          <div className="flex gap-1 mb-4 text-[11px] flex-wrap">
            {months.slice(0, 12).map(mm => (
              <Link key={mm}
                href={`/m/purchases?month=${mm}`}
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
                </tr>
              </thead>
              <tbody>
                {pos.map(p => {
                  const t = supType(p.supplier)
                  const consignmentRow = t === 'consignment'
                  return (
                    <tr key={p.id} className={`border-b border-pale-stone/40 last:border-0 hover:bg-cream/40 ${consignmentRow ? 'opacity-60' : ''}`}>
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
                        {consignmentRow
                          ? <span className="text-[10px] text-graphite italic">auto-excluded</span>
                          : <POExcludeCell poId={p.id} initial={p.exclude_from_cashflow} />}
                      </td>
                    </tr>
                  )
                })}
                {pos.length === 0 && (
                  <tr><td colSpan={6} className="py-6 text-center text-graphite text-sm">
                    Нет PO в {monthLabel(month)} с текущими фильтрами.
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
              href={qs ? `/m/purchases?${qs}` : '/m/purchases'}
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
