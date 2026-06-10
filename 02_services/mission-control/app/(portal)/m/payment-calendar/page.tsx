import Link from 'next/link'
import { sbInventory, sbPublic, type PurchaseOrder, type Supplier } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { PaidAtCell } from '@/components/modules/purchases/PaidAtCell'
import { DocsUrlCell } from '@/components/modules/purchases/DocsUrlCell'
import { DataFreshness } from '@/components/shell/DataFreshness'
import { fmtDate } from '@/lib/fmt'
import { computeDueDate, todayBkk, daysBetween } from '@/lib/kpi'

export const dynamic = 'force-dynamic'

// payDate = actual paid_at when paid, else computed (order_date + terms).
type CalRow = PurchaseOrder & { payDate: string; daysToDue: number; paid: boolean }
type Bucket = 'overdue' | 'today' | 'week' | 'later'
type SearchParams = { month?: string }   // YYYY-MM; absent = "Open" (outstanding only)

function bangkokYM(): string {
  const d = new Date(Date.now() + 7 * 3600_000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthBounds(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number)
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return {
    from: `${y}-${String(m).padStart(2, '0')}-01`,
    to:   `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  }
}

const RU_MONTHS = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек']
function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${RU_MONTHS[m - 1]} ${y}`
}

export default async function PaymentCalendarPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const month = (sp.month && /^\d{4}-\d{2}$/.test(sp.month)) ? sp.month : null
  const today = todayBkk()

  const COLS = 'id,po_number,order_date,supplier,total_thb,status,url,cashflow_override,paid_at,docs_url'

  // Outstanding (unpaid) closed POs — drives the "Open" view and the unpaid part
  // of a month. Pay date = order_date + supplier terms (the cashflow formula).
  const { data: openRows, error: poErr } = await sbPublic
    .from('purchase_orders').select(COLS)
    .is('paid_at', null)
    .order('order_date', { ascending: true })
  if (poErr) {
    return <div className="p-6"><SchemaError error={poErr.message} /></div>
  }

  // When a month is selected, also pull POs actually PAID in that month so the
  // tab reads as a full register (paid rows leave "Open" but stay in their month).
  let paidRows: PurchaseOrder[] = []
  if (month) {
    const { from, to } = monthBounds(month)
    const { data } = await sbPublic
      .from('purchase_orders').select(COLS)
      .not('paid_at', 'is', null)
      .gte('paid_at', from).lte('paid_at', to)
      .order('paid_at', { ascending: true })
    paidRows = (data ?? []) as PurchaseOrder[]
  }

  const { data: supRows } = await sbInventory
    .from('supplier').select('name,type,payment_terms_days')
  const metaByName = new Map<string, { type: Supplier['type']; terms: number }>()
  for (const s of (supRows ?? []) as Supplier[]) {
    metaByName.set(s.name.trim().toLowerCase(), { type: s.type, terms: s.payment_terms_days ?? 0 })
  }
  const supType  = (n: string | null): Supplier['type'] => metaByName.get((n ?? '').trim().toLowerCase())?.type ?? 'regular'
  const termsFor = (n: string | null): number          => metaByName.get((n ?? '').trim().toLowerCase())?.terms ?? 0

  // Consignment + force-exclude POs are not paid by ordinary invoice — out.
  function eligible(p: PurchaseOrder): boolean {
    if ((p.status ?? '').toLowerCase() !== 'closed') return false
    if (supType(p.supplier) === 'consignment') return false
    if (p.cashflow_override === 'exclude') return false
    return !!p.order_date
  }

  const openPos: CalRow[] = []
  for (const p of (openRows ?? []) as PurchaseOrder[]) {
    if (!eligible(p)) continue
    const payDate = computeDueDate(p.order_date!, termsFor(p.supplier))
    openPos.push({ ...p, payDate, daysToDue: daysBetween(payDate, today), paid: false })
  }
  openPos.sort((a, b) => a.payDate.localeCompare(b.payDate))

  const sumOf = (arr: CalRow[]) => arr.reduce((s, p) => s + Number(p.total_thb ?? 0), 0)

  // Month strip: 2 months forward (due dates can land next month) + 11 back.
  const months: string[] = []
  const [curY, curM] = bangkokYM().split('-').map(Number)
  let py = curY, pm = curM + 2
  while (pm > 12) { pm -= 12; py++ }
  for (let i = 0; i < 14; i++) {
    months.push(`${py}-${String(pm).padStart(2, '0')}`)
    pm--; if (pm < 1) { pm = 12; py-- }
  }

  return (
    <>
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-3">
        <h2 className="font-heading text-xl text-deep-black">
          Payment Calendar · {month ? monthLabel(month) : 'Open'}
        </h2>
        <DataFreshness sources={['purchase_orders']} />
      </div>
      <p className="text-graphite text-sm mb-4 max-w-3xl">
        Платежи поставщикам по дате оплаты (<span className="text-deep-black">paid_at</span>, иначе
        order_date + отсрочка). Консигнация и force-exclude скрыты.
        <span className="text-deep-black"> Open</span> — оперативная сводка неоплаченного по срочности;
        как только PO оплачен, он уходит из Open и остаётся во вкладке своего месяца (зелёным).
      </p>

      {/* Month strip */}
      <div className="flex gap-1 mb-5 text-[11px] flex-wrap">
        <Link href="/m/payment-calendar"
          className={`px-2 py-1 rounded-sm border transition-colors ${
            month === null
              ? 'bg-wine-red text-warm-white border-wine-red'
              : 'bg-warm-white text-graphite border-pale-stone hover:border-wine-red hover:text-wine-red'
          }`}>
          Open
        </Link>
        {months.map(mm => (
          <Link key={mm} href={`/m/payment-calendar?month=${mm}`}
            className={`px-2 py-1 rounded-sm border transition-colors ${
              mm === month
                ? 'bg-wine-red text-warm-white border-wine-red'
                : 'bg-warm-white text-graphite border-pale-stone hover:border-wine-red hover:text-wine-red'
            }`}>
            {monthLabel(mm)}
          </Link>
        ))}
      </div>

      {month === null
        ? <OpenView openPos={openPos} sumOf={sumOf} />
        : <MonthView
            month={month}
            unpaid={openPos.filter(p => p.payDate.slice(0, 7) === month)}
            paid={paidRows.filter(eligible).map(p => ({
              ...p, payDate: p.paid_at!, daysToDue: daysBetween(p.paid_at!, today), paid: true,
            }))}
            sumOf={sumOf}
          />}
    </>
  )
}

// ── Default "Open" view — outstanding only, bucketed by urgency vs today ──────
function OpenView({ openPos, sumOf }: { openPos: CalRow[]; sumOf: (a: CalRow[]) => number }) {
  function bucketOf(p: CalRow): Bucket {
    if (p.daysToDue < 0) return 'overdue'
    if (p.daysToDue === 0) return 'today'
    if (p.daysToDue <= 7) return 'week'
    return 'later'
  }
  const groups: Record<Bucket, CalRow[]> = { overdue: [], today: [], week: [], later: [] }
  for (const p of openPos) groups[bucketOf(p)].push(p)

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <KPI label="Просрочено" sum={sumOf(groups.overdue)} n={groups.overdue.length} tone="overdue" />
        <KPI label="Сегодня"    sum={sumOf(groups.today)}   n={groups.today.length}   tone="today" />
        <KPI label="Эта неделя" sum={sumOf(groups.week)}    n={groups.week.length}    tone="week" />
        <KPI label="Позже"      sum={sumOf(groups.later)}   n={groups.later.length}   tone="later" />
      </div>

      {openPos.length === 0 ? <Empty /> : (
        <div className="space-y-5">
          <POTable title="Просрочено" headTone="overdue" rows={groups.overdue} />
          <POTable title="Сегодня"    headTone="today"   rows={groups.today} />
          <POTable title="Эта неделя" headTone="week"    rows={groups.week} />
          <POTable title="Позже"      headTone="later"   rows={groups.later} />
        </div>
      )}

      <div className="mt-5 text-xs text-graphite/70 tabular-nums">
        Всего открыто: ฿{fmt(sumOf(openPos))} · {openPos.length} PO
      </div>
    </>
  )
}

// ── Month view — everything with a payment date in the month (paid + unpaid) ──
function MonthView({ month, unpaid, paid, sumOf }: {
  month: string; unpaid: CalRow[]; paid: CalRow[]; sumOf: (a: CalRow[]) => number
}) {
  const rows = [...unpaid, ...paid].sort((a, b) => a.payDate.localeCompare(b.payDate))
  const overdue = unpaid.filter(p => p.daysToDue < 0)
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <KPI label="К оплате" sum={sumOf(unpaid)} n={unpaid.length} tone="later" />
        <KPI label="из них просрочено" sum={sumOf(overdue)} n={overdue.length} tone="overdue" />
        <KPI label="Оплачено" sum={sumOf(paid)} n={paid.length} tone="paid" />
      </div>
      {rows.length === 0
        ? <Empty />
        : <POTable title={monthLabel(month)} headTone="neutral" rows={rows} />}
    </>
  )
}

function Empty() {
  return (
    <div className="bg-warm-white border border-pale-stone rounded-md py-10 text-center text-graphite text-sm">
      Нет PO с датой платежа в этом периоде.
    </div>
  )
}

function dueLabel(p: CalRow): React.ReactNode {
  if (p.paid)            return <span className="text-emerald-700">оплачено · {fmtDate(p.payDate)}</span>
  if (p.daysToDue < 0)   return <span className="text-wine-red">просрочено на {-p.daysToDue} дн · {fmtDate(p.payDate)}</span>
  if (p.daysToDue === 0) return <span className="text-deep-black">сегодня · {fmtDate(p.payDate)}</span>
  return <span className="text-graphite">через {p.daysToDue} дн · {fmtDate(p.payDate)}</span>
}

function POTable({ title, headTone, rows }: {
  title: string; headTone: Bucket | 'neutral'; rows: CalRow[]
}) {
  if (rows.length === 0) return null
  const headBg = headTone === 'overdue' ? 'bg-wine-red/[0.06]' : headTone === 'today' ? 'bg-amber-gold/[0.14]' : 'bg-cream/40'
  const sum = rows.reduce((s, p) => s + Number(p.total_thb ?? 0), 0)
  return (
    <section className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
      <div className={`px-4 py-2 border-b border-pale-stone flex items-baseline justify-between ${headBg}`}>
        <h3 className="font-heading text-sm text-deep-black">{title}</h3>
        <span className="text-[11px] text-graphite tabular-nums">฿{fmt(sum)} · {rows.length} PO</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="text-graphite border-b border-pale-stone bg-cream/40">
            <tr>
              <th className="text-left py-2 px-4 font-medium">PO</th>
              <th className="text-left py-2 px-4 font-medium">Ordered</th>
              <th className="text-left py-2 px-4 font-medium">Supplier</th>
              <th className="text-left py-2 px-4 font-medium">Pay date</th>
              <th className="text-right py-2 px-4 font-medium">Total</th>
              <th className="text-left py-2 px-4 font-medium">Paid</th>
              <th className="text-left py-2 px-4 font-medium">Docs</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(p => {
              const tint = p.paid ? 'bg-emerald-600/[0.07]'
                : p.daysToDue < 0 ? 'bg-wine-red/[0.05]'
                : p.daysToDue === 0 ? 'bg-amber-gold/[0.10]' : ''
              return (
                <tr key={p.id} className={`border-b border-pale-stone/40 last:border-0 hover:bg-cream/40 ${tint}`}>
                  <td className="py-2 px-4 font-mono text-xs whitespace-nowrap">
                    {p.url
                      ? <a href={p.url} target="_blank" rel="noreferrer" className="text-wine-red hover:underline">{p.po_number}</a>
                      : p.po_number}
                  </td>
                  <td className="py-2 px-4 text-graphite text-xs whitespace-nowrap">{fmtDate(p.order_date)}</td>
                  <td className="py-2 px-4 whitespace-nowrap">{p.supplier ?? '—'}</td>
                  <td className="py-2 px-4 text-xs whitespace-nowrap">{dueLabel(p)}</td>
                  <td className="py-2 px-4 text-right tabular-nums whitespace-nowrap">
                    {p.total_thb ? `฿${fmt(p.total_thb)}` : '—'}
                  </td>
                  <td className="py-2 px-4"><PaidAtCell poId={p.id} initial={p.paid_at} /></td>
                  <td className="py-2 px-4"><DocsUrlCell poId={p.id} initial={p.docs_url} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function KPI({ label, sum, n, tone }: { label: string; sum: number; n: number; tone: Bucket | 'paid' }) {
  const bg = tone === 'overdue' ? 'bg-wine-red/[0.06]'
    : tone === 'today' ? 'bg-amber-gold/[0.14]'
    : tone === 'paid' ? 'bg-emerald-600/[0.07]' : 'bg-warm-white'
  const valueCls = tone === 'overdue' ? 'text-wine-red' : tone === 'paid' ? 'text-emerald-700' : 'text-deep-black'
  return (
    <div className={`px-4 py-3 rounded-md border border-pale-stone ${bg}`}>
      <div className="text-[10px] uppercase tracking-wide text-graphite">{label}</div>
      <div className={`text-lg font-medium tabular-nums ${n ? valueCls : 'text-graphite/50'}`}>
        {n ? `฿${fmt(sum)}` : '—'}
      </div>
      <div className="text-[11px] text-graphite/70">{n} PO</div>
    </div>
  )
}

function fmt(n: number): string {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}
