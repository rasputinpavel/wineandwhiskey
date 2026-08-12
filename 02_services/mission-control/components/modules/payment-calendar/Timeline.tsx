'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PurchaseOrder } from '@/lib/supabase'
import { PaidAtCell } from '@/components/modules/purchases/PaidAtCell'
import { DocsUrlCell } from '@/components/modules/purchases/DocsUrlCell'
import { fmtDate } from '@/lib/fmt'
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
  fixed?: { fixedCostId: string; period: string; paid: boolean }  // OUT: recurring mandatory obligation (fixed_cost)
}

// Единый нетто-таймлайн. Клиентский, чтобы управлять анимацией строки при оплате.
// В режиме Open отмеченная строка мигает зелёным ~2с (подтверждение, что механизм
// сработал по ней), затем убирается из списка и сервер пересчитывает NET. В месячном
// виде оплата ничего не убирает — строка остаётся зелёной на своём месте.
const EXIT_MS = 2000

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
            {visible.map(r => {
              const isExiting = exiting.has(r.key)
              const tint = isExiting ? 'bg-emerald-500/25 animate-pulse'
                : r.status === 'paid' ? 'bg-emerald-600/[0.07]'
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
                  <td className="py-2 px-4 whitespace-nowrap">{r.who}<TypeBadge r={r} /></td>
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
                      ? <div className="flex items-center gap-2">
                          <PaidAtCell poId={r.po!.id} initial={r.po!.paid_at}
                                      onSaved={v => handlePaid(r.key, v)} />
                          <DocsUrlCell poId={r.po!.id} initial={r.po!.docs_url} />
                        </div>
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

function TypeBadge({ r }: { r: CalRow }) {
  const meta = r.dir === 'in' ? null
    : r.fixed ? { t: 'Постоянное', cls: 'bg-amber-gold/10 text-deep-black border-amber-gold/40' }
    : r.big   ? { t: 'Разовое',    cls: 'bg-wine-red/10 text-wine-red border-wine-red/40' }
    :           { t: 'Поставщик',  cls: 'bg-graphite/10 text-graphite border-graphite/30' }
  if (!meta) return null
  return <span className={`ml-2 inline-block px-1.5 py-0.5 text-[10px] rounded-sm border ${meta.cls}`}>{meta.t}</span>
}

function fmt(n: number): string {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
