import Link from 'next/link'
import { sbInventory, sbPublic, type PurchaseOrder, type Supplier, type FlowInvoice, type FixedCost, type MandatoryActual, type RollingBigPayment } from '@/lib/supabase'
import { MonthStrip } from '@/components/modules/payment-calendar/MonthStrip'
import { Timeline, type CalRow, type Dir, type Status } from '@/components/modules/payment-calendar/Timeline'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { DataFreshness } from '@/components/shell/DataFreshness'
import { fmtDate } from '@/lib/fmt'
import { computeDueDate, todayBkk, daysBetween } from '@/lib/kpi'
import { buildFixedRows, buildBigRows, type CalMode } from '@/lib/payment-calendar-out'
import { getReceiptHistory } from '@/lib/receipts-cache'
import { daysInMonth, bucketOf } from '@/lib/mandatory'
import { fetchExpenses } from '@/lib/income'

export const dynamic = 'force-dynamic'

// Двусторонний платёжный календарь: OUT — платежи поставщикам (кредиторка, PO),
// IN — ожидаемые поступления от B2B-инвойсов (дебиторка). Единый таймлайн по дате
// с бегущим NET. Дата OUT = paid_at | order_date + отсрочка поставщика; дата IN =
// due_at | issued_at + отсрочка клиента. Консигнация-PO (Harvest, Cigar Empire) —
// реальный платёж, показывается наравне с обычными PO. Инвойс наследует отсрочку
// клиента (Golden Brewery) автоматически.
// Типы CalRow/Dir/Status живут в Timeline (клиентском компоненте таблицы).
type SearchParams = { month?: string }   // YYYY-MM; absent = "Open" (outstanding only)

// Консигнация под нынешним владельцем начинается с этой даты; более ранние
// settlement-PO — обязательство прежнего владельца, в календарь не тянем.
const CONSIGN_CUTOFF = '2026-05-01'

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

const EN_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${EN_MONTHS[m - 1]} ${y}`
}

function statusFor(date: string, today: string): Exclude<Status, 'paid'> {
  const dd = daysBetween(date, today)   // date - today
  if (dd < 0) return 'overdue'
  if (dd === 0) return 'today'
  return 'future'
}

export default async function PaymentCalendarPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const month = (sp.month && /^\d{4}-\d{2}$/.test(sp.month)) ? sp.month : null
  const today = todayBkk()

  const PO_COLS = 'id,po_number,order_date,supplier,total_thb,status,url,cashflow_override,paid_at,docs_url'

  // ── OUT: PO (кредиторка) ───────────────────────────────────────────────
  const { data: openPoData, error: poErr } = await sbPublic
    .from('purchase_orders').select(PO_COLS)
    .is('paid_at', null)
    .order('order_date', { ascending: true })
  if (poErr) return <div className="p-6"><SchemaError error={poErr.message} /></div>

  // В месячном виде дотягиваем PO, фактически оплаченные в этом месяце (зелёные).
  let paidPoData: PurchaseOrder[] = []
  if (month) {
    const { from, to } = monthBounds(month)
    const { data } = await sbPublic
      .from('purchase_orders').select(PO_COLS)
      .not('paid_at', 'is', null)
      .gte('paid_at', from).lte('paid_at', to)
      .order('paid_at', { ascending: true })
    paidPoData = (data ?? []) as PurchaseOrder[]
  }

  const { data: supRows } = await sbInventory
    .from('supplier').select('name,type,payment_terms_days')
  const supByName = new Map<string, { type: Supplier['type']; terms: number }>()
  for (const s of (supRows ?? []) as Supplier[]) {
    supByName.set(s.name.trim().toLowerCase(), { type: s.type, terms: s.payment_terms_days ?? 0 })
  }
  const supType  = (n: string | null): Supplier['type'] => supByName.get((n ?? '').trim().toLowerCase())?.type ?? 'regular'
  const supTerms = (n: string | null): number          => supByName.get((n ?? '').trim().toLowerCase())?.terms ?? 0

  // ── OUT: постоянные расходы (fixed_cost) + Big-разовые ──────────────────
  const curYM = today.slice(0, 7)
  const nextYM = (() => { const [y, m] = curYM.split('-').map(Number); const d = new Date(Date.UTC(y, m, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` })()
  const ovPeriods = month ? [month] : [curYM, nextYM]

  const [fcRes, ovRes, bigRes] = await Promise.all([
    sbInventory.from('fixed_cost').select('*'),
    sbInventory.from('mandatory_actual').select('*').in('period', ovPeriods),
    sbInventory.from('rolling_big_payment').select('*'),   // tolerate absence (migration 026)
  ])
  if (fcRes.error) return <div className="p-6"><SchemaError error={fcRes.error.message} /></div>
  if (ovRes.error) return <div className="p-6"><SchemaError error={ovRes.error.message} /></div>
  const fixedCosts = (fcRes.data ?? []) as FixedCost[]
  const overrides = (ovRes.data ?? []) as MandatoryActual[]
  const bigPayments = (bigRes.data ?? []) as RollingBigPayment[]

  // Revenue for %-obligations (Taxes 3.5%, Bonuses 1%): actual for closed months,
  // trailing-7d retail run-rate × month length for current/future — same as Rolling.
  let avgRetailPerDay = 0
  const monthlyActual = new Map<string, number>()
  try {
    const receipts = await getReceiptHistory()
    const start = (() => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 6); return d.toISOString().slice(0, 10) })()
    let sum = 0
    for (const r of receipts) {
      const signed = (r.receipt_type === 'REFUND' ? -1 : 1) * Number(r.total)
      const d = r.receipt_date.slice(0, 10)
      if (!r.is_b2b && d >= start && d <= today) sum += signed
      const ym = r.receipt_date.slice(0, 7)
      monthlyActual.set(ym, (monthlyActual.get(ym) ?? 0) + signed)
    }
    avgRetailPerDay = Math.max(0, sum / 7)
  } catch { avgRetailPerDay = 0 }
  const curMonth = today.slice(0, 7)
  const revenueOf = (period: string) => period < curMonth
    ? (monthlyActual.get(period) ?? 0)
    : avgRetailPerDay * daysInMonth(period)

  // Current-month paid "Обязательные" descriptions from the Expenses sheet — lets
  // buildFixedRows drop obligations already settled (matched by category) and keep
  // only genuinely-unpaid ones, same reconciliation as Rolling. Sheet read is
  // best-effort: on failure we fall back to plan-only (no reconciliation).
  const paidMandatoryDescriptions: string[] = []
  try {
    const expenses = await fetchExpenses()
    for (const e of expenses) {
      if (e.date.slice(0, 7) === curMonth && bucketOf(e.category) === 'mandatory') {
        paidMandatoryDescriptions.push(e.description)
      }
    }
  } catch { /* sheet unavailable → plan-only */ }

  const calMode: CalMode = month ? { view: 'month', month, today } : { view: 'open', today }
  const outFixed = buildFixedRows(fixedCosts, overrides, revenueOf, calMode, paidMandatoryDescriptions)
  const outBig = buildBigRows(bigPayments, calMode)

  // Что попадает в OUT-таймлайн:
  //   • force-exclude (cashflow_override) — никогда;
  //   • force-include (cashflow_override) — всегда, даже если PO ещё pending. Это
  //     нужно для точечной консигнации у обычного поставщика: товар заводят через
  //     stock adjustment, а счёт к оплате — pending-PO (не Receive, чтобы сток не
  //     задвоился). Флаг ставится на самом PO, тип поставщика остаётся regular;
  //   • консигнация (Harvest/Cigar Empire) — settlement-PO = реальный платёж, но
  //     живёт в статусе pending (tax invoice, не Receive) → статус не проверяем,
  //     только cutoff по владельцу;
  //   • обычные PO — только закрытые (closed).
  function poEligible(p: PurchaseOrder): boolean {
    if (p.cashflow_override === 'exclude') return false
    if (!p.order_date) return false
    if (p.cashflow_override === 'include') return true
    if (supType(p.supplier) === 'consignment') return p.order_date >= CONSIGN_CUTOFF
    return (p.status ?? '').toLowerCase() === 'closed'
  }

  const outOpen: CalRow[] = []
  for (const p of (openPoData ?? []) as PurchaseOrder[]) {
    if (!poEligible(p)) continue
    const date = computeDueDate(p.order_date!, supTerms(p.supplier))
    outOpen.push({
      key: `po-${p.id}`, date, dir: 'out', who: p.supplier ?? '—',
      label: p.po_number, href: p.url, amount: Number(p.total_thb ?? 0),
      status: statusFor(date, today), net: 0, po: p,
    })
  }
  const outPaid: CalRow[] = paidPoData.filter(poEligible).map(p => ({
    key: `po-${p.id}`, date: p.paid_at!, dir: 'out' as Dir, who: p.supplier ?? '—',
    label: p.po_number, href: p.url, amount: Number(p.total_thb ?? 0),
    status: 'paid' as Status, net: 0, po: p,
  }))

  // ── IN: B2B-инвойсы (дебиторка) ────────────────────────────────────────
  const [{ data: invData, error: invErr }, { data: custData, error: custErr }] = await Promise.all([
    sbInventory
      .from('flowaccount_invoice')
      .select('id, number, customer_id, customer_name, issued_at, due_at, status, total, detail_url, excluded')
      .not('status', 'in', '(Paid,Cancelled)')
      .eq('excluded', false)
      .limit(500),
    sbInventory.from('b2b_customer').select('id, payment_terms_days'),
  ])
  if (invErr)  return <div className="p-6"><SchemaError error={invErr.message} /></div>
  if (custErr) return <div className="p-6"><SchemaError error={custErr.message} /></div>

  const custTerms = new Map<string, number>()
  for (const c of (custData ?? []) as { id: string; payment_terms_days: number }[]) {
    custTerms.set(c.id, c.payment_terms_days ?? 0)
  }
  // due_at из FA часто = '' (не null) → || ловит оба случая.
  function invoiceDue(inv: FlowInvoice): string | null {
    const terms = inv.customer_id ? (custTerms.get(inv.customer_id) ?? 0) : 0
    return (inv.due_at || (terms > 0 ? computeDueDate(inv.issued_at, terms) : null)) || null
  }

  const inOpen: CalRow[] = []
  const inNoDate: FlowInvoice[] = []   // нет вычислимой даты — отдельным списком, не в NET
  for (const inv of (invData ?? []) as FlowInvoice[]) {
    const date = invoiceDue(inv)
    if (!date) { inNoDate.push(inv); continue }
    inOpen.push({
      key: `inv-${inv.id}`, date, dir: 'in', who: inv.customer_name,
      label: inv.number, href: inv.detail_url, amount: Number(inv.total ?? 0),
      status: statusFor(date, today), net: 0,
      inv: { status: inv.status, detailUrl: inv.detail_url },
    })
  }

  // ── Сборка вида ────────────────────────────────────────────────────────
  let rows: CalRow[]
  if (month) {
    const inMonth = (d: string) => d.slice(0, 7) === month
    rows = [
      ...outOpen.filter(r => inMonth(r.date)),
      ...outPaid,                                  // уже отфильтрованы по paid_at месяца
      ...outFixed,
      ...outBig,
      ...inOpen.filter(r => inMonth(r.date)),
    ]
  } else {
    rows = [...outOpen, ...outFixed, ...outBig, ...inOpen]
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || (a.dir === b.dir ? 0 : a.dir === 'out' ? -1 : 1))
  let net = 0
  for (const r of rows) { net += r.dir === 'in' ? r.amount : -r.amount; r.net = net }

  const sumOut = (arr: CalRow[]) => arr.filter(r => r.dir === 'out').reduce((s, r) => s + r.amount, 0)
  const sumIn  = (arr: CalRow[]) => arr.filter(r => r.dir === 'in').reduce((s, r) => s + r.amount, 0)

  // Month strip: 2 месяца вперёд (даты могут уезжать в след. месяц) + 11 назад.
  const months: string[] = []
  let [py, pm] = bangkokYM().split('-').map(Number)
  pm += 2; while (pm > 12) { pm -= 12; py++ }
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
        <DataFreshness sources={['purchase_orders', 'flowaccount_invoices']} />
      </div>
      <p className="text-graphite text-sm mb-4 max-w-3xl">
        Payments both ways, by date. <span className="text-wine-red">Out</span> — to suppliers
        (POs + terms), <span className="text-[#4C6B54]">In</span> — expected receipts from B2B
        invoices (issued + customer terms). Force-excluded POs are hidden; paid invoices drop off.
        <span className="text-deep-black"> Open</span> shows everything outstanding by date with a
        running balance.
      </p>

      {/* Month strip */}
      <MonthStrip
        months={months.map(mm => ({ ym: mm, label: monthLabel(mm) }))}
        selected={month}
        currentYM={bangkokYM()}
      />

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {month ? (() => {
          const unpaidOut = rows.filter(r => r.dir === 'out' && r.status !== 'paid')
          const paidOut   = rows.filter(r => r.dir === 'out' && r.status === 'paid')
          const inRows    = rows.filter(r => r.dir === 'in')
          const m = sumIn(rows) - sumOut(rows)   // нетто месяца, как финал бегущего NET (вкл. оплаченные)
          return <>
            <KPI label="Payable (Out)" sum={sumOut(unpaidOut)} n={unpaidOut.length} tone="out" />
            <KPI label="Receivable (In)" sum={sumIn(inRows)} n={inRows.length} tone="in" />
            <KPI label="Paid" sum={sumOut(paidOut)} n={paidOut.length} tone="paid" />
            <KPI label="NET" sum={m} n={rows.length} tone="net" />
          </>
        })() : (() => {
          const o = sumOut(rows), i = sumIn(rows)
          const overdueOut = rows.filter(r => r.dir === 'out' && r.status === 'overdue')
          const overdueIn  = rows.filter(r => r.dir === 'in'  && r.status === 'overdue')
          return <>
            <KPI label="Payable (Out)" sum={o} n={rows.filter(r => r.dir === 'out').length} tone="out"
              note={overdueOut.length ? `overdue ฿${fmt(sumOut(overdueOut))}` : undefined} />
            <KPI label="Receivable (In)" sum={i} n={rows.filter(r => r.dir === 'in').length} tone="in"
              note={overdueIn.length ? `overdue ฿${fmt(sumIn(overdueIn))}` : undefined} />
            <KPI label="NET" sum={i - o} n={rows.length} tone="net" />
            <KPI label="No date (In)" sum={inNoDate.reduce((s, x) => s + Number(x.total ?? 0), 0)}
              n={inNoDate.length} tone="muted" />
          </>
        })()}
      </div>

      {rows.length === 0
        ? <Empty />
        : <Timeline rows={rows} today={today} isOpenView={month === null} />}

      {/* Инвойсы без вычислимой даты оплаты — только в Open */}
      {month === null && inNoDate.length > 0 && <NoDateList invoices={inNoDate} />}
    </>
  )
}

function NoDateList({ invoices }: { invoices: FlowInvoice[] }) {
  const total = invoices.reduce((s, x) => s + Number(x.total ?? 0), 0)
  return (
    <section className="mt-5 bg-warm-white border border-pale-stone rounded-md overflow-hidden">
      <div className="px-4 py-2 border-b border-pale-stone bg-cream/40 flex items-baseline justify-between">
        <h3 className="font-heading text-sm text-deep-black">In with no payment date — set the customer&rsquo;s terms</h3>
        <span className="text-[11px] text-graphite tabular-nums">฿{fmt(total)} · {invoices.length}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <tbody>
            {invoices.map(inv => (
              <tr key={inv.id} className="border-b border-pale-stone/40 last:border-0 hover:bg-cream/40">
                <td className="py-2 px-4 font-mono text-xs whitespace-nowrap">
                  {inv.detail_url
                    ? <a href={inv.detail_url} target="_blank" rel="noreferrer" className="text-wine-red hover:underline">{inv.number}</a>
                    : inv.number}
                </td>
                <td className="py-2 px-4 whitespace-nowrap">{inv.customer_name}</td>
                <td className="py-2 px-4 text-graphite text-xs whitespace-nowrap">{fmtDate(inv.issued_at)}</td>
                <td className="py-2 px-4 text-right tabular-nums whitespace-nowrap text-emerald-700">฿{fmt(Number(inv.total ?? 0))}</td>
                <td className="py-2 px-4 text-xs">
                  <Link href="/m/inventory/customers" className="text-graphite italic hover:text-wine-red">set terms</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Empty() {
  return (
    <div className="bg-warm-white border border-pale-stone rounded-md py-10 text-center text-graphite text-sm">
      No dated payments in this period.
    </div>
  )
}

function KPI({ label, sum, n, tone, note }: {
  label: string; sum: number; n: number
  tone: 'out' | 'in' | 'paid' | 'net' | 'muted'; note?: string
}) {
  const bg = tone === 'out' ? 'bg-wine-red/[0.06]'
    : tone === 'in' ? 'bg-emerald-600/[0.06]'
    : tone === 'paid' ? 'bg-emerald-600/[0.07]'
    : 'bg-warm-white'
  const valueCls = tone === 'out' ? 'text-wine-red'
    : tone === 'in' || tone === 'paid' ? 'text-emerald-700'
    : tone === 'net' ? (sum < 0 ? 'text-wine-red' : 'text-deep-black')
    : 'text-graphite'
  const money = tone === 'net'
    ? (sum < 0 ? `-฿${fmt(-sum)}` : `฿${fmt(sum)}`)
    : `฿${fmt(sum)}`
  return (
    <div className={`px-4 py-3 rounded-md border border-pale-stone ${bg}`}>
      <div className="text-[10px] uppercase tracking-wide text-graphite">{label}</div>
      <div className={`text-lg font-medium tabular-nums ${n ? valueCls : 'text-graphite/50'}`}>
        {n ? money : '—'}
      </div>
      <div className="text-[11px] text-graphite/70">{note ?? `${n} items`}</div>
    </div>
  )
}

function fmt(n: number): string {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
