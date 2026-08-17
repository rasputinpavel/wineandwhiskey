'use client'

import { Fragment, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PurchaseOrder } from '@/lib/supabase'
import { PaidAtCell } from '@/components/modules/purchases/PaidAtCell'
import { DocsUrlCell } from '@/components/modules/purchases/DocsUrlCell'
import { MarkPaidCell } from './MarkPaidCell'
import { fmtDate, bangkokToday } from '@/lib/fmt'
import { daysBetween } from '@/lib/kpi'

export type Dir = 'out' | 'in'
export type Status = 'overdue' | 'today' | 'future' | 'paid'
export type CalRow = {
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
  big?: { id: string; paid: boolean }  // OUT: big one-off payment (rolling.big_payments)
  // OUT: recurring mandatory obligation (fixed_cost). `alsoIds` holds extra
  // obligations collapsed into this one row (paid together on one invoice) — the
  // mark-paid control toggles them all.
  fixed?: { fixedCostId: string; period: string; paid: boolean; alsoIds?: { fixedCostId: string; period: string }[] }
}

// Единый нетто-таймлайн. Клиентский, чтобы управлять анимацией строки при оплате.
// В режиме Open отмеченная строка мигает зелёным ~2с (подтверждение, что механизм
// сработал по ней), затем убирается из списка и сервер пересчитывает NET. В месячном
// виде оплата ничего не убирает — строка остаётся зелёной на своём месте.
const EXIT_MS = 2000

// Money-in / "good" accent. The brand palette has no green token; this muted
// pine sits calmly against the warm neutrals instead of a loud emerald.
const PINE = 'text-[#4C6B54]'

// «Один сигнал — одна колонка». Направление читается позицией суммы (OUT/IN),
// а не цветом+бордером+стрелкой одновременно. Категория — тихая надпись под
// контрагентом, а не цветной чип. Цвет приберегаем для того, что требует
// внимания: просрочка/сегодня (полоса слева) и отрицательный баланс.
const CATEGORY: Record<string, string> = {
  fixed: 'Fixed', big: 'One-off', supplier: 'Supplier', receivable: 'Receivable',
}
function categoryOf(r: CalRow): string {
  if (r.dir === 'in') return CATEGORY.receivable
  if (r.fixed) return CATEGORY.fixed
  if (r.big) return CATEGORY.big
  return CATEGORY.supplier
}

export function Timeline({ rows, today, isOpenView }: {
  rows: CalRow[]
  today: string
  isOpenView: boolean
}) {
  const router = useRouter()
  const [exiting, setExiting] = useState<Set<string>>(new Set())
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  function handlePaid(key: string, value: string | null) {
    // Оплата в Open → мигнуть и уехать; иначе (месяц / снятие отметки) просто ресинк.
    if (isOpenView && value) {
      setExiting(s => new Set(s).add(key))
      setTimeout(() => {
        setHidden(s => new Set(s).add(key))
        router.refresh()
      }, EXIT_MS)
    } else {
      router.refresh()
    }
  }

  const visible = rows.filter(r => !hidden.has(r.key))

  // Дневной нетто для тихого заголовка группы.
  const dayNet = new Map<string, number>()
  for (const r of visible) {
    dayNet.set(r.date, (dayNet.get(r.date) ?? 0) + (r.dir === 'in' ? r.amount : -r.amount))
  }

  return (
    <section className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="text-graphite border-b border-pale-stone bg-cream/40">
            <tr>
              <th className="w-[3px] p-0"></th>
              <th className="text-left  py-2 px-4 font-medium">Date</th>
              <th className="text-left  py-2 px-4 font-medium">Document</th>
              <th className="text-left  py-2 px-4 font-medium">Counterparty</th>
              <th className="text-right py-2 px-4 font-medium">Out</th>
              <th className="text-right py-2 px-4 font-medium">In</th>
              <th className="text-right py-2 px-4 font-medium">Balance</th>
              <th className="text-left  py-2 px-4 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => {
              const newDay = i === 0 || visible[i - 1].date !== r.date
              const isExiting = exiting.has(r.key)
              // Строка-подложка нейтральна; оплата подсвечивается только на время анимации.
              const rowTint = isExiting ? 'bg-emerald-500/25 animate-pulse' : ''
              const rail =
                r.status === 'overdue' ? 'bg-wine-red' :
                r.status === 'today'   ? 'bg-amber-gold' : ''
              const paid = r.status === 'paid'
              return (
                <Fragment key={r.key}>
                  {newDay && (
                    <tr>
                      <td className="p-0"></td>
                      <td colSpan={7} className="pt-4 pb-1 px-4">
                        <span className="text-[11px] tracking-[0.13em] uppercase font-semibold text-[#8B8073]">
                          {dayFull(r.date)}
                        </span>
                        <span className="ml-3 text-[11px] tabular-nums text-[#8B8073]">
                          · day net {signed(dayNet.get(r.date) ?? 0)}
                        </span>
                      </td>
                    </tr>
                  )}
                  <tr className={`border-b border-pale-stone/40 hover:bg-cream/40 ${rowTint}`}>
                    {/* Полоса-акцент слева: только просрочка/сегодня, иначе молчит. */}
                    <td className={`p-0 ${rail}`}></td>
                    <td className="py-2 px-4 whitespace-nowrap">
                      <div className={paid ? 'text-[#8B8073]' : ''}>{fmtDate(r.date)}</div>
                      <div className="text-[11px]">{whenLabel(r, today)}</div>
                    </td>
                    <td className={`py-2 px-4 font-mono text-xs whitespace-nowrap ${paid ? 'text-[#8B8073]' : 'text-deep-black'}`}>
                      {r.href
                        ? <a href={r.href} target="_blank" rel="noreferrer" className="hover:underline decoration-pale-stone">{r.label}</a>
                        : r.label}
                    </td>
                    <td className="py-2 px-4 whitespace-nowrap">
                      <div className={paid ? 'text-[#8B8073]' : 'text-deep-black'}>{r.who}</div>
                      <div className="text-[10px] tracking-[0.13em] uppercase font-semibold text-[#8B8073] mt-px">
                        {categoryOf(r)}
                      </div>
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums whitespace-nowrap">
                      {r.dir === 'out'
                        ? <span className={paid ? 'text-[#8B8073] line-through decoration-[#8B807366]' : 'text-deep-black'}>฿{fmt(r.amount)}</span>
                        : <span className="text-pale-stone">–</span>}
                    </td>
                    <td className={`py-2 px-4 text-right tabular-nums whitespace-nowrap ${PINE}`}>
                      {r.dir === 'in' ? `฿${fmt(r.amount)}` : <span className="text-pale-stone">–</span>}
                    </td>
                    <td className={`py-2 px-4 text-right tabular-nums whitespace-nowrap font-semibold ${r.net < 0 ? 'text-wine-red' : 'text-deep-black'}`}>
                      {r.net < 0 ? `-฿${fmt(-r.net)}` : `฿${fmt(r.net)}`}
                    </td>
                    <td className="py-2 px-4 whitespace-nowrap">
                      {r.dir === 'out'
                        ? r.fixed
                          ? <MarkPaidCell
                              paid={r.fixed.paid} endpoint="/api/m/mandatory-actual" method="PUT"
                              // Merged rows carry a combined amount, so let each member
                              // default to its plan amount instead of stamping the sum.
                              payloadPaid={r.fixed.alsoIds?.length
                                ? { fixed_cost_id: r.fixed.fixedCostId, period: r.fixed.period, paid: true, paid_at: bangkokToday() }
                                : { fixed_cost_id: r.fixed.fixedCostId, period: r.fixed.period, paid: true, paid_at: bangkokToday(), amount_thb: Math.round(r.amount) }}
                              payloadUnpaid={{ fixed_cost_id: r.fixed.fixedCostId, period: r.fixed.period, paid: false, paid_at: null }}
                              alsoRequests={r.fixed.alsoIds?.map(m => ({
                                endpoint: '/api/m/mandatory-actual', method: 'PUT' as const,
                                payloadPaid: { fixed_cost_id: m.fixedCostId, period: m.period, paid: true, paid_at: bangkokToday() },
                                payloadUnpaid: { fixed_cost_id: m.fixedCostId, period: m.period, paid: false, paid_at: null },
                              }))}
                              onSaved={v => handlePaid(r.key, v)} />
                          : r.big
                          ? <MarkPaidCell
                              paid={r.big.paid} endpoint="/api/m/rolling/payment" method="PATCH"
                              payloadPaid={{ id: r.big.id, status: 'paid' }}
                              payloadUnpaid={{ id: r.big.id, status: 'planned' }}
                              onSaved={v => handlePaid(r.key, v)} />
                          : <div className="flex items-center gap-2">
                              <PaidAtCell poId={r.po!.id} initial={r.po!.paid_at} onSaved={v => handlePaid(r.key, v)} />
                              <DocsUrlCell poId={r.po!.id} initial={r.po!.docs_url} />
                            </div>
                        : <InvoiceStatus status={r.inv!.status} overdue={r.status === 'overdue'} detailUrl={r.inv!.detailUrl} />}
                    </td>
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// Полная подпись дня для тихого заголовка группы: «Wed 10 Sep».
function dayFull(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })
}

function whenLabel(r: CalRow, today: string): React.ReactNode {
  if (r.status === 'paid') return <span className={PINE}>paid</span>
  const dd = daysBetween(r.date, today)
  if (dd < 0)   return <span className="text-wine-red">overdue {-dd}d</span>
  if (dd === 0) return <span className="text-deep-black font-medium">today</span>
  return <span className="text-[#8B8073]">in {dd}d</span>
}

function InvoiceStatus({ status, overdue, detailUrl }: { status: string; overdue: boolean; detailUrl: string | null }) {
  const display = overdue ? 'Overdue' : (status || 'Unpaid')
  const cls = overdue ? 'text-wine-red' : 'text-[#8B8073]'
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`text-[11px] tracking-[0.08em] uppercase font-semibold ${cls}`}>{display}</span>
      {detailUrl && <a href={detailUrl} target="_blank" rel="noreferrer" className="text-[11px] text-graphite hover:text-wine-red">↗</a>}
    </span>
  )
}

function fmt(n: number): string {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function signed(n: number): string {
  return n < 0 ? `-฿${fmt(-n)}` : `฿${fmt(n)}`
}
