import Link from 'next/link'
import { sbInventory, sbPublic, type PurchaseOrder, type Supplier, type FlowInvoice, type FixedCost, type MandatoryActual } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { PaidAtCell } from '@/components/modules/purchases/PaidAtCell'
import { DocsUrlCell } from '@/components/modules/purchases/DocsUrlCell'
import { DataFreshness } from '@/components/shell/DataFreshness'
import { fmtDate } from '@/lib/fmt'
import { computeDueDate, todayBkk, daysBetween } from '@/lib/kpi'
import { generateObligations, reconcile, daysInMonth } from '@/lib/mandatory'
import { fetchExpenses, type WalletExpense } from '@/lib/income'

export const dynamic = 'force-dynamic'

// Двусторонний платёжный календарь: OUT — платежи поставщикам (кредиторка, PO),
// IN — ожидаемые поступления от B2B-инвойсов (дебиторка). Единый таймлайн по дате
// с бегущим NET. Дата OUT = paid_at | order_date + отсрочка поставщика; дата IN =
// due_at | issued_at + отсрочка клиента. Консигнация-PO скрыта, инвойс наследует
// недельную отсрочку клиента (Golden Brewery) автоматически.
type Dir = 'out' | 'in'
type Status = 'overdue' | 'today' | 'future' | 'paid'
type CalRow = {
  key: string
  date: string            // ISO дата платежа/поступления
  dir: Dir
  who: string             // supplier | customer
  label: string           // po_number | invoice number
  href: string | null
  amount: number          // всегда положительное
  status: Status
  net: number             // бегущий нетто, проставляется после сортировки
  po?: PurchaseOrder      // OUT: для инлайн-ячеек paid_at / docs
  inv?: { status: string; detailUrl: string | null }  // IN: для статуса/ссылки
  mand?: boolean          // OUT: обязательный расход (из Fixed Costs), без PO
}
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

  // Консигнация + force-exclude PO платятся не обычным инвойсом — наружу.
  function poEligible(p: PurchaseOrder): boolean {
    if ((p.status ?? '').toLowerCase() !== 'closed') return false
    if (supType(p.supplier) === 'consignment') return false
    if (p.cashflow_override === 'exclude') return false
    return !!p.order_date
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

  // ── OUT: обязательные расходы (mandatory obligations из Fixed Costs) ─────
  // Датированные обязательства (аренда, зарплата, налоги…) с reconcile к факту.
  // Месячный вид — обязательства месяца; Open — ближнее окно неоплаченных.
  const [{ data: fcData }, { data: ovData }] = await Promise.all([
    sbInventory.from('fixed_cost').select('*'),
    sbInventory.from('mandatory_actual').select('*'),
  ])
  const fixedRows = (fcData ?? []) as FixedCost[]
  const overrides = (ovData ?? []) as MandatoryActual[]

  let mandExpenses: WalletExpense[] = []
  try { mandExpenses = await fetchExpenses() } catch { /* нет creds — факт только из override */ }

  // Оценка выручки/мес для %-строк (налоги, бонусы): средний день × длина месяца.
  const since30 = new Date(Date.now() - 30 * 86400_000 + 7 * 3600_000).toISOString().slice(0, 10)
  const { data: recRows } = await sbInventory
    .from('loyverse_receipt').select('receipt_type, total').gte('receipt_date', since30).limit(8000)
  let rev30 = 0
  for (const r of (recRows ?? []) as { receipt_type: string; total: number }[]) {
    rev30 += (r.receipt_type === 'REFUND' ? -1 : 1) * Number(r.total)
  }
  const avgPerDay = Math.max(0, rev30 / 30)
  const revenueOfMonth = (ym: string) => avgPerDay * daysInMonth(ym)

  const addMonthYm = (ym: string, delta: number) => {
    const [y, mo] = ym.split('-').map(Number)
    const d = new Date(Date.UTC(y, mo - 1 + delta, 1))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  }
  const mandMonths = month ? [month] : (() => {
    const base = bangkokYM(); const out: string[] = []
    for (let i = -1; i <= 2; i++) out.push(addMonthYm(base, i))
    return out
  })()

  const outMand: CalRow[] = []
  for (const mo of mandMonths) {
    const rec = reconcile(generateObligations(mo, fixedRows, revenueOfMonth), mandExpenses, overrides, today)
    for (const o of rec) {
      const status: Status = o.status === 'paid' ? 'paid' : statusFor(o.date, today)
      if (!month && status === 'paid') continue   // Open = только неоплаченные
      outMand.push({
        key: `mand-${o.fixedCostId}-${o.period}`,
        date: status === 'paid' && o.paidAt ? o.paidAt : o.date,
        dir: 'out', who: o.category, label: 'fixed', href: null,
        amount: o.actual != null ? o.actual : o.planned,
        status, net: 0, mand: true,
      })
    }
  }

  // ── Сборка вида ────────────────────────────────────────────────────────
  let rows: CalRow[]
  if (month) {
    const inMonth = (d: string) => d.slice(0, 7) === month
    rows = [
      ...outOpen.filter(r => inMonth(r.date)),
      ...outPaid,                                  // уже отфильтрованы по paid_at месяца
      ...outMand,                                  // обязательства месяца (вкл. оплаченные)
      ...inOpen.filter(r => inMonth(r.date)),
    ]
  } else {
    rows = [...outOpen, ...outMand, ...inOpen]
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
        Платежи в обе стороны по дате. <span className="text-wine-red">OUT</span> — поставщикам
        (PO + отсрочка), <span className="text-emerald-700">IN</span> — ожидаемые поступления от
        B2B-инвойсов (issued + отсрочка клиента). Консигнация-PO и force-exclude скрыты; оплаченные
        инвойсы уходят из календаря. <span className="text-deep-black">Open</span> — всё открытое по
        дате с бегущим нетто.
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

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {month ? (() => {
          const unpaidOut = rows.filter(r => r.dir === 'out' && r.status !== 'paid')
          const paidOut   = rows.filter(r => r.dir === 'out' && r.status === 'paid')
          const inRows    = rows.filter(r => r.dir === 'in')
          const m = sumIn(rows) - sumOut(rows)   // нетто месяца, как финал бегущего NET (вкл. оплаченные)
          return <>
            <KPI label="К оплате (OUT)" sum={sumOut(unpaidOut)} n={unpaidOut.length} tone="out" />
            <KPI label="К получению (IN)" sum={sumIn(inRows)} n={inRows.length} tone="in" />
            <KPI label="Оплачено (PO)" sum={sumOut(paidOut)} n={paidOut.length} tone="paid" />
            <KPI label="NET" sum={m} n={rows.length} tone="net" />
          </>
        })() : (() => {
          const o = sumOut(rows), i = sumIn(rows)
          const overdueOut = rows.filter(r => r.dir === 'out' && r.status === 'overdue')
          const overdueIn  = rows.filter(r => r.dir === 'in'  && r.status === 'overdue')
          return <>
            <KPI label="К оплате (OUT)" sum={o} n={rows.filter(r => r.dir === 'out').length} tone="out"
              note={overdueOut.length ? `просрочено ฿${fmt(sumOut(overdueOut))}` : undefined} />
            <KPI label="К получению (IN)" sum={i} n={rows.filter(r => r.dir === 'in').length} tone="in"
              note={overdueIn.length ? `просрочено ฿${fmt(sumIn(overdueIn))}` : undefined} />
            <KPI label="NET" sum={i - o} n={rows.length} tone="net" />
            <KPI label="Без даты (IN)" sum={inNoDate.reduce((s, x) => s + Number(x.total ?? 0), 0)}
              n={inNoDate.length} tone="muted" />
          </>
        })()}
      </div>

      {rows.length === 0
        ? <Empty />
        : <Timeline rows={rows} today={today} />}

      {/* Инвойсы без вычислимой даты оплаты — только в Open */}
      {month === null && inNoDate.length > 0 && <NoDateList invoices={inNoDate} />}
    </>
  )
}

// ── Единый нетто-таймлайн ───────────────────────────────────────────────────
function Timeline({ rows, today }: { rows: CalRow[]; today: string }) {
  return (
    <section className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="text-graphite border-b border-pale-stone bg-cream/40">
            <tr>
              <th className="text-left  py-2 px-4 font-medium">Date</th>
              <th className="text-left  py-2 px-4 font-medium">Doc</th>
              <th className="text-left  py-2 px-4 font-medium">Counterparty</th>
              <th className="text-right py-2 px-4 font-medium">OUT</th>
              <th className="text-right py-2 px-4 font-medium">IN</th>
              <th className="text-right py-2 px-4 font-medium">NET</th>
              <th className="text-left  py-2 px-4 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const tint = r.status === 'paid' ? 'bg-emerald-600/[0.07]'
                : r.status === 'overdue' ? 'bg-wine-red/[0.05]'
                : r.status === 'today' ? 'bg-amber-gold/[0.10]' : ''
              const dirBorder = r.dir === 'out' ? 'border-l-2 border-l-wine-red/40' : 'border-l-2 border-l-emerald-600/40'
              return (
                <tr key={r.key} className={`border-b border-pale-stone/40 last:border-0 hover:bg-cream/40 ${dirBorder} ${tint}`}>
                  <td className="py-2 px-4 whitespace-nowrap">
                    <div className="text-xs">{fmtDate(r.date)}</div>
                    <div className="text-[11px]">{whenLabel(r, today)}</div>
                  </td>
                  <td className="py-2 px-4 font-mono text-xs whitespace-nowrap">
                    <span className={r.dir === 'out' ? 'text-wine-red' : 'text-emerald-700'}>
                      {r.dir === 'out' ? '↗' : '↘'}
                    </span>{' '}
                    {r.href
                      ? <a href={r.href} target="_blank" rel="noreferrer" className="hover:underline">{r.label}</a>
                      : r.label}
                  </td>
                  <td className="py-2 px-4 whitespace-nowrap">{r.who}</td>
                  <td className="py-2 px-4 text-right tabular-nums whitespace-nowrap text-wine-red">
                    {r.dir === 'out' ? `฿${fmt(r.amount)}` : ''}
                  </td>
                  <td className="py-2 px-4 text-right tabular-nums whitespace-nowrap text-emerald-700">
                    {r.dir === 'in' ? `฿${fmt(r.amount)}` : ''}
                  </td>
                  <td className={`py-2 px-4 text-right tabular-nums whitespace-nowrap ${r.net < 0 ? 'text-wine-red' : 'text-deep-black'}`}>
                    {r.net < 0 ? `-฿${fmt(-r.net)}` : `฿${fmt(r.net)}`}
                  </td>
                  <td className="py-2 px-4 whitespace-nowrap">
                    {r.dir === 'out'
                      ? (r.mand
                          ? <MandStatus status={r.status} />
                          : <div className="flex items-center gap-2">
                              <PaidAtCell poId={r.po!.id} initial={r.po!.paid_at} />
                              <DocsUrlCell poId={r.po!.id} initial={r.po!.docs_url} />
                            </div>)
                      : <InvoiceStatus status={r.inv!.status} overdue={r.status === 'overdue'} detailUrl={r.inv!.detailUrl} />}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function whenLabel(r: CalRow, today: string): React.ReactNode {
  if (r.status === 'paid') return <span className="text-emerald-700">оплачено</span>
  const dd = daysBetween(r.date, today)
  if (dd < 0)   return <span className="text-wine-red">просрочено {-dd} дн</span>
  if (dd === 0) return <span className="text-deep-black">сегодня</span>
  return <span className="text-graphite">через {dd} дн</span>
}

function MandStatus({ status }: { status: Status }) {
  const map: Record<Status, { label: string; cls: string }> = {
    paid:    { label: 'Paid',    cls: 'bg-emerald-600/10 text-emerald-700 border-emerald-600/40' },
    overdue: { label: 'Overdue', cls: 'bg-wine-red/10 text-wine-red border-wine-red/40' },
    today:   { label: 'Today',   cls: 'bg-amber-gold/10 text-deep-black border-amber-gold/40' },
    future:  { label: 'Planned', cls: 'bg-cream text-graphite border-pale-stone' },
  }
  const s = map[status]
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block px-2 py-0.5 text-[11px] rounded-sm border ${s.cls}`}>{s.label}</span>
      <Link href="/m/fixed-costs" className="text-[11px] text-graphite hover:text-wine-red" title="Fixed Costs">⚙</Link>
    </span>
  )
}

function InvoiceStatus({ status, overdue, detailUrl }: { status: string; overdue: boolean; detailUrl: string | null }) {
  const display = overdue ? 'Overdue' : (status || '—')
  const cls = overdue
    ? 'bg-wine-red/10 text-wine-red border-wine-red/40'
    : 'bg-amber-gold/10 text-deep-black border-amber-gold/40'
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block px-2 py-0.5 text-[11px] rounded-sm border ${cls}`}>{display}</span>
      {detailUrl && <a href={detailUrl} target="_blank" rel="noreferrer" className="text-[11px] text-graphite hover:text-wine-red">↗</a>}
    </span>
  )
}

function NoDateList({ invoices }: { invoices: FlowInvoice[] }) {
  const total = invoices.reduce((s, x) => s + Number(x.total ?? 0), 0)
  return (
    <section className="mt-5 bg-warm-white border border-pale-stone rounded-md overflow-hidden">
      <div className="px-4 py-2 border-b border-pale-stone bg-cream/40 flex items-baseline justify-between">
        <h3 className="font-heading text-sm text-deep-black">IN без даты оплаты — нужно задать отсрочку клиента</h3>
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
      Нет платежей с датой в этом периоде.
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
      <div className="text-[11px] text-graphite/70">{note ?? `${n} шт`}</div>
    </div>
  )
}

function fmt(n: number): string {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}
