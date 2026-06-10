import { sbInventory, sbPublic, type PurchaseOrder, type Supplier } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { PaidAtCell } from '@/components/modules/purchases/PaidAtCell'
import { DocsUrlCell } from '@/components/modules/purchases/DocsUrlCell'
import { DataFreshness } from '@/components/shell/DataFreshness'
import { fmtDate } from '@/lib/fmt'
import { computeDueDate, todayBkk, daysBetween } from '@/lib/kpi'

export const dynamic = 'force-dynamic'

type OpenPO = PurchaseOrder & { dueDate: string; daysToDue: number }
type Bucket = 'overdue' | 'today' | 'week' | 'later'

export default async function PaymentCalendarPage() {
  const today = todayBkk()

  // All UNPAID closed POs across every month. Pay date = order_date + supplier
  // payment terms — the same formula the cashflow assumes in Pulse/Rolling.
  const { data: openRows, error: poErr } = await sbPublic
    .from('purchase_orders')
    .select('id,po_number,order_date,supplier,total_thb,status,url,cashflow_override,paid_at,docs_url')
    .is('paid_at', null)
    .order('order_date', { ascending: true })
  if (poErr) {
    return <div className="p-6"><SchemaError error={poErr.message} /></div>
  }

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

  // Consignment + force-exclude POs are not paid by ordinary invoice — out.
  const openPos: OpenPO[] = []
  for (const p of (openRows ?? []) as PurchaseOrder[]) {
    if ((p.status ?? '').toLowerCase() !== 'closed') continue
    if (supType(p.supplier) === 'consignment') continue
    if (p.cashflow_override === 'exclude') continue
    if (!p.order_date) continue
    const dueDate = computeDueDate(p.order_date, termsFor(p.supplier))
    openPos.push({ ...p, dueDate, daysToDue: daysBetween(dueDate, today) })
  }
  openPos.sort((a, b) => a.dueDate.localeCompare(b.dueDate))

  function bucketOf(p: OpenPO): Bucket {
    if (p.daysToDue < 0) return 'overdue'
    if (p.daysToDue === 0) return 'today'
    if (p.daysToDue <= 7) return 'week'
    return 'later'
  }
  const groups: Record<Bucket, OpenPO[]> = { overdue: [], today: [], week: [], later: [] }
  for (const p of openPos) groups[bucketOf(p)].push(p)
  const sumOf = (arr: OpenPO[]) => arr.reduce((s, p) => s + Number(p.total_thb ?? 0), 0)
  const totalOpen = sumOf(openPos)

  return (
    <>
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-3">
        <h2 className="font-heading text-xl text-deep-black">Payment Calendar · Кредиторка</h2>
        <DataFreshness sources={['purchase_orders']} />
      </div>
      <p className="text-graphite text-sm mb-4 max-w-3xl">
        Неоплаченные закрытые PO по всем месяцам, сгруппированы по дате платежа
        (<span className="text-deep-black">order_date + отсрочка поставщика</span>). Консигнация и
        force-exclude не показываются — их не платят обычным счётом. Кликни
        <span className="text-deep-black"> + paid</span>, чтобы отметить оплату (PO уйдёт из календаря).
      </p>

      {/* Bucket KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <KPI label="Просрочено" sum={sumOf(groups.overdue)} n={groups.overdue.length} tone="overdue" />
        <KPI label="Сегодня"    sum={sumOf(groups.today)}   n={groups.today.length}   tone="today" />
        <KPI label="Эта неделя" sum={sumOf(groups.week)}    n={groups.week.length}    tone="week" />
        <KPI label="Позже"      sum={sumOf(groups.later)}   n={groups.later.length}   tone="later" />
      </div>

      {openPos.length === 0 ? (
        <div className="bg-warm-white border border-pale-stone rounded-md py-10 text-center text-graphite text-sm">
          Нет неоплаченных PO. Всё закрыто 🎉
        </div>
      ) : (
        <div className="space-y-5">
          <BucketTable title="Просрочено" tone="overdue" rows={groups.overdue} today={today} />
          <BucketTable title="Сегодня"    tone="today"   rows={groups.today}   today={today} />
          <BucketTable title="Эта неделя" tone="week"    rows={groups.week}    today={today} />
          <BucketTable title="Позже"      tone="later"   rows={groups.later}   today={today} />
        </div>
      )}

      <div className="mt-5 text-xs text-graphite/70 tabular-nums">
        Всего к оплате: ฿{fmt(totalOpen)} · {openPos.length} PO
      </div>
    </>
  )
}

function dueLabel(p: OpenPO): React.ReactNode {
  if (p.daysToDue < 0)  return <span className="text-wine-red">просрочено на {-p.daysToDue} дн · {fmtDate(p.dueDate)}</span>
  if (p.daysToDue === 0) return <span className="text-deep-black">сегодня · {fmtDate(p.dueDate)}</span>
  return <span className="text-graphite">через {p.daysToDue} дн · {fmtDate(p.dueDate)}</span>
}

function BucketTable({ title, tone, rows, today }: {
  title: string; tone: Bucket; rows: OpenPO[]; today: string
}) {
  if (rows.length === 0) return null
  const headBg = tone === 'overdue' ? 'bg-wine-red/[0.06]' : tone === 'today' ? 'bg-amber-gold/[0.14]' : 'bg-cream/40'
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
              <th className="text-left py-2 px-4 font-medium">Due</th>
              <th className="text-right py-2 px-4 font-medium">Total</th>
              <th className="text-left py-2 px-4 font-medium">Paid</th>
              <th className="text-left py-2 px-4 font-medium">Docs</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(p => (
              <tr key={p.id} className="border-b border-pale-stone/40 last:border-0 hover:bg-cream/40">
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
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function KPI({ label, sum, n, tone }: { label: string; sum: number; n: number; tone: Bucket }) {
  const bg = tone === 'overdue' ? 'bg-wine-red/[0.06]' : tone === 'today' ? 'bg-amber-gold/[0.14]' : 'bg-warm-white'
  const valueCls = tone === 'overdue' ? 'text-wine-red' : 'text-deep-black'
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
