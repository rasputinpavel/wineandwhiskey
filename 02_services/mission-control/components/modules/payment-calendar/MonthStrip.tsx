'use client'

import { useRouter } from 'next/navigation'
import { useTransition, useState } from 'react'

// Клиентский переключатель месяцев. Навигация по ?month= идёт в рамках одного
// сегмента, поэтому loading.tsx не срабатывает — без обратной связи клик «не виден»
// (сервер ходит в Supabase, латентность плавает → ощущение «то фильтрует, то нет»).
// useTransition даёт isPending: подсвечиваем кликнутый таб оптимистично и гасим
// полосу, пока идёт переход. Текущий месяц помечаем янтарной рамкой.
type MonthOpt = { ym: string; label: string }

export function MonthStrip({ months, selected, currentYM }: {
  months: MonthOpt[]
  selected: string | null
  currentYM: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [target, setTarget] = useState<string | null>(selected)

  // во время перехода показываем оптимистичную цель, после — реальный selected
  const active = isPending ? target : selected

  function go(ym: string | null) {
    if (ym === selected) return
    setTarget(ym)
    startTransition(() => {
      router.push(ym ? `/m/payment-calendar?month=${ym}` : '/m/payment-calendar')
    })
  }

  const base = 'px-2 py-1 rounded-sm border transition-colors cursor-pointer'
  function cls(ym: string | null) {
    if (ym === active) return `${base} bg-wine-red text-warm-white border-wine-red`
    if (ym !== null && ym === currentYM)
      return `${base} bg-warm-white text-deep-black border-amber-gold font-medium hover:border-wine-red hover:text-wine-red`
    return `${base} bg-warm-white text-graphite border-pale-stone hover:border-wine-red hover:text-wine-red`
  }

  return (
    <div className={`flex gap-1 mb-5 text-[11px] flex-wrap transition-opacity ${isPending ? 'opacity-60' : ''}`}>
      <button type="button" onClick={() => go(null)} className={cls(null)}>Open</button>
      {months.map(m => (
        <button key={m.ym} type="button" onClick={() => go(m.ym)} className={cls(m.ym)}>
          {m.label}
        </button>
      ))}
    </div>
  )
}
